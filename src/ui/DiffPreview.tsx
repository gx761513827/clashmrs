import type { NormalizeIssue } from '../core/rules';
import type { BehaviorDetection } from '../core/rules';
import type { RuleBehavior } from '../core/mrs';
import type { DiffResult } from '../core/rules';
import { Badge, Button, Card, CopyButton } from './controls';

export function DiffPreview({
  diff,
  issues,
  duplicates,
  detection,
  behavior,
  onSplitMixed,
  detachedIps,
  onClearDetached,
}: {
  diff: DiffResult;
  issues: NormalizeIssue[];
  duplicates: string[];
  detection: BehaviorDetection;
  behavior: RuleBehavior;
  onSplitMixed: () => void;
  detachedIps: string[];
  onClearDetached: () => void;
}) {
  return (
    <Card
      title="变更预览"
      subtitle={`新增 ${diff.added.length} · 删除 ${diff.removed.length} · 未变 ${diff.unchangedCount}`}
      actions={
        <Badge tone={detection === 'mixed' ? 'red' : detection === 'empty' ? 'neutral' : 'blue'}>
          {detection === 'mixed' ? '域名与 IP 混排' : detection === 'empty' ? '空列表' : `${detection} 类型`}
        </Badge>
      }
    >
      {detection === 'mixed' && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100">
          <p className="font-medium">同一个规则集里不能同时放域名和 IP。</p>
          <p className="mt-1">mihomo 的 domain 规则集会忽略 IP 行，ipcidr 规则集会忽略域名行，结果就是「规则看起来加上了，但不生效」。</p>
          <Button className="mt-2" onClick={onSplitMixed}>
            把 IP 条目移出编辑框
          </Button>
          {detachedIps.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">已移出的 IP 条目（请放进 ipcidr 文件）</span>
                <div className="flex gap-1">
                  <CopyButton text={detachedIps.join('\n')} />
                  <Button variant="ghost" onClick={onClearDetached}>
                    收起
                  </Button>
                </div>
              </div>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-white/70 p-2 text-[11px] dark:bg-black/30">
                {detachedIps.join('\n')}
              </pre>
            </div>
          )}
        </div>
      )}

      {issues.length > 0 && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100">
          <p className="font-medium">有 {issues.length} 条无法解析，提交会被拦下：</p>
          <ul className="mt-1 space-y-0.5">
            {issues.slice(0, 8).map((issue) => (
              <li key={`${issue.line}-${issue.raw}`}>
                第 {issue.line} 行 <code>{issue.raw}</code>：{issue.reason}
              </li>
            ))}
          </ul>
          {issues.length > 8 && <p className="mt-1">…还有 {issues.length - 8} 条</p>}
        </div>
      )}

      {duplicates.length > 0 && (
        <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">
          自动去除了 {duplicates.length} 条重复条目（例如 {duplicates.slice(0, 3).join('、')}）
        </p>
      )}

      <div className="grid gap-2 text-xs md:grid-cols-3">
        <Delta title="新增" tone="text-emerald-700 dark:text-emerald-300" items={diff.added} />
        <Delta title="删除" tone="text-red-700 dark:text-red-300" items={diff.removed} />
        <div className="rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
          <p className="font-medium">当前生效类型</p>
          <p className="mt-1 text-neutral-600 dark:text-neutral-300">
            提交时会生成 <code>{behavior}</code> 行为的 .mrs
          </p>
        </div>
      </div>
    </Card>
  );
}

function Delta({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
      <p className={`font-medium ${tone}`}>
        {title} {items.length}
      </p>
      <pre className="mt-1 max-h-32 overflow-auto text-[11px] text-neutral-600 dark:text-neutral-300">
        {items.slice(0, 40).join('\n')}
        {items.length > 40 ? `\n…还有 ${items.length - 40} 条` : ''}
      </pre>
    </div>
  );
}
