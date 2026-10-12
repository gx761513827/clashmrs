import { describe, expect, it } from 'vitest';
import { openClashSnippet } from '../../src/app/snippet';

describe('openClashSnippet', () => {
  it('包含 mihomo 必需字段（format: mrs 不能省）', () => {
    const snippet = openClashSnippet('pt', 'domain', 'https://raw.githubusercontent.com/o/r/main/rule/pt.mrs');
    expect(snippet).toContain('rule-providers:');
    expect(snippet).toContain('  pt:');
    expect(snippet).toContain('behavior: domain');
    expect(snippet).toContain('format: mrs');
    expect(snippet).toContain('url: https://raw.githubusercontent.com/o/r/main/rule/pt.mrs');
    expect(snippet).toContain('interval: 86400');
  });

  it('ipcidr 类型与非法 key 都会被处理', () => {
    const snippet = openClashSnippet('我的 规则/pt', 'ipcidr', 'https://example.com/a.mrs');
    expect(snippet).toContain('behavior: ipcidr');
    expect(snippet).toContain('  ______pt:');
  });

  it('生成的 YAML 可以被真实解析成两条路径匹配（structure sanity）', () => {
    const lines = openClashSnippet('pt', 'domain', 'https://example.com/a.mrs').split('\n');
    expect(lines[0]).toBe('rule-providers:');
    expect(lines.filter((line) => line.startsWith('    ')).length).toBe(6);
  });
});
