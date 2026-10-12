import { describe, expect, it } from 'vitest';
import {
  MRS_HEADER_SIZE,
  MRS_MAGIC,
  MrsError,
  buildMrsPayload,
  decodeMrs,
  encodeMrs,
  parseMrsPayload,
} from '../../src/core/mrs';
import { nodeZstd } from '../helpers/node-zstd';

const DOMAINS = ['example.com', '+.example.org', '*.example.net'];
const IPS = ['10.0.0.0/8', '192.168.0.0/16', '2001:db8::/32'];

describe('buildMrsPayload', () => {
  it('domain 头部布局正确', () => {
    const payload = buildMrsPayload(DOMAINS, 'domain');
    expect(Array.from(payload.subarray(0, 4))).toEqual(Array.from(MRS_MAGIC));
    expect(payload[4]).toBe(0);
    expect(payload[5]).toBe(0);
    expect(payload[12]).toBe(DOMAINS.length);
    expect(payload[13]).toBe(0);
    expect(payload[20]).toBe(0);
    expect(payload[MRS_HEADER_SIZE]).toBe(1); // 负载 version
  });

  it('ipcidr 头部布局正确', () => {
    const payload = buildMrsPayload(IPS, 'ipcidr');
    expect(payload[4]).toBe(1);
    expect(payload[12]).toBe(IPS.length);
  });

  it('空列表报错（mihomo 同样不接受空规则集）', () => {
    expect(() => buildMrsPayload([], 'domain')).toThrowError(MrsError);
    try {
      buildMrsPayload([], 'domain');
    } catch (error) {
      expect((error as MrsError).code).toBe('empty');
    }
  });

  it('ipcidr 里混入域名时报 bad-entries', () => {
    try {
      buildMrsPayload(['example.com'], 'ipcidr');
      throw new Error('本应抛错');
    } catch (error) {
      expect((error as MrsError).code).toBe('bad-entries');
    }
  });
});

describe('parseMrsPayload', () => {
  it('domain 往返一致', () => {
    const payload = buildMrsPayload(DOMAINS, 'domain');
    const parsed = parseMrsPayload(payload);
    expect(parsed.behavior).toBe('domain');
    expect(parsed.count).toBe(DOMAINS.length);
    expect(new Set(parsed.entries)).toEqual(
      new Set(['example.com', 'example.org', '.example.org', '*.example.net']),
    );
  });

  it('ipcidr 往返一致（输出 CIDR 文本）', () => {
    const payload = buildMrsPayload(IPS, 'ipcidr');
    const parsed = parseMrsPayload(payload);
    expect(parsed.behavior).toBe('ipcidr');
    expect(parsed.entries).toEqual(['10.0.0.0/8', '192.168.0.0/16', '2001:db8::/32']);
  });

  it('拒绝非 mrs 文件', () => {
    const payload = buildMrsPayload(DOMAINS, 'domain');
    payload[0] = 0x58;
    try {
      parseMrsPayload(payload);
      throw new Error('本应抛错');
    } catch (error) {
      expect((error as MrsError).code).toBe('bad-magic');
    }
  });

  it('拒绝未知版本', () => {
    const payload = buildMrsPayload(DOMAINS, 'domain');
    payload[3] = 2;
    try {
      parseMrsPayload(payload);
      throw new Error('本应抛错');
    } catch (error) {
      expect((error as MrsError).code).toBe('unsupported-version');
    }
  });

  it('classical 行为给出明确提示', () => {
    const payload = buildMrsPayload(DOMAINS, 'domain');
    payload[4] = 2;
    try {
      parseMrsPayload(payload);
      throw new Error('本应抛错');
    } catch (error) {
      expect((error as MrsError).code).toBe('unsupported-behavior');
      expect((error as MrsError).message).toContain('classical');
    }
  });

  it('拒绝被截断的文件', () => {
    try {
      parseMrsPayload(new Uint8Array(10));
      throw new Error('本应抛错');
    } catch (error) {
      expect((error as MrsError).code).toBe('truncated');
    }
  });
});

describe('zstd 包装', () => {
  it('encodeMrs → decodeMrs 往返（Node 内置 zstd 作参考实现）', async () => {
    for (const [behavior, entries] of [
      ['domain', DOMAINS],
      ['ipcidr', IPS],
    ] as const) {
      const bytes = await encodeMrs(entries, behavior, nodeZstd);
      expect(bytes[0]).toBe(0x28); // zstd magic
      expect(bytes[1]).toBe(0xb5);
      const parsed = await decodeMrs(bytes, nodeZstd);
      expect(parsed.behavior).toBe(behavior);
      expect(parsed.count).toBe(entries.length);
    }
  });

  it('解压失败时给出可读错误', async () => {
    try {
      await decodeMrs(Uint8Array.from([1, 2, 3, 4, 5]), nodeZstd);
      throw new Error('本应抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(MrsError);
      expect((error as MrsError).code).toBe('bad-magic');
    }
  });
});
