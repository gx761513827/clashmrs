#!/usr/bin/env node
/**
 * 下载官方发布的真实 .mrs / .list 作为字节级回归的 ground truth。
 *
 * 数据来源：MetaCubeX/meta-rules-dat 的 `meta` 分支（由官方 mihomo 转换链生成）。
 * 只用于本地/CI 测试，不写入仓库（tests/fixtures/ 已在 .gitignore 中），
 * 因此不会把上游数据固化进本项目。README 有数据来源说明。
 *
 * 用法：node scripts/fetch-fixtures.mjs [--force]
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT_DIR = resolve(ROOT, 'tests', 'fixtures');

const MIRRORS = [
  'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/',
  'https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/',
];

/** 与 tests/core/fixtures.test.ts 保持一致：{ 目录, 名字, behavior } */
const FIXTURES = [
  { dir: 'geo/geosite', name: 'category-ads-all', behavior: 'domain' },
  { dir: 'asn', name: 'AS1', behavior: 'ipcidr' },
  { dir: 'geo/geoip', name: 'private', behavior: 'ipcidr' },
  { dir: 'geo/geoip', name: 'telegram', behavior: 'ipcidr' },
  { dir: 'geo/geoip', name: 'google', behavior: 'ipcidr' },
  { dir: 'asn', name: 'AS13335', behavior: 'ipcidr' },
  { dir: 'asn', name: 'AS15169', behavior: 'ipcidr' },
  { dir: 'geo/geoip', name: 'cn', behavior: 'ipcidr' },
];

const force = process.argv.includes('--force');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(relativePath, targetPath) {
  if (!force && (await exists(targetPath))) {
    console.log(`  = 已有 ${relativePath}`);
    return true;
  }
  let lastError = null;
  for (const mirror of MIRRORS) {
    try {
      const response = await fetch(`${mirror}${relativePath}`, {
        headers: { 'user-agent': 'clashmrs-fixture-fetch' },
      });
      if (!response.ok) {
        lastError = new Error(`${response.status} ${response.statusText}`);
        continue;
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, buffer);
      console.log(`  + ${relativePath} (${buffer.length} 字节, 来自 ${new URL(mirror).host})`);
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  console.error(`  ! 下载失败 ${relativePath}: ${lastError?.message ?? lastError}`);
  return false;
}

async function main() {
  console.log(`下载官方 fixture 到 ${OUT_DIR}`);
  let failed = 0;
  for (const fixture of FIXTURES) {
    for (const extension of ['mrs', 'list']) {
      const relative = `${fixture.dir}/${fixture.name}.${extension}`;
      const ok = await download(relative, resolve(OUT_DIR, fixture.dir, `${fixture.name}.${extension}`));
      if (!ok) failed++;
    }
  }
  if (failed > 0) {
    console.error(`\n有 ${failed} 个文件下载失败；测试会自动跳过 fixture 回归。`);
    process.exitCode = 1;
    return;
  }
  console.log('\n全部 fixture 就绪。');
}

await main();
