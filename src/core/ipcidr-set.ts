/**
 * IP / CIDR 规则集（behavior=ipcidr）的区间编解码。
 *
 * 行为对齐 mihomo：`netip.ParsePrefix` + `netipx.RangeOfPrefix` + `IPSetBuilder.IPSet()`
 * （排序、合并重叠与相邻段、v4 段整体排在 v6 段之前），
 * 写入形式对齐 `component/cidr/ipcidr_set_bin.go`：
 * version(1) + 区间数(int64 BE) + 每段 from/to 各 16 字节 BE。
 *
 * 注意：mihomo 把 IPv4 写成 `::ffff:a.b.c.d`（`netip.Addr.As16()`）。
 */
import {
  concatBytes,
  read16Bytes,
  readInt64BE,
  write16Bytes,
  writeInt64BE,
} from './bytes';

/** 存储表示：128 位大端值；IPv4 用 `::ffff:` 映射形式。 */
const V4_MAPPED_BASE = 0xffffn << 32n;
const V4_MASK = 0xffffffffn;

export interface IpRange {
  start: bigint;
  end: bigint;
  isV6: boolean;
}

export type IpErrorCode = 'invalid-ip' | 'invalid-prefix' | 'host-bits';

export interface ParsedIp {
  value: bigint;
  isV6: boolean;
}

function parseV4(text: string): bigint | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (match === null) return null;
  let value = 0n;
  for (let i = 1; i <= 4; i++) {
    const part = match[i];
    // netip 拒绝前导零（"010.1.1.1" 非法）
    if (part.length > 1 && part.startsWith('0')) return null;
    const byte = Number(part);
    if (byte > 255) return null;
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

function parseV6(text: string): bigint | null {
  if (!text.includes(':')) return null;
  if (text.includes('%')) return null; // 不支持 zone

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const headText = halves[0];
  const tailText = halves.length === 2 ? halves[1] : null;
  // "1.2.3.4::" 这类写法非法：内嵌 IPv4 必须出现在最末尾
  if (tailText !== null && headText.includes('.')) return null;

  const splitGroups = (source: string): string[] | null => {
    if (source === '') return [];
    const rawGroups = source.split(':');
    const groups: string[] = [];
    for (let i = 0; i < rawGroups.length; i++) {
      const group = rawGroups[i];
      if (group.includes('.')) {
        if (i !== rawGroups.length - 1) return null;
        const v4 = parseV4(group);
        if (v4 === null) return null;
        groups.push(((v4 >> 16n) & 0xffffn).toString(16).padStart(4, '0'));
        groups.push((v4 & 0xffffn).toString(16).padStart(4, '0'));
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
        groups.push(group);
      }
    }
    return groups;
  };

  const head = splitGroups(headText);
  if (head === null) return null;
  const tail = tailText === null ? null : splitGroups(tailText);
  if (tailText !== null && tail === null) return null;

  let groups: string[];
  if (tail === null) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  }
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(parseInt(group, 16));
  return value;
}

/** 解析单个 IP 字面量（IPv4 返回 `::ffff:` 映射形式）。 */
export function parseIpAddress(text: string): ParsedIp | null {
  const v4 = parseV4(text);
  if (v4 !== null) return { value: V4_MAPPED_BASE | v4, isV6: false };
  const v6 = parseV6(text);
  if (v6 !== null) return { value: v6, isV6: true };
  return null;
}

/** 判断存储形式的 128 位值是否落在 IPv4 映射块内。 */
export function isMappedV4(value: bigint): boolean {
  return value >> 32n === 0xffffn;
}

/** 取出 v4 的自然 32 位值；传入非映射值时行为未定义。 */
export function naturalValue(value: bigint, isV6: boolean): bigint {
  return isV6 ? value : value & V4_MASK;
}

export function fromNaturalValue(value: bigint, isV6: boolean): bigint {
  return isV6 ? value : V4_MAPPED_BASE | value;
}

export type IpParseResult =
  | { ok: true; range: IpRange }
  | { ok: false; code: IpErrorCode; reason: string };

/** 解析 `1.2.3.4`、`1.2.3.0/24`、`2001:db8::/32` 等条目。 */
export function parseIpOrCidr(text: string): IpParseResult {
  const slash = text.indexOf('/');
  if (slash < 0) {
    const parsed = parseIpAddress(text);
    if (parsed === null) {
      return { ok: false, code: 'invalid-ip', reason: `不是合法的 IP 地址：${text}` };
    }
    return { ok: true, range: { start: parsed.value, end: parsed.value, isV6: parsed.isV6 } };
  }

  const addressText = text.slice(0, slash);
  const prefixText = text.slice(slash + 1);
  const parsed = parseIpAddress(addressText);
  if (parsed === null) {
    return { ok: false, code: 'invalid-ip', reason: `不是合法的 IP 地址：${addressText}` };
  }
  if (!/^\d{1,3}$/.test(prefixText)) {
    return { ok: false, code: 'invalid-prefix', reason: `前缀长度非法：${text}` };
  }
  const prefix = Number(prefixText);
  const bits = parsed.isV6 ? 128 : 32;
  if (prefix < 0 || prefix > bits) {
    return { ok: false, code: 'invalid-prefix', reason: `前缀长度必须在 0-${bits} 之间：${text}` };
  }

  const hostBits = bits - prefix;
  const mask = hostBits === 0 ? 0n : (1n << BigInt(hostBits)) - 1n;
  const natural = naturalValue(parsed.value, parsed.isV6);
  if ((natural & mask) !== 0n) {
    return {
      ok: false,
      code: 'host-bits',
      reason: `CIDR 的主机位必须为 0：${text}（网络地址应写成 ${
        parsed.isV6 ? '2001:db8::/32' : '10.0.0.0/24'
      } 这样的形式）`,
    };
  }

  return {
    ok: true,
    range: {
      start: fromNaturalValue(natural, parsed.isV6),
      end: fromNaturalValue(natural | mask, parsed.isV6),
      isV6: parsed.isV6,
    },
  };
}

