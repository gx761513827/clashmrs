/**
 * 可选交叉验证：用官方 mihomo 二进制当裁判。
 *
 * 本项目的字节级回归已经用官方发布的 .mrs 作为 ground truth；这个用例再补一层
 * 「官方二进制能读我们生成的文件」——即验证我们的 zstd 帧与负载都被 klauspost 解码器接受。
 *
 * 需要先准备好二进制：
 *   pnpm verify:mihomo        # 自动下载官方 release 到 tools/，再跑本文件
 * 或手动指定：
 *   $env:MIHOMO_BIN="C:\path\to\mihomo.exe"; pnpm vitest run tests/core/mihomo-binary.test.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeDomainEntries } from '../../src/core/domain-set';
import { buildMrsPayload, encodeMrs, parseMrsPayload, type RuleBehavior } from '../../src/core/mrs';
import { nodeZstd } from '../helpers/node-zstd';

const BINARY =
  process.env.MIHOMO_BIN ??
  join(process.cwd(), 'tools', process.platform === 'win32' ? 'mihomo.exe' : 'mihomo');

const DOMAINS = ['example.com', '+.example.org', '*.example.net'];
const IPS = ['10.0.0.0/8', '192.168.0.0/16', '2001:db8::/32'];

describe('官方 mihomo 二进制交叉验证', () => {
  it.skipIf(!existsSync(BINARY))(
    `我们生成的 .mrs 能被 mihomo 读回同样的规则（${BINARY}）`,
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'clashmrs-official-'));
      const cases: [RuleBehavior, string[]][] = [
        ['domain', DOMAINS],
        ['ipcidr', IPS],
      ];

      for (const [behavior, entries] of cases) {
        // 1) 我们编码 → 官方解码
        const ours = join(dir, `${behavior}.mrs`);
        writeFileSync(ours, await encodeMrs(entries, behavior, nodeZstd));
        const dumped = join(dir, `${behavior}.dumped.txt`);
        execFileSync(BINARY, ['convert-ruleset', behavior, 'mrs', ours, dumped]);
        const dumpedEntries = readFileSync(dumped, 'utf8')
          .trim()
          .split(/\r?\n/)
          .filter((line) => line !== '');

        const oursParsed = parseMrsPayload(buildMrsPayload(entries, behavior));
        const expected =
          behavior === 'domain' ? normalizeDomainEntries(oursParsed.entries) : oursParsed.entries;
        expect(new Set(dumpedEntries)).toEqual(new Set(expected));

        // 2) 官方编码 → 负载与我们的逐字节一致
        const source = join(dir, `${behavior}.source.txt`);
        writeFileSync(source, `${entries.join('\n')}\n`);
        const official = join(dir, `${behavior}.official.mrs`);
        execFileSync(BINARY, ['convert-ruleset', behavior, 'text', source, official]);
        const officialPayload = await nodeZstd.decompress(new Uint8Array(readFileSync(official)));
        const ourPayload = buildMrsPayload(entries, behavior);
        expect(Buffer.from(ourPayload).equals(Buffer.from(officialPayload))).toBe(true);
      }
    },
  );

  it('没有二进制时明确说明如何准备', () => {
    if (!existsSync(BINARY)) {
      console.warn(
        `跳过官方二进制交叉验证：找不到 ${BINARY}。运行 pnpm verify:mihomo 自动下载，或设置 MIHOMO_BIN。`,
      );
    }
    expect(true).toBe(true);
  });
});
