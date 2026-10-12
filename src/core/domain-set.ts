/**
 * 域名规则集（behavior=domain）的 DAFSA 编解码。
 *
 * 这是 mihomo `component/trie/domain_set.go` + `domain_set_bin.go` 的忠实移植：
 * 内部 key 是「按 rune 反转的域名」，再用一层 64 位位图 DAFSA 压紧。
 * 只要移植正确，生成的负载与官方 `mihomo convert-ruleset` 输出逐字节相同
 * （tests/core/fixtures.test.ts 用官方发布的真实 .mrs 做字节级回归）。
 */
import {
  compareBytes,
  reverseRunes,
  sortByUtf8,
  utf8Decode,
  utf8Encode,
  writeUint64BE,
  readUint64BE,
  concatBytes,
  writeInt64BE,
  readInt64BE,
} from './bytes';

const COMPLEX_WILDCARD = '+';
const WILDCARD = '*';
const DOT = '.';

export type DomainErrorCode =
  | 'empty'
  | 'trailing-dot'
  | 'whitespace'
  | 'empty-label'
  | 'wildcard-label'
  | 'wildcard-plus-position'
  | 'wildcard-plus-needs-label'
  | 'slash';

export type DomainCheck =
  | { ok: true; parts: string[] }
  | { ok: false; code: DomainErrorCode; reason: string };

/**
 * 校验并按 `.` 切分域名：规则与 mihomo `trie.ValidAndSplitDomain` 一致，
 * 额外拦下包含 `/` 的条目（mihomo 会记日志后跳过，这里提前报错更友好）。
 */
export function checkDomain(domain: string): DomainCheck {
  if (domain === '') {
    return { ok: false, code: 'empty', reason: '域名不能为空' };
  }
  if (domain.endsWith(DOT)) {
    return { ok: false, code: 'trailing-dot', reason: '域名结尾不能是点号（例如 example.com.）' };
  }
  if (/^\s/.test(domain) || /\s$/.test(domain)) {
    return { ok: false, code: 'whitespace', reason: '域名首尾不能有空白字符' };
  }
  if (domain.includes('/')) {
    return { ok: false, code: 'slash', reason: '域名中不允许出现 "/"' };
  }

  const parts = domain.toLowerCase().split(DOT);
  if (parts.length === 1) {
    if (parts[0] === '') return { ok: false, code: 'empty', reason: '域名不能为空' };
  } else {
    for (let i = 1; i < parts.length; i++) {
      if (parts[i] === '') {
        return {
          ok: false,
          code: 'empty-label',
          reason: `第 ${i + 1} 个标签为空（不能出现连续的点）`,
        };
      }
    }
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.includes(COMPLEX_WILDCARD)) {
      if (part !== COMPLEX_WILDCARD) {
        return {
          ok: false,
          code: 'wildcard-label',
          reason: `"+" 必须独占一个标签（第 ${i + 1} 个标签非法）`,
        };
      }
      if (i !== 0) {
        return { ok: false, code: 'wildcard-plus-position', reason: '"+" 只能出现在最前面的标签，例如 +.example.com' };
      }
      if (parts.length === 1) {
        return { ok: false, code: 'wildcard-plus-needs-label', reason: '"+" 后面必须还有标签，例如 +.example.com' };
      }
    }
    if (part.includes(WILDCARD) && part !== WILDCARD) {
      return { ok: false, code: 'wildcard-label', reason: `"*" 必须独占一个标签，例如 *.example.com（第 ${i + 1} 个标签非法）` };
    }
  }

  return { ok: true, parts };
}

export interface DomainSetData {
  leaves: bigint[];
  labelBitmap: bigint[];
  labels: number[];
}

function setBit(words: bigint[], index: number, value: bigint): void {
  const word = index >> 6;
  while (words.length <= word) words.push(0n);
  words[word] |= value << BigInt(index & 63);
}

