/**
 * 浏览器侧的 zstd 实现（libzstd wasm）。
 * mihomo 读 .mrs 用的是标准 zstd 帧，因此任何合规实现都能互通。
 */
import { compress as zstdCompress, decompress as zstdDecompress, init as zstdInit } from '@bokuweb/zstd-wasm';
import type { ZstdCodec } from '../core/zstd-port';

let initPromise: Promise<void> | null = null;

export function ensureZstd(): Promise<void> {
  if (initPromise === null) {
    initPromise = zstdInit().catch((error: unknown) => {
      initPromise = null;
      throw new Error(
        `zstd wasm 初始化失败：${error instanceof Error ? error.message : String(error)}。` +
          '如果浏览器禁用了 WebAssembly，请改用仓库里的 .txt 源文件配合官方 mihomo 生成 .mrs。',
      );
    });
  }
  return initPromise;
}

export const browserZstd: ZstdCodec = {
  async compress(data: Uint8Array, level?: number): Promise<Uint8Array> {
    await ensureZstd();
    return zstdCompress(data, level ?? 3);
  },
  async decompress(data: Uint8Array): Promise<Uint8Array> {
    await ensureZstd();
    return zstdDecompress(data);
  },
};
