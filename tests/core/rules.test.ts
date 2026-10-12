import { describe, expect, it } from 'vitest';
import {
  detectBehavior,
  diffEntries,
  normalizeList,
  normalizeToken,
  serializeTextFile,
  splitByBehavior,
  stripComment,
} from '../../src/core/rules';

describe('normalizeToken', () => {
  it('保留合法域名并小写化', () => {
    expect(normalizeToken('Example.COM')).toEqual({ ok: true, entries: ['example.com'] });
    expect(normalizeToken('*.Example.com')).toEqual({ ok: true, entries: ['*.example.com'] });
    expect(normalizeToken('+.Example.com')).toEqual({ ok: true, entries: ['+.example.com'] });
    expect(normalizeToken('.Example.com')).toEqual({ ok: true, entries: ['.example.com'] });
  });

  it('从 URL 里取出 host', () => {
    expect(normalizeToken('https://user:pass@WWW.Example.com:8443/path?q=1#x')).toEqual({
      ok: true,
      entries: ['www.example.com'],
    });
    expect(normalizeToken('http://example.com/')).toEqual({ ok: true, entries: ['example.com'] });
  });

  it('去掉路径与端口', () => {
    expect(normalizeToken('example.com/path/to/page')).toEqual({ ok: true, entries: ['example.com'] });
    expect(normalizeToken('example.com:8080')).toEqual({ ok: true, entries: ['example.com'] });
  });

  it('保留 IP / CIDR', () => {
    expect(normalizeToken('1.2.3.4')).toEqual({ ok: true, entries: ['1.2.3.4'] });
    expect(normalizeToken('10.0.0.0/8')).toEqual({ ok: true, entries: ['10.0.0.0/8'] });
    expect(normalizeToken('2001:db8::/32')).toEqual({ ok: true, entries: ['2001:db8::/32'] });
  });

  it('把 IP 区间拆成 CIDR', () => {
    expect(normalizeToken('1.2.3.0-1.2.3.255')).toEqual({ ok: true, entries: ['1.2.3.0/24'] });
    const partial = normalizeToken('1.2.3.0-1.2.3.129');
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.entries.length).toBeGreaterThan(1);
      expect(partial.entries[0]).toBe('1.2.3.0/25');
    }
  });

  it('域名里的连字符不会被误判为 IP 区间', () => {
    expect(normalizeToken('foo-bar.example.com')).toEqual({ ok: true, entries: ['foo-bar.example.com'] });
  });

  it.each([
    ['', 'empty'],
    ['example.com.', 'trailing-dot'],
    ['a..b', 'empty-label'],
    ['*a.com', 'wildcard-label'],
    ['a.+b.com', 'wildcard-label'],
    ['keyword:foo', 'unsupported-attribute'],
    ['regexp:^a', 'unsupported-attribute'],
    ['1.2.3.0/24', 'ok'],
  ])('处理 %s（code=%s）', (token, code) => {
    const result = normalizeToken(token);
    if (code === 'ok') expect(result.ok).toBe(true);
    else {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
  });

  it('拒绝起始大于终点的区间', () => {
    const result = normalizeToken('1.2.3.255-1.2.3.0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid-range');
  });

  it('写坏的 CIDR 必须报错，不能退化成域名（E2E 回归）', () => {
    const badPrefix = normalizeToken('1.2.3.4/33');
    expect(badPrefix.ok).toBe(false);
    if (!badPrefix.ok) expect(badPrefix.code).toBe('invalid-prefix');

    const hostBits = normalizeToken('10.0.0.1/24');
    expect(hostBits.ok).toBe(false);
    if (!hostBits.ok) expect(hostBits.code).toBe('host-bits');
  });
});

describe('stripComment', () => {
  it.each([
    ['# 整行注释', true],
    ['   ', true],
    ['// 注释', true],
    ['example.com', false],
    ['example.com # 行内注释', false],
  ])('%s → isComment=%s', (line, isComment) => {
    expect(stripComment(line).isComment).toBe(isComment);
  });

  it('去掉行内注释内容', () => {
    expect(stripComment('example.com # 备注').text).toBe('example.com');
  });
});

describe('normalizeList', () => {
  it('去重、跳过注释、记录问题行号', () => {
    const result = normalizeList(
      ['# 头部注释', 'example.com', 'example.com', '1.2.3.0/24', 'bad..domain', '', 'example.com # 重复'].join('\n'),
    );
    expect(result.entries).toEqual(['example.com', '1.2.3.0/24']);
    expect(result.duplicates).toEqual(['example.com']);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].line).toBe(5);
    expect(result.issues[0].code).toBe('empty-label');
  });

  it('一行多个条目（逗号或空格分隔）', () => {
    const result = normalizeList('a.com, b.com c.com');
    expect(result.entries).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('URL 与区间混合输入', () => {
    const result = normalizeList('https://www.a.com/x\n1.2.3.0-1.2.3.255');
    expect(result.entries).toEqual(['www.a.com', '1.2.3.0/24']);
    expect(result.issues).toHaveLength(0);
  });
});

describe('行为判定与拆分', () => {
  it('detectBehavior', () => {
    expect(detectBehavior([])).toBe('empty');
    expect(detectBehavior(['a.com', 'b.com'])).toBe('domain');
    expect(detectBehavior(['1.2.3.0/24', '10.0.0.0/8'])).toBe('ipcidr');
    expect(detectBehavior(['a.com', '1.2.3.0/24'])).toBe('mixed');
  });

  it('splitByBehavior', () => {
    expect(splitByBehavior(['a.com', '1.2.3.0/24', 'b.com'])).toEqual({
      domains: ['a.com', 'b.com'],
      ips: ['1.2.3.0/24'],
    });
  });
});

describe('diff 与文本序列化', () => {
  it('diffEntries', () => {
    const diff = diffEntries(['a.com', 'b.com'], ['b.com', 'c.com']);
    expect(diff.added).toEqual(['c.com']);
    expect(diff.removed).toEqual(['a.com']);
    expect(diff.unchangedCount).toBe(1);
  });

  it('serializeTextFile 以换行结尾', () => {
    expect(serializeTextFile(['a.com', 'b.com'])).toBe('a.com\nb.com\n');
    expect(serializeTextFile([])).toBe('');
  });
});