function getBit(words: bigint[], index: number): boolean {
  const word = index >> 6;
  if (word >= words.length) return false;
  return ((words[word] >> BigInt(index & 63)) & 1n) === 1n;
}

/**
 * 由域名列表构建 DAFSA（对齐 mihomo `DomainSetBuilder.Insert` + `buildDomainSet`）。
 * 传入的域名必须已经过 {@link checkDomain} 校验。
 */
export function buildDomainSet(domains: readonly string[]): DomainSetData {
  const keys: Uint8Array[] = [];

  const pushKey = (parts: string[]): void => {
    const local = parts.slice();
    if (local[0] === '') local[0] = COMPLEX_WILDCARD;
    // mihomo 用 rune 反转，再按 UTF-8 字节建树
    keys.push(utf8Encode(reverseRunes(local.join(DOT))));
  };

  for (const domain of domains) {
    const checked = checkDomain(domain);
    if (!checked.ok) {
      throw new Error(`非法域名 "${domain}"：${checked.reason}`);
    }
    const parts = checked.parts;
    if (parts[0] === COMPLEX_WILDCARD) {
      // "+.example.com" 表示「自身 + 所有子域」，因此写入两个 key
      pushKey(parts.slice(1));
      pushKey(parts);
    } else {
      pushKey(parts);
    }
  }

  keys.sort(compareBytes);
  // sort + Compact：mihomo 用 slices.Compact 去重
  const unique: Uint8Array[] = [];
  for (const key of keys) {
    const last = unique[unique.length - 1];
    if (last === undefined || compareBytes(last, key) !== 0) unique.push(key);
  }

  const leaves: bigint[] = [];
  const labelBitmap: bigint[] = [];
  const labels: number[] = [];

  let labelIndex = 0;
  let nodeId = 0;
  let queue: { start: number; end: number }[] = [{ start: 0, end: unique.length }];
  let next: { start: number; end: number }[] = [];

  for (let column = 0; queue.length > 0; column++) {
    for (const element of queue) {
      if (element.start < element.end && column === unique[element.start].length) {
        element.start++;
        setBit(leaves, nodeId, 1n);
      }
      for (let j = element.start; j < element.end; ) {
        const from = j;
        const label = unique[from][column];
        if (label === undefined) {
          throw new Error('内部错误：域名 key 长度不一致，DAFSA 构建失败');
        }
        while (j < element.end && unique[j][column] === label) j++;
        next.push({ start: from, end: j });
        labels.push(label);
        setBit(labelBitmap, labelIndex, 0n);
        labelIndex++;
      }
      setBit(labelBitmap, labelIndex, 1n);
      labelIndex++;
      nodeId++;
    }
    const swap = queue;
    queue = next;
    next = swap;
    next.length = 0;
  }

  return { leaves, labelBitmap, labels };
}

/** 遍历 DAFSA，返回 mihomo `DomainSet.Foreach` 语义的 key（精确域名与 ".域名" 两种形式）。 */
export function decodeDomainSet(data: DomainSetData): string[] {
  const { leaves, labelBitmap, labels } = data;
  const out: string[] = [];
  const current: number[] = [];

  const selectIthOne = (index: number): number => {
    let seen = 0;
    for (let i = 0; i < labelBitmap.length * 64; i++) {
      if (getBit(labelBitmap, i)) {
        if (seen === index) return i;
        seen++;
      }
    }
    return -1;
  };

  const traverse = (nodeId: number, bitmapIndex: number, depth: number): void => {
    if (depth > 4096) throw new Error('MRS 负载损坏：DAFSA 层数过深');
    if (getBit(leaves, nodeId)) {
      // mihomo Foreach：先去掉反转串尾部的 "+"，再反转回来
      const reversedText = utf8Decode(Uint8Array.from(current));
      out.push(reverseRunes(reversedText.replace(/\+$/, '')));
    }
    for (let bitmap = bitmapIndex; ; bitmap++) {
      if (getBit(labelBitmap, bitmap)) return;
      const labelOffset = bitmap - nodeId;
      if (labelOffset < 0 || labelOffset >= labels.length) {
        throw new Error('MRS 负载损坏：label 越界');
      }
      current.push(labels[labelOffset]);
      const nextNodeId = bitmap - nodeId + 1;
      const nextBitmapIndex = selectIthOne(nextNodeId - 1) + 1;
      if (nextBitmapIndex <= 0) throw new Error('MRS 负载损坏：select 失败');
      traverse(nextNodeId, nextBitmapIndex, depth + 1);
      current.pop();
    }
  };

  traverse(0, 0, 0);
  return out;
}

