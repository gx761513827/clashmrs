/**
 * 字节与整数工具：行为对齐 Go 的 `encoding/binary.BigEndian`。
 *
 * mihomo 的 `.mrs` 是 Go 写出来的，所有整数都是大端；
 * 位图是 `[]uint64`，因此这里用 BigInt 数组承载 64 位字。
 */

/** 读 8 字节有符号大端整数（用于 count / 长度前缀，实际值远小于 2^31）。 */
export function readInt64BE(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const hi = view.getInt32(offset);
  const lo = view.getUint32(offset + 4);
  return hi * 0x1_0000_0000 + lo;
}

/** 写 8 字节有符号大端整数。 */
export function writeInt64BE(value: number): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setInt32(0, Math.floor(value / 0x1_0000_0000));
  view.setUint32(4, value >>> 0);
  return out;
}

/** 读 8 字节无符号大端整数（位图字）。 */
export function readUint64BE(buf: Uint8Array, offset: number): bigint {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return (BigInt(view.getUint32(offset)) << 32n) | BigInt(view.getUint32(offset + 4));
}

/** 写 8 字节无符号大端整数（位图字）。 */
export function writeUint64BE(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, Number((value >> 32n) & 0xffffffffn));
  view.setUint32(4, Number(value & 0xffffffffn));
  return out;
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** 按 UTF-8 字节序比较，等价于 Go 的 `sort.Strings`。 */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** 按 UTF-8 字节序比较两个字符串（每次都会编码，排序大量条目时请用 {@link sortByUtf8}）。 */
export function compareUtf8(a: string, b: string): number {
  return compareBytes(utf8Encode(a), utf8Encode(b));
}

/** 用 UTF-8 字节序排序并返回新数组。 */
export function sortByUtf8(values: readonly string[]): string[] {
  const decorated = values.map((value) => ({ value, bytes: utf8Encode(value) }));
  decorated.sort((left, right) => compareBytes(left.bytes, right.bytes));
  return decorated.map((item) => item.value);
}

/** 反向遍历字符串的码点（等价 Go 的 rune 反转，与 mihomo `utils.Reverse` 一致）。 */
export function reverseRunes(text: string): string {
  return Array.from(text).reverse().join('');
}

/** 大端 16 字节 IP（mihomo 用的 `netip.Addr.As16()` 形式）。 */
export function write16Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(16);
  let rest = value;
  for (let i = 15; i >= 0; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

export function read16Bytes(buf: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 16; i++) {
    value = (value << 8n) | BigInt(buf[offset + i]);
  }
  return value;
}
