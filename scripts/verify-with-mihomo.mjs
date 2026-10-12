#!/usr/bin/env node
/**
 * 下载官方 mihomo 二进制到 tools/，然后跑官方交叉验证用例。
 * 用法：pnpm verify:mihomo
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TOOLS_DIR = resolve(ROOT, 'tools');
const IS_WINDOWS = process.platform === 'win32';
const BINARY = resolve(TOOLS_DIR, IS_WINDOWS ? 'mihomo.exe' : 'mihomo');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assetName(tag) {
  if (IS_WINDOWS) return `mihomo-windows-amd64-compatible-${tag}.zip`;
  if (process.platform === 'linux') return `mihomo-linux-amd64-compatible-${tag}.gz`;
  if (process.platform === 'darwin') {
    return `mihomo-darwin-${process.arch === 'arm64' ? 'arm64' : 'amd64'}-${tag}.gz`;
  }
  throw new Error(`不支持的平台：${process.platform}，请手动下载 mihomo 并设置 MIHOMO_BIN`);
}

async function download(url, target) {
  const response = await fetch(url, { headers: { 'user-agent': 'clashmrs-setup' } });
  if (!response.ok) throw new Error(`下载失败 ${response.status} ${response.statusText}：${url}`);
  await writeFile(target, new Uint8Array(await response.arrayBuffer()));
}

async function main() {
  await mkdir(TOOLS_DIR, { recursive: true });

  if (!(await exists(BINARY))) {
    const release = await (
      await fetch('https://api.github.com/repos/MetaCubeX/mihomo/releases/latest', {
        headers: { 'user-agent': 'clashmrs-setup' },
      })
    ).json();
    const tag = release.tag_name;
    if (typeof tag !== 'string') throw new Error('无法获取 mihomo 最新版本号（可能需要网络代理）');

    const name = assetName(tag);
    const asset = (release.assets ?? []).find((item) => item.name === name);
    if (asset === undefined) throw new Error(`release ${tag} 里找不到资源 ${name}`);

    const archive = resolve(TOOLS_DIR, name);
    console.log(`下载 ${name} …`);
    await download(asset.browser_download_url, archive);

    console.log('解压 …');
    // Windows 自带 bsdtar 能处理 zip；*.gz 用 tar -xzf
    execFileSync('tar', ['-xf', archive, '-C', TOOLS_DIR], { stdio: 'inherit' });

    if (!(await exists(BINARY))) {
      // release 里的可执行文件名带版本后缀，例如 mihomo-windows-amd64-compatible.exe
      const { readdir, rename } = await import('node:fs/promises');
      const files = await readdir(TOOLS_DIR);
      const candidate = files.find(
        (file) =>
          file.startsWith('mihomo') &&
          !file.endsWith('.zip') &&
          !file.endsWith('.gz') &&
          (IS_WINDOWS ? file.endsWith('.exe') : true),
      );
      if (candidate === undefined) {
        throw new Error(`解压后没找到 mihomo 可执行文件，目录内容：${files.join(', ')}`);
      }
      await rename(resolve(TOOLS_DIR, candidate), BINARY);
    }
  }

  console.log(`使用二进制：${BINARY}`);
  execFileSync(
    process.execPath,
    [resolve(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'tests/core/mihomo-binary.test.ts'],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, MIHOMO_BIN: BINARY },
    },
  );
}

await main();
