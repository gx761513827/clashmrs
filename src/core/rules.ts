/**
 * 规则条目的解析、归一化、校验与行为判定。
 * 这里不碰 UI，也不碰网络，只做「用户输入 → 合法规则列表」的转换。
 */
import { checkDomain } from './domain-set';
import {
  formatIpValue,
  parseIpAddress,
  parseIpOrCidr,
  rangeToCidrs,
  type IpRange,
} from './ipcidr-set';
import type { RuleBehavior } from './mrs';

export interface NormalizeIssue {
  line: number;
  raw: string;
  code: string;
  reason: string;
}

export interface NormalizeResult {
  entries: string[];
  issues: NormalizeIssue[];
  duplicates: string[];
  comments: number;
}

export type NormalizeTokenResult =
  | { ok: true; entries: string[] }
  | { ok: false; code: string; reason: string };

const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/** 把一段 IP 区间展开成最小 CIDR 文本列表。 */
export function ipRangeToCidrTexts(start: bigint, end: bigint, isV6: boolean): string[] {
  return rangeToCidrs(start, end, isV6).map(
    (cidr) => `${formatIpValue(cidr.value, isV6)}/${cidr.prefix}`,
  );
}

/**
 * 归一化单条输入：支持域名、通配域名、IP、CIDR、IP 区间、URL、带端口写法。
 * 返回可能多于一条（IP 区间会被拆成多个 CIDR）。
 */
export function normalizeToken(raw: string): NormalizeTokenResult {
  let text = raw.trim();
  if (text === '') return { ok: false, code: 'empty', reason: '空条目' };

  // 1) 已经是合法 IP / CIDR
  if (parseIpOrCidr(text).ok) return { ok: true, entries: [text] };

  // 1.5) 「IP + /数字」是写坏的 CIDR，必须报错，不能退化成域名
  const slashIndex = text.indexOf('/');
  if (slashIndex > 0 && /^\d{0,3}$/.test(text.slice(slashIndex + 1))) {
    if (parseIpAddress(text.slice(0, slashIndex)) !== null) {
      const attempt = parseIpOrCidr(text);
      if (!attempt.ok) return { ok: false, code: attempt.code, reason: attempt.reason };
    }
  }

  // 2) IP 区间 a-b（两侧都必须是同族 IP，否则连字符可能只是域名的一部分）
  const dash = text.indexOf('-');
  if (dash > 0) {
    const left = parseIpAddress(text.slice(0, dash));
    const right = parseIpAddress(text.slice(dash + 1));
    if (left !== null && right !== null && left.isV6 === right.isV6) {
      if (left.value > right.value) {
        return { ok: false, code: 'invalid-range', reason: `IP 区间起点大于终点：${text}` };
      }
      return { ok: true, entries: ipRangeToCidrTexts(left.value, right.value, left.isV6) };
    }
  }

  // 3) URL → 取 host
  if (URL_SCHEME.test(text)) {
    try {
      const url = new URL(text);
      text = url.hostname.replace(/^\[|\]$/g, '');
    } catch {
      return { ok: false, code: 'invalid-url', reason: `无法解析为 URL：${raw}` };
    }
  } else if (text.includes('/')) {
    // 4) 带路径的写法 example.com/path
    text = text.slice(0, text.indexOf('/'));
  }

  // 5) 去掉端口
  const bracketPort = /^\[(.+)\]:\d+$/.exec(text);
  if (bracketPort !== null) {
    text = bracketPort[1];
  } else {
    const plainPort = /^([^:]+):\d+$/.exec(text);
    if (plainPort !== null) text = plainPort[1];
  }

  // 6) 残留的 ":" 基本是 keyword:/regexp:/full: 这类属性，或者写坏的 IPv6
  if (text.includes(':')) {
    return {
      ok: false,
      code: 'unsupported-attribute',
      reason: `不支持带 ":" 的写法：${raw}（本工具只生成 domain/ipcidr 规则集，keyword:/regexp:/full: 之类请自行转换）`,
    };
  }

  text = text.toLowerCase();
  const checked = checkDomain(text);
  if (!checked.ok) {
    return { ok: false, code: checked.code, reason: `${checked.reason}：${raw}` };
  }

  return { ok: true, entries: [text] };
}

