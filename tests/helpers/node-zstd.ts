import * as zlib from 'node:zlib';
import type { ZstdCodec } from '../../src/core/zstd-port';

type NodeZstd = {
  zstdCompressSync?: (data: Uint8Array) => Buffer;
  zstdDecompressSync?: (data: Uint8Array) => Buffer;
};

const codec = zlib as unknown as NodeZstd;

if (typeof codec.zstdCompressSync !== 'function' || typeof codec.zstdDecompressSync !== 'function') {
  throw new Error('当前 Node 不支持 zstd（需要 Node >= 22.15，本项目在 Node 24 上验证）');
}

/** 测试用 zstd 实现：Node 内置 zstd（与浏览器里的 libzstd wasm 同规范）。 */
export const nodeZstd: ZstdCodec = {
  async compress(data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(codec.zstdCompressSync!(data));
  },
  async decompress(data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(codec.zstdDecompressSync!(data));
  },
};
