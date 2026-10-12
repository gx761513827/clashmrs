import type { FetchLike } from '../../src/github/client';

export interface RecordedCall {
  method: string;
  url: URL;
  body: unknown;
  headers: Record<string, string>;
  /** 便于断言：`METHOD /path`，path 已做 URL 解码（例如 ref 里的 heads%2Fmain → heads/main） */
  key: string;
}

export interface FakeGitHub {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
  callKeys: () => string[];
  countOf: (key: string) => number;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function bytesResponse(body: Uint8Array, status = 200): Response {
  const buffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  return new Response(buffer, { status, headers: { 'content-type': 'application/octet-stream' } });
}

/**
 * 路由式假 GitHub：key 形如 `POST /repos/o/r/git/blobs`，
 * 未匹配到的请求返回 500，避免测试静默通过。
 */
export function createFakeGitHub(
  routes: Record<string, (call: RecordedCall) => Response | Promise<Response>>,
): FakeGitHub {
  const calls: RecordedCall[] = [];

  const fetchImpl: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${decodeURIComponent(parsed.pathname)}`;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      headers[name.toLowerCase()] = value;
    }
    let body: unknown = undefined;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = { method, url: parsed, body, headers, key };
    calls.push(call);

    const handler = routes[key];
    if (handler === undefined) {
      return jsonResponse({ message: `未预期的请求：${key}` }, 500);
    }
    return handler(call);
  };

  return {
    fetchImpl,
    calls,
    callKeys: () => calls.map((call) => call.key),
    countOf: (key: string) => calls.filter((call) => call.key === key).length,
  };
}