function compareRange(left: IpRange, right: IpRange): number {
  if (left.start !== right.start) return left.start < right.start ? -1 : 1;
  if (left.end !== right.end) return left.end < right.end ? -1 : 1;
  return 0;
}

/**
 * 归一化区间：族内排序 + 合并重叠/相邻段；v4 段整体在 v6 段之前。
 * 与 `netipx.IPSetBuilder.IPSet()` 的输出顺序一致（byte-identical 回归测试覆盖）。
 */
export function mergeIpRanges(ranges: readonly IpRange[]): IpRange[] {
  const out: IpRange[] = [];
  for (const isV6 of [false, true]) {
    const list = ranges.filter((range) => range.isV6 === isV6).slice().sort(compareRange);
    let current: IpRange | null = null;
    for (const range of list) {
      if (current === null) {
        current = { ...range };
        continue;
      }
      if (range.start <= current.end + 1n) {
        if (range.end > current.end) current.end = range.end;
      } else {
        out.push(current);
        current = { ...range };
      }
    }
    if (current !== null) out.push(current);
  }
  return out;
}

/** 把区间拆成最小 CIDR 集合（等价 `netipx.IPRange.Prefixes()`）。 */
export function rangeToCidrs(
  start: bigint,
  end: bigint,
  isV6: boolean,
): { value: bigint; prefix: number }[] {
  const bits = isV6 ? 128 : 32;
  let current = naturalValue(start, isV6);
  const last = naturalValue(end, isV6);
  const out: { value: bigint; prefix: number }[] = [];

  while (current <= last) {
    let align = bits;
    let probe = current;
    let zeros = 0;
    while (probe !== 0n && (probe & 1n) === 0n && zeros < bits) {
      zeros++;
      probe >>= 1n;
    }
    align = current === 0n ? bits : zeros;

    const size = last - current + 1n;
    let sizeBits = 0;
    let power = 1n;
    while (power * 2n <= size && sizeBits < bits) {
      power *= 2n;
      sizeBits++;
    }

    const hostBits = Math.min(align, sizeBits);
    out.push({ value: current, prefix: bits - hostBits });
    current += 1n << BigInt(hostBits);

    if (out.length > 500_000) {
      throw new Error('IP 区间展开出的 CIDR 过多，请检查输入');
    }
  }

  return out;
}

/** 格式化 IP（IPv6 采用 RFC 5952 的 `::` 压缩写法）。 */
export function formatIpValue(value: bigint, isV6: boolean): string {
  if (!isV6) {
    const natural = value & V4_MASK;
    return [24n, 16n, 8n, 0n].map((shift) => ((natural >> shift) & 0xffn).toString()).join('.');
  }
  const groups: number[] = [];
  for (let i = 0; i < 8; i++) {
    groups.push(Number((value >> BigInt((7 - i) * 16)) & 0xffffn));
  }
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  let runLength = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (runStart < 0) runStart = i;
      runLength++;
      if (runLength > bestLength) {
        bestLength = runLength;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
      runLength = 0;
    }
  }
  if (bestLength < 2) return groups.map((group) => group.toString(16)).join(':');
  const head = groups.slice(0, bestStart).map((group) => group.toString(16)).join(':');
  const tail = groups.slice(bestStart + bestLength).map((group) => group.toString(16)).join(':');
  return `${head}::${tail}`;
}

/** 区间 → 文本条目（CIDR 列表），与 mihomo `DumpMrs` 的输出口径一致。 */
export function rangesToEntries(ranges: readonly IpRange[]): string[] {
  const out: string[] = [];
  for (const range of ranges) {
    for (const cidr of rangeToCidrs(range.start, range.end, range.isV6)) {
      out.push(`${formatIpValue(cidr.value, range.isV6)}/${cidr.prefix}`);
    }
  }
  return out;
}

/** 把区间列表编码成 mihomo 的 ipcidr 负载。 */
export function encodeIpPayload(ranges: readonly IpRange[]): Uint8Array {
  const chunks: Uint8Array[] = [Uint8Array.from([1]), writeInt64BE(ranges.length)];
  for (const range of ranges) {
    chunks.push(write16Bytes(range.start));
    chunks.push(write16Bytes(range.end));
  }
  return concatBytes(chunks);
}

export interface DecodedIpPayload {
  ranges: IpRange[];
  endOffset: number;
}

export function decodeIpPayload(payload: Uint8Array, offset = 0): DecodedIpPayload {
  let cursor = offset;
  const version = payload[cursor];
  cursor += 1;
  if (version !== 1) throw new Error(`不支持的 ipcidr 负载版本：${version}`);

  const count = readInt64BE(payload, cursor);
  cursor += 8;
  if (count < 0) throw new Error('MRS 负载损坏：区间数为负数');

  const ranges: IpRange[] = [];
  for (let i = 0; i < count; i++) {
    const start = read16Bytes(payload, cursor);
    cursor += 16;
    const end = read16Bytes(payload, cursor);
    cursor += 16;
    ranges.push({ start, end, isV6: !isMappedV4(start) });
  }

  return { ranges, endOffset: cursor };
}
