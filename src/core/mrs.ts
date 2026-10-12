/**
 * mihomo `.mrs`（MRSv1）容器编解码。
 *
 * 布局（对齐 `rules/provider/mrs_converter.go` + `mrs_reader.go`）：
 *   [整个文件由 zstd 帧包裹]
 *   magic      4B  = "MRS" + 0x01
 *   behavior   1B  = 0:domain 1:ipcidr 2:classical(不支持)
 *   count      8B  int64 BE（规则条数，mihomo 用它做展示，不参与匹配）
 *   extraLen   8B  int64 BE（保留字段，当前恒为 0）
 *   extra      N B
 *   body           = domain / ipcidr 各自的负载
 */
import { concatBytes, readInt64BE, writeInt64BE } from './bytes';
import { buildDomainSet, decodeDomainPayload, encodeDomainSet } from './domain-set';
import {
  decodeIpPayload,
  encodeIpPayload,
  mergeIpRanges,
  parseIpOrCidr,
  rangesToEntries,
  type IpRange,
} from './ipcidr-set';
import type { ZstdCodec } from './zstd-port';

export const MRS_MAGIC = Uint8Array.from([0x4d, 0x52, 0x53, 0x01]);
export const MRS_HEADER_SIZE = 21;

export type RuleBehavior = 'domain' | 'ipcidr';

export type MrsErrorCode =
  | 'empty'
  | 'bad-entries'
  | 'bad-magic'
  | 'unsupported-version'
  | 'unsupported-behavior'
  | 'truncated';

export class MrsError extends Error {
  constructor(
    message: string,
    readonly code: MrsErrorCode,
  ) {
    super(message);
    this.name = 'MrsError';
  }
}

export function behaviorToByte(behavior: RuleBehavior): number {
  return behavior === 'domain' ? 0 : 1;
}

export function byteToBehavior(byte: number): RuleBehavior | null {
  if (byte === 0) return 'domain';
  if (byte === 1) return 'ipcidr';
  return null;
}

/** 把条目解析成归一化后的区间（供 ipcidr 编码使用，非法条目会抛错）。 */
export function entriesToIpRanges(entries: readonly string[]): IpRange[] {
  const ranges: IpRange[] = [];
  for (const entry of entries) {
    const parsed = parseIpOrCidr(entry);
    if (!parsed.ok) {
      throw new MrsError(`条目「${entry}」不是合法的 IP/CIDR：${parsed.reason}`, 'bad-entries');
    }
    ranges.push(parsed.range);
  }
  return mergeIpRanges(ranges);
}

/**
 * 生成未压缩的 MRS 负载。
 * `count` 采用 mihomo 语义：等于输入的规则条数（每条规则算 1，行为内部的展开不计）。
 */
export function buildMrsPayload(entries: readonly string[], behavior: RuleBehavior): Uint8Array {
  if (entries.length === 0) {
    throw new MrsError('规则列表为空，mihomo 不接受空规则集', 'empty');
  }

  const body =
    behavior === 'domain'
      ? encodeDomainSet(buildDomainSet(entries))
      : encodeIpPayload(entriesToIpRanges(entries));

  const header = concatBytes([
    MRS_MAGIC,
    Uint8Array.from([behaviorToByte(behavior)]),
    writeInt64BE(entries.length),
    writeInt64BE(0),
  ]);

  return concatBytes([header, body]);
}

export interface ParsedMrs {
  behavior: RuleBehavior;
  /** 文件头里记录的规则条数（mihomo 的 `RuleProvider.Count()`）。 */
  count: number;
  entries: string[];
}

/** 解析未压缩的 MRS 负载。 */
export function parseMrsPayload(payload: Uint8Array): ParsedMrs {
  if (payload.length < MRS_HEADER_SIZE) {
    throw new MrsError('文件太小，不像是 .mrs 规则集', 'truncated');
  }
  const magic = payload.subarray(0, 4);
  if (magic[0] !== 0x4d || magic[1] !== 0x52 || magic[2] !== 0x53) {
    throw new MrsError('不是 mihomo 的 .mrs 文件（magic 不匹配）', 'bad-magic');
  }
  if (magic[3] !== 0x01) {
    throw new MrsError(
      `不支持的 .mrs 版本：MRSv${magic[3]}（本工具只支持 MRSv1）`,
      'unsupported-version',
    );
  }

  const behaviorByte = payload[4];
  const behavior = byteToBehavior(behaviorByte);
  if (behavior === null) {
    throw new MrsError(
      behaviorByte === 2
        ? 'mihomo 本身不支持 classical 行为的 .mrs，无法编辑'
        : `未知的 behavior 取值：${behaviorByte}`,
      'unsupported-behavior',
    );
  }

  const count = readInt64BE(payload, 5);
  const extraLength = readInt64BE(payload, 13);
  if (extraLength < 0) {
    throw new MrsError('MRS 头部损坏：extra 长度为负数', 'truncated');
  }
  const bodyOffset = MRS_HEADER_SIZE + extraLength;
  if (bodyOffset > payload.length) {
    throw new MrsError('MRS 文件被截断：extra 段长度超出文件末尾', 'truncated');
  }

  const entries =
    behavior === 'domain'
      ? decodeDomainPayload(payload, bodyOffset).entries
      : rangesToEntries(decodeIpPayload(payload, bodyOffset).ranges);

  return { behavior, count, entries };
}

/** 生成最终写入仓库的 `.mrs` 字节（zstd 压缩）。 */
export async function encodeMrs(
  entries: readonly string[],
  behavior: RuleBehavior,
  zstd: ZstdCodec,
): Promise<Uint8Array> {
  const payload = buildMrsPayload(entries, behavior);
  return zstd.compress(payload);
}

/** 解析仓库里的 `.mrs` 字节。 */
export async function decodeMrs(bytes: Uint8Array, zstd: ZstdCodec): Promise<ParsedMrs> {
  let payload: Uint8Array;
  try {
    payload = await zstd.decompress(bytes);
  } catch (error) {
    throw new MrsError(
      `解压失败，文件可能不是标准 zstd 帧或已损坏：${error instanceof Error ? error.message : String(error)}`,
      'bad-magic',
    );
  }
  return parseMrsPayload(payload);
}
