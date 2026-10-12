/**
 * 字节级回归：拿官方 mihomo 转换链生成的真实 .mrs 当 ground truth。
 *
 * 断言两件事：
 *  1. 解码官方 .mrs → 重新编码 → 未压缩负载与官方文件逐字节相同；
 *  2. 用官方 .list 源文件直接编码 → 负载同样逐字节相同，且头部 count 与官方一致。
 *
 * 这证明本项目自研的 MRSv1 编码器与 `mihomo convert-ruleset` 完全等价
 * （包括 DAFSA 位图、域名反转、IP 区间合并与排序）。
 *
 * fixtures 由 `pnpm fixtures` 下载到 tests/fixtures/（gitignore），未下载时自动跳过。
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildMrsPayload, decodeMrs, parseMrsPayload, type RuleBehavior } from '../../src/core/mrs';
import { normalizeDomainEntries } from '../../src/core/domain-set';
import { normalizeList } from '../../src/core/rules';
import { nodeZstd } from '../helpers/node-zstd';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, '..', 'fixtures');

const FIXTURES: { dir: string; name: string; behavior: RuleBehavior }[] = [
  { dir: 'geo/geosite', name: 'category-ads-all', behavior: 'domain' },
  { dir: 'asn', name: 'AS1', behavior: 'ipcidr' },
  { dir: 'geo/geoip', name: 'private', behavior: 'ipcidr' },
  { dir: 'geo/geoip', name: 'telegram', behavior: 'ipcidr' },
  { dir: 'geo/geoip', name: 'google', behavior: 'ipcidr' },
  { dir: 'asn', name: 'AS13335', behavior: 'ipcidr' },
  { dir: 'asn', name: 'AS15169', behavior: 'ipcidr' },
  { dir: 'geo/geoip', name: 'cn', behavior: 'ipcidr' },
];

async function load(relativePath: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(resolve(FIXTURE_DIR, relativePath)));
  } catch {
    return null;
  }
}

function assertSameBytes(actual: Uint8Array, expected: Uint8Array, label: string): void {
  if (actual.length !== expected.length) {
    throw new Error(`${label}：长度不同（实际 ${actual.length}，期望 ${expected.length}）`);
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `${label}：第 ${i} 字节不同（实际 0x${actual[i].toString(16).padStart(2, '0')}，期望 0x${expected[
          i
        ].toString(16).padStart(2, '0')}）`,
      );
    }
  }
}

describe('官方 .mrs fixture 字节级回归', () => {
  for (const fixture of FIXTURES) {
    const path = `${fixture.dir}/${fixture.name}.mrs`;
    const listPath = `${fixture.dir}/${fixture.name}.list`;

    it(`${path} 重新编码后负载与官方一致`, async () => {
      const mrsBytes = await load(path);
      const listBytes = await load(listPath);
      if (mrsBytes === null || listBytes === null) {
        console.warn(`跳过 ${path}：fixture 缺失，请先运行 pnpm fixtures`);
        return;
      }

      const officialPayload = await nodeZstd.decompress(mrsBytes);
      const parsed = await decodeMrs(mrsBytes, nodeZstd);
      expect(parsed.behavior).toBe(fixture.behavior);

      // 路径 A：解码 → 压紧 → 重新编码
      const decodedEntries =
        fixture.behavior === 'domain' ? normalizeDomainEntries(parsed.entries) : parsed.entries;
      const payloadFromDecode = buildMrsPayload(decodedEntries, fixture.behavior);
      assertSameBytes(payloadFromDecode, officialPayload, `${path} 解码后重编码`);

      // 路径 B：官方 .list 源 → 编码（同时校验 count 语义）
      const listText = new TextDecoder().decode(listBytes);
      const listResult = normalizeList(listText);
      expect(listResult.issues).toHaveLength(0);
      const payloadFromList = buildMrsPayload(listResult.entries, fixture.behavior);
      const parsedFromList = parseMrsPayload(payloadFromList);
      expect(parsedFromList.count).toBe(parsed.count);
      assertSameBytes(payloadFromList, officialPayload, `${path} 由 .list 编码`);
    });
  }

  it('fixture 集合完整，不存在“部分下载”的中间态', async () => {
    const available = await Promise.all(
      FIXTURES.map(async (fixture) => (await load(`${fixture.dir}/${fixture.name}.mrs`)) !== null),
    );
    const count = available.filter(Boolean).length;
    if (count === 0) {
      console.warn('警告：没有任何 fixture，字节级回归没有真正执行（运行 pnpm fixtures 后重试）');
    }
    // 0 = 离线跳过；FIXTURES.length = 全部就绪；其余视为 fixture 状态不一致
    expect([0, FIXTURES.length]).toContain(count);
  });
});
