/**
 * 转换 Worker：把「解码 .mrs / 编码 .mrs / 预估负载体积 / 裸 zstd」放到后台线程，
 * 大列表也不会卡住界面。
 */
import type { RuleBehavior } from '../core/mrs';
import { buildMrsPayload, parseMrsPayload } from '../core/mrs';
import { browserZstd } from '../zstd/browser-zstd';

export type ConvertRequest =
  | { id: number; type: 'encode'; entries: string[]; behavior: RuleBehavior }
  | { id: number; type: 'decode'; bytes: Uint8Array }
  | { id: number; type: 'payload-size'; entries: string[]; behavior: RuleBehavior }
  | { id: number; type: 'zstd-compress'; data: Uint8Array }
  | { id: number; type: 'zstd-decompress'; data: Uint8Array };

export type ConvertResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

interface WorkerContext {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const ctx = self as unknown as WorkerContext;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

ctx.onmessage = async (event: MessageEvent) => {
  const request = event.data as ConvertRequest;
  try {
    let result: unknown;
    switch (request.type) {
      case 'encode': {
        const payload = buildMrsPayload(request.entries, request.behavior);
        const bytes = await browserZstd.compress(payload);
        result = { bytes, payloadSize: payload.length };
        break;
      }
      case 'decode': {
        const payload = await browserZstd.decompress(request.bytes);
        result = parseMrsPayload(payload);
        break;
      }
      case 'payload-size': {
        const payload = buildMrsPayload(request.entries, request.behavior);
        result = { payloadSize: payload.length, count: request.entries.length };
        break;
      }
      case 'zstd-compress': {
        result = { bytes: await browserZstd.compress(request.data) };
        break;
      }
      case 'zstd-decompress': {
        result = { bytes: await browserZstd.decompress(request.data) };
        break;
      }
      default: {
        throw new Error(`未知的转换请求：${JSON.stringify(request)}`);
      }
    }
    ctx.postMessage({ id: request.id, ok: true, result } satisfies ConvertResponse);
  } catch (error) {
    ctx.postMessage({ id: request.id, ok: false, error: messageOf(error) } satisfies ConvertResponse);
  }
};
