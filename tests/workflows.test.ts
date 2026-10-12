/**
 * 工作流文件回归：GitHub 遇到非法 YAML 时会静默产生一条「无 job 的失败运行」，
 * 排查起来很费时间，所以这里用真正的 YAML 解析器把它们钉住。
 * （历史 bug：pages.yml 里 `pages: write` 与 `pages: read` 键重复 → workflow 无法解析。）
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const WORKFLOW_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');
const files = readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));

interface Workflow {
  name?: string;
  on?: unknown;
  permissions?: Record<string, string>;
  jobs?: Record<string, { steps?: { uses?: string; run?: string; if?: string; id?: string }[] }>;
}

describe('.github/workflows', () => {
  it('至少有一个工作流', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} 是合法 YAML 且有 name/on/jobs`, () => {
      const source = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
      // yaml 包遇到重复键会抛 "Map keys must be unique"
      const doc = parse(source) as Workflow;
      expect(doc).toBeTypeOf('object');
      expect(typeof doc.name).toBe('string');
      expect(doc.on).toBeDefined();
      expect(Object.keys(doc.jobs ?? {}).length).toBeGreaterThan(0);
      for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
        expect(Array.isArray(job.steps), `job ${jobName} 没有 steps`).toBe(true);
      }
    });

    it(`${file} 里表达式引用的标识符不含连字符（会被当成减号）`, () => {
      const source = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
      const expressions = [...source.matchAll(/\$\{\{([^}]*)\}\}/g)].map((match) => match[1]);
      const risky = expressions.filter(
        // needs.<job>.outputs.<name> / steps.<id>.outputs.<name> 里出现连字符会解析成减号
        (expression) => /(?:needs|steps)\.\S*-\S*/.test(expression),
      );
      expect(risky, `这些表达式里的标识符带连字符：${risky.join(' | ')}`).toEqual([]);
    });
  }
});
