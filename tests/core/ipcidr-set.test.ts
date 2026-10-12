import { describe, expect, it } from 'vitest';
import {
  decodeIpPayload,
  encodeIpPayload,
  formatIpValue,
  isMappedV4,
  mergeIpRanges,
  parseIpAddress,
  parseIpOrCidr,
  rangeToCidrs,
  rangesToEntries,
  type IpRange,
} from '../../src/core/ipcidr-set';

const V4_BASE = 0xffffn << 32n;

describe('IP 字面量解析', () => {
  it('解析 IPv4（映射为 ::ffff: 形式）', () => {
    const parsed = parseIpAddress('10.0.0.1');
    expect(parsed).not.toBeNull();
    expect(parsed!.isV6).toBe(false);
    expect(parsed!.value).toBe(V4_BASE | 0x0a000001n);
    expect(isMappedV4(parsed!.value)).toBe(true);
  });

  it.each(['::1', '2001:db8::1', 'fe80::1', '::', '2001:0db8:0000:0000:0000:0000:0000:0001', '::ffff:1.2.3.4'])(
    '解析 IPv6 %s',
    (text) => {
      const parsed = parseIpAddress(text);
      expect(parsed).not.toBeNull();
      expect(parsed!.isV6).toBe(true);
    },
  );

  it.each(['1.2.3', '1.2.3.4.5', '010.1.1.1', '1.2.3.256', 'fe80::1%eth0', 'gggg::1', '1.2.3.4::'])(
    '拒绝非法地址 %s',
    (text) => {
      expect(parseIpAddress(text)).toBeNull();
    },
  );
});

describe('parseIpOrCidr', () => {
  it('解析 IPv4 CIDR', () => {
    const result = parseIpOrCidr('10.0.0.0/8');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.range.start).toBe(V4_BASE | 0x0a000000n);
      expect(result.range.end).toBe(V4_BASE | 0x0affffffn);
    }
  });

  it('解析 IPv6 CIDR', () => {
    const result = parseIpOrCidr('2001:db8::/32');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.range.start).toBe(0x20010db8n << 96n);
      expect(result.range.end).toBe((0x20010db8n << 96n) | ((1n << 96n) - 1n));
    }
  });

  it('单 IP 变成 /32 - /128 区间', () => {
    const result = parseIpOrCidr('1.2.3.4');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.range.start).toBe(result.range.end);
  });

  it('主机位非零时明确报错（比 mihomo 更严格）', () => {
    const result = parseIpOrCidr('10.0.0.1/24');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('host-bits');
  });

  it.each([
    ['1.2.3.4/33', 'invalid-prefix'],
    ['1.2.3.4/xx', 'invalid-prefix'],
    ['not-an-ip', 'invalid-ip'],
    ['1.2.3.4/24/', 'invalid-prefix'],
  ])('拒绝 %s（code=%s）', (text, code) => {
    const result = parseIpOrCidr(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(code);
  });

  it('接受 0 前缀', () => {
    expect(parseIpOrCidr('0.0.0.0/0').ok).toBe(true);
    expect(parseIpOrCidr('::/0').ok).toBe(true);
  });
});

describe('区间合并（对齐 netipx.IPSetBuilder.IPSet）', () => {
  const v4 = (prefix: string): IpRange => {
    const result = parseIpOrCidr(prefix);
    if (!result.ok) throw new Error(prefix);
    return result.range;
  };

  it('合并相邻与重叠段', () => {
    const merged = mergeIpRanges([v4('1.0.0.0/25'), v4('1.0.0.128/25'), v4('1.0.0.0/24')]);
    expect(merged).toHaveLength(1);
    expect(formatIpValue(merged[0].start, false)).toBe('1.0.0.0');
    expect(formatIpValue(merged[0].end, false)).toBe('1.0.0.255');
  });

  it('不相邻的段保持分开', () => {
    const merged = mergeIpRanges([v4('1.0.0.0/24'), v4('1.0.2.0/24')]);
    expect(merged).toHaveLength(2);
  });

  it('v4 段整体排在 v6 段之前', () => {
    const v6 = parseIpOrCidr('::1/128');
    expect(v6.ok).toBe(true);
    const merged = mergeIpRanges([(v6 as { ok: true; range: IpRange }).range, v4('1.0.0.0/24')]);
    expect(merged).toHaveLength(2);
    expect(merged[0].isV6).toBe(false);
    expect(merged[1].isV6).toBe(true);
  });
});

describe('区间 → CIDR', () => {
  it('整段对齐时是一个 CIDR', () => {
    const cidrs = rangeToCidrs(0n, 0xffffffffn, false);
    expect(cidrs).toHaveLength(1);
    expect(cidrs[0].prefix).toBe(0);
  });

  it('拆分结果精确覆盖原区间且互不重叠', () => {
    const start = 0x01020300n;
    const end = 0x01020381n; // 1.2.3.0 - 1.2.3.129
    const cidrs = rangeToCidrs(start, end, false);
    let total = 0n;
    let expected = start;
    for (const cidr of cidrs) {
      const size = 1n << BigInt(32 - cidr.prefix);
      expect(cidr.value).toBe(expected);
      total += size;
      expected += size;
    }
    expect(total).toBe(end - start + 1n);
  });

  it('rangesToEntries 输出 CIDR 文本', () => {
    const range = parseIpOrCidr('10.0.0.0/8');
    expect(range.ok).toBe(true);
    if (range.ok) expect(rangesToEntries([range.range])).toEqual(['10.0.0.0/8']);
  });
});

describe('ipcidr 负载编解码', () => {
  it('往返一致', () => {
    const ranges = [parseIpOrCidr('10.0.0.0/8'), parseIpOrCidr('2001:db8::/32')].map((result) => {
      if (!result.ok) throw new Error('fixture');
      return result.range;
    });
    const payload = encodeIpPayload(ranges);
    expect(payload[0]).toBe(1);
    const decoded = decodeIpPayload(payload);
    expect(decoded.endOffset).toBe(payload.length);
    expect(decoded.ranges).toEqual(ranges);
    expect(decoded.ranges[0].isV6).toBe(false);
    expect(decoded.ranges[1].isV6).toBe(true);
  });
});

describe('formatIpValue', () => {
  it('IPv6 使用 RFC 5952 压缩', () => {
    const parsed = parseIpAddress('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(formatIpValue(parsed!.value, true)).toBe('2001:db8::1');
    expect(formatIpValue(parseIpAddress('::1')!.value, true)).toBe('::1');
    expect(formatIpValue(parseIpAddress('2001:db8:1:2:3:4:5:6')!.value, true)).toBe('2001:db8:1:2:3:4:5:6');
  });
});