/** 去掉行内注释：`#` 之后的内容（整行 `//` 或 `;` 开头也当注释）。 */
export function stripComment(line: string): { text: string; isComment: boolean } {
  const trimmed = line.trim();
  if (trimmed === '') return { text: '', isComment: true };
  if (trimmed.startsWith('//') || trimmed.startsWith(';')) return { text: '', isComment: true };
  const hash = line.indexOf('#');
  const text = (hash >= 0 ? line.slice(0, hash) : line).trim();
  return { text, isComment: text === '' };
}

/** 一行里可能塞了多个条目（逗号/空白分隔）。 */
export function splitTokens(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token !== '');
}

/** 解析整段文本，返回归一化后的条目与逐行问题。 */
export function normalizeList(text: string): NormalizeResult {
  const entries: string[] = [];
  const issues: NormalizeIssue[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  let comments = 0;

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const stripped = stripComment(raw);
    if (stripped.isComment) {
      comments++;
      continue;
    }
    for (const token of splitTokens(stripped.text)) {
      const result = normalizeToken(token);
      if (!result.ok) {
        if (result.code === 'empty') continue;
        issues.push({ line: index + 1, raw: token, code: result.code, reason: result.reason });
        continue;
      }
      for (const entry of result.entries) {
        if (seen.has(entry)) {
          if (!duplicates.includes(entry)) duplicates.push(entry);
          continue;
        }
        seen.add(entry);
        entries.push(entry);
      }
    }
  }

  return { entries, issues, duplicates, comments };
}

export type BehaviorDetection = RuleBehavior | 'mixed' | 'empty';

/** 依据条目自动判定 behavior；域名与 IP 混在一起返回 'mixed'。 */
export function detectBehavior(entries: readonly string[]): BehaviorDetection {
  if (entries.length === 0) return 'empty';
  let hasIp = false;
  let hasDomain = false;
  for (const entry of entries) {
    if (parseIpOrCidr(entry).ok) hasIp = true;
    else hasDomain = true;
  }
  if (hasIp && hasDomain) return 'mixed';
  return hasIp ? 'ipcidr' : 'domain';
}

/** 按类型拆分条目（用于把混合列表拆成 domain / ipcidr 两个文件）。 */
export function splitByBehavior(entries: readonly string[]): {
  domains: string[];
  ips: string[];
} {
  const domains: string[] = [];
  const ips: string[] = [];
  for (const entry of entries) {
    if (parseIpOrCidr(entry).ok) ips.push(entry);
    else domains.push(entry);
  }
  return { domains, ips };
}

export interface DiffResult {
  added: string[];
  removed: string[];
  unchangedCount: number;
}

export function diffEntries(before: readonly string[], after: readonly string[]): DiffResult {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added: string[] = [];
  const removed: string[] = [];
  let unchangedCount = 0;
  for (const entry of afterSet) {
    if (beforeSet.has(entry)) unchangedCount++;
    else added.push(entry);
  }
  for (const entry of beforeSet) {
    if (!afterSet.has(entry)) removed.push(entry);
  }
  return { added, removed, unchangedCount };
}

/** 文本源文件的落盘内容：纯条目，一行一条，结尾换行。 */
export function serializeTextFile(entries: readonly string[]): string {
  return entries.length === 0 ? '' : `${entries.join('\n')}\n`;
}

/** 解析文本源文件（与 {@link normalizeList} 相同，但条目必须已经合法）。 */
export function parseTextFile(text: string): string[] {
  return normalizeList(text).entries;
}

/** 用于 UI 提示：区间的可读文本。 */
export function ipRangeSummary(range: IpRange): string {
  return `${formatIpValue(range.start, range.isV6)} - ${formatIpValue(range.end, range.isV6)}`;
}
