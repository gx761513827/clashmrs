import { describe, expect, it } from 'vitest';
import {
  buildDomainSet,
  checkDomain,
  decodeDomainPayload,
  decodeDomainSet,
  encodeDomainEntries,
  normalizeDomainEntries,
} from '../../src/core/domain-set';

describe('checkDomain（对齐 mihomo trie.ValidAndSplitDomain）', () => {
  it.each(['example.com', 'www.example.com', '*.example.com', '+.example.com', '.example.com', 'sub.*.example.com', '*', 'foo-bar.com'])(
    '接受 %s',
    (domain) => {
      expect(checkDomain(domain).ok).toBe(true);
    },
  );

  it.each([
    ['', 'empty'],
    ['example.com.', 'trailing-dot'],
    [' example.com', 'whitespace'],
    ['example.com ', 'whitespace'],
    ['a..b', 'empty-label'],
    ['*a.com', 'wildcard-label'],
    ['a.+b.com', 'wildcard-label'],
    ['+.example.com.+', 'wildcard-plus-position'],
    ['example.com/x', 'slash'],
  ])('拒绝 %s（code=%s）', (domain, code) => {
    const result = checkDomain(domain);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(code);
  });

  it('+ 只能在最前面的标签，且后面必须还有标签', () => {
    expect(checkDomain('a.+b.com').ok).toBe(false);
    const bare = checkDomain('+');
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.code).toBe('wildcard-plus-needs-label');
  });
});

describe('DAFSA 编解码', () => {
  it('往返一致：build → decode → normalize', () => {
    const domains = ['baidu.com', 'google.com', '.qq.com', '+.cn', 'test.a.net', '*.example.org'];
    const data = buildDomainSet(domains);
    const decoded = decodeDomainSet(data);
    const normalized = normalizeDomainEntries(decoded);
    // ".qq.com" 只有子域语义；"+.cn" 同时覆盖自身与子域
    expect(normalized).toContain('.qq.com');
    expect(normalized).toContain('+.cn');
    expect(normalized).toContain('google.com');
    expect(normalized).toContain('*.example.org');
    expect(encodeDomainEntries(normalized).length).toBeGreaterThan(0);
  });

  it('精确 + 子域合并为 +.（上游 domain_strategy_test.go 的用例）', () => {
    const cases: { input: string[]; expected: string[] }[] = [
      { input: ['.example.com'], expected: ['.example.com'] },
      { input: ['example.com'], expected: ['example.com'] },
      { input: ['example.com', '.example.com'], expected: ['+.example.com'] },
      {
        input: ['+.example.com', '+.example.com', 'example.com', '.example.com'],
        expected: ['+.example.com'],
      },
      {
        input: ['.example.com', 'example.net', 'example.org', '.example.org'],
        expected: ['+.example.org', '.example.com', 'example.net'],
      },
      {
        input: ['*.example.com', '+.example.org', 'test.*.google.com', '.test.*.google.com', '.example.net'],
        expected: ['*.example.com', '+.example.org', '+.test.*.google.com', '.example.net'],
      },
    ];
    for (const testCase of cases) {
      const normalized = normalizeDomainEntries(decodeDomainSet(buildDomainSet(testCase.input)));
      expect(normalized).toEqual(testCase.expected);
    }
  });

  it('负载可以重新解析回来', () => {
    const entries = ['example.com', '*.example.org', '.example.net'];
    const payload = encodeDomainEntries(entries);
    const decoded = decodeDomainPayload(payload);
    expect(decoded.endOffset).toBe(payload.length);
    expect(decoded.entries.length).toBeGreaterThanOrEqual(entries.length);
  });
});