/**
 * 把解码出来的域名条目压紧成 mihomo `DumpMrs` 的形式：
 * 同一域名的精确条目与 ".域名" 条目合并为 "+.域名"。
 */
export function normalizeDomainEntries(entries: readonly string[]): string[] {
  const unique = Array.from(new Set(entries));
  const sorted = sortByUtf8(unique);
  const trimmed = (value: string): string => (value.startsWith(DOT) ? value.slice(1) : value);
  const byDotless = sorted
    .map((value) => ({ value, dotless: trimmed(value) }))
    .sort((left, right) => (left.dotless < right.dotless ? -1 : left.dotless > right.dotless ? 1 : 0));

  const merged: string[] = [];
  for (let i = 0; i < byDotless.length; i++) {
    const current = byDotless[i];
    const following = byDotless[i + 1];
    if (following !== undefined && current.dotless === following.dotless) {
      merged.push(`${COMPLEX_WILDCARD}${DOT}${current.dotless}`);
      i++;
    } else {
      merged.push(current.value);
    }
  }
  return sortByUtf8(merged);
}

/** 序列化 domain 负载：version + leaves + labelBitmap + labels。 */
export function encodeDomainSet(data: DomainSetData): Uint8Array {
  const chunks: Uint8Array[] = [Uint8Array.from([1])];
  chunks.push(writeInt64BE(data.leaves.length));
  for (const word of data.leaves) chunks.push(writeUint64BE(word));
  chunks.push(writeInt64BE(data.labelBitmap.length));
  for (const word of data.labelBitmap) chunks.push(writeUint64BE(word));
  chunks.push(writeInt64BE(data.labels.length));
  chunks.push(Uint8Array.from(data.labels));
  return concatBytes(chunks);
}

export interface DecodedDomainPayload {
  entries: string[];
  /** 负载被完整消费到的偏移量，调用方用它校验尾部无残留。 */
  endOffset: number;
}

/** 解析 domain 负载。 */
export function decodeDomainPayload(payload: Uint8Array, offset = 0): DecodedDomainPayload {
  let cursor = offset;
  const version = payload[cursor];
  cursor += 1;
  if (version !== 1) {
    throw new Error(`不支持的 domain 负载版本：${version}`);
  }

  const readLength = (): number => {
    const length = readInt64BE(payload, cursor);
    cursor += 8;
    if (length < 0) throw new Error('MRS 负载损坏：长度前缀为负数');
    return length;
  };

  const leavesLength = readLength();
  const leaves: bigint[] = [];
  for (let i = 0; i < leavesLength; i++) {
    leaves.push(readUint64BE(payload, cursor));
    cursor += 8;
  }

  const bitmapLength = readLength();
  const labelBitmap: bigint[] = [];
  for (let i = 0; i < bitmapLength; i++) {
    labelBitmap.push(readUint64BE(payload, cursor));
    cursor += 8;
  }

  const labelsLength = readLength();
  const labels: number[] = [];
  for (let i = 0; i < labelsLength; i++) {
    labels.push(payload[cursor + i]);
  }
  cursor += labelsLength;

  return { entries: decodeDomainSet({ leaves, labelBitmap, labels }), endOffset: cursor };
}

/** 把域名列表直接编码为 mihomo 的 domain 负载。 */
export function encodeDomainEntries(entries: readonly string[]): Uint8Array {
  return encodeDomainSet(buildDomainSet(entries));
}
