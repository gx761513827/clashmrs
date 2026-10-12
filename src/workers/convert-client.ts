/**
 * Worker 客户端：Promise 化封装，并提供 {@link workerZstd} 让 core 的编解码走后台线程。
 * Worker 不可用时（少数环境）自动退回主线程 wasm 实现。
 */
import type { ParsedMrs, RuleBehavior } from '../core/mrs';
import { buildMrsPayload, parseMrsPayload } from '../core/mrs';
import type { ZstdCodec } from '../core/zstd-port';
import { browserZstd } from '../zstd/browser-zstd';
import type { ConvertRequest, ConvertResponse } from './convert.worker';

type RequestPayload =
  | { type: 'encode'; entries: string[]; behavior: RuleBehavior }
  | { type: 'decode'; bytes: Uint8Array }
  | { type: 'payload-size'; entries: string[]; behavior: RuleBehavior }
  | { type: 'zstd-compress'; data: Uint8Array }
  | { type: 'zstd-decompress'; data: Uint8Array };

export interface EncodeResult {
  bytes: Uint8Array;
  payloadSize: number;
}

export interface PayloadSizeResult {
  payloadSize: number;
  count: number;
}

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as ConvertResponse;
      const entry = pending.get(data.id);
      if (entry === undefined) return;
      pending.delete(data.id);
      if (data.ok) entry.resolve(data.result);
      else entry.reject(new Error(data.error));
    });
    worker.addEventListener('error', () => {
      workerFailed = true;
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(new Error('转换 Worker 启动失败，已回退到主线程处理'));
      }
    });
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

async function call<T>(request: RequestPayload): Promise<T> {
  const instance = getWorker();
  if (instance === null) throw new Error('worker-unavailable');

  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    instance.postMessage({ id, ...request } satisfies ConvertRequest);
  });
}

async function withFallback<T>(request: RequestPayload, inline: () => Promise<T>): Promise<T> {
  try {
    return await call<T>(request);
  } catch (error) {
    if (error instanceof Error && error.message === 'worker-unavailable') return inline();
    throw error;
  }
}

export function encodeInWorker(entries: string[], behavior: RuleBehavior): Promise<EncodeResult> {
  return withFallback<EncodeResult>({ type: 'encode', entries, behavior }, async () => {
    const payload = buildMrsPayload(entries, behavior);
    return { bytes: await browserZstd.compress(payload), payloadSize: payload.length };
  });
}

export function decodeInWorker(bytes: Uint8Array): Promise<ParsedMrs> {
  return withFallback<ParsedMrs>({ type: 'decode', bytes }, async () =>
    parseMrsPayload(await browserZstd.decompress(bytes)),
  );
}

export function payloadSizeInWorker(
  entries: string[],
  behavior: RuleBehavior,
): Promise<PayloadSizeResult> {
  return withFallback<PayloadSizeResult>({ type: 'payload-size', entries, behavior }, async () => {
    const payload = buildMrsPayload(entries, behavior);
    return { payloadSize: payload.length, count: entries.length };
  });
}

/** 给 core 用的 zstd 端口：压缩/解压都在 Worker 里做。 */
export const workerZstd: ZstdCodec = {
  async compress(data: Uint8Array): Promise<Uint8Array> {
    const result = await withFallback<{ bytes: Uint8Array }>({ type: 'zstd-compress', data }, async () => ({
      bytes: await browserZstd.compress(data),
    }));
    return result.bytes;
  },
  async decompress(data: Uint8Array): Promise<Uint8Array> {
    const result = await withFallback<{ bytes: Uint8Array }>({ type: 'zstd-decompress', data }, async () => ({
      bytes: await browserZstd.decompress(data),
    }));
    return result.bytes;
  },
};
