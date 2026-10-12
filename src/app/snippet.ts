import type { RuleBehavior } from '../core/mrs';

/**
 * 生成 OpenClash / mihomo 的 rule-providers 片段。
 * 注意：mihomo 不会自动识别 .mrs，`format: mrs` 必须显式写。
 */
export function openClashSnippet(name: string, behavior: RuleBehavior, mrsUrl: string): string {
  const key = name.replace(/[^A-Za-z0-9_-]/g, '_') || 'ruleset';
  return [
    'rule-providers:',
    `  ${key}:`,
    '    type: http',
    `    behavior: ${behavior}`,
    '    format: mrs',
    `    url: ${mrsUrl}`,
    `    path: ./rule_provider/${key}.mrs`,
    '    interval: 86400',
  ].join('\n');
}
