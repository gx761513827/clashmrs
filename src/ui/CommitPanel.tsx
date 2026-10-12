import { buildRawUrls, type CommitResult } from '../github/client';
import type { RuleBehavior } from '../core/mrs';
import type { RulesetRef } from '../app/ruleset-store';
import { Card, Button, Checkbox, CopyButton, Badge } from './controls';
import { openClashSnippet } from '../app/snippet';

export function CommitPanel({
  ref,
  behavior,
  behaviorChoice,
  detectedBehavior,
  onBehaviorChoiceChange,
  detectionLabel,
  message,
  onMessageChange,
  writeText,
  onWriteTextChange,
  previewText,
  onPreview,
  onDownload,
  onSubmit,
  busy,
  commitResult,
  onDismissResult,
  canSubmit,
}: {
  ref: RulesetRef;
  behavior: RuleBehavior;
  behaviorChoice: 'auto' | RuleBehavior;
  detectedBehavior: RuleBehavior;
  onBehaviorChoiceChange: (choice: 'auto' | RuleBehavior) => void;
  detectionLabel: string;
  message: string;
  onMessageChange: (message: string) => void;
  writeText: boolean;
  onWriteTextChange: (value: boolean) => void;
  previewText: string | null;
  onPreview: () => void;
  onDownload: (kind: 'txt' | 'mrs') => void;
  onSubmit: () => void;
  busy: string | null;
  commitResult: CommitResult | null;
  onDismissResult: () => void;
  canSubmit: boolean;
}) {
  const mrsPath = `${ref.dir ? `${ref.dir}/` : ''}${ref.name}.mrs`;
  const urls = buildRawUrls(ref.owner, ref.repo, ref.branch, mrsPath);
  const snippet = openClashSnippet(ref.name, behavior, urls.raw);

  return (
    <Card
      title="3. 生成并提交"
      subtitle={`生成 ${behavior} 类型 · ${detectionLabel}`}
      actions={
        <>
          <Button onClick={onPreview} disabled={busy !== null}>
            预估体积
          </Button>
          <Button onClick={() => onDownload('txt')} disabled={busy !== null}>
            下载 .txt
          </Button>
          <Button onClick={() => onDownload('mrs')} disabled={busy !== null}>
            下载 .mrs
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={busy !== null || !canSubmit}>
            {busy ?? '提交到 GitHub'}
          </Button>
        </>
      }
    >
      {previewText !== null && <p className="mb-2 text-xs text-neutral-600 dark:text-neutral-300">{previewText}</p>}

      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-neutral-600 dark:text-neutral-300">提交信息</span>
          <input
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-neutral-600 dark:text-neutral-300">规则类型（behavior）</span>
          <select
            value={behaviorChoice}
            onChange={(event) => onBehaviorChoiceChange(event.target.value as 'auto' | RuleBehavior)}
            className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="auto">自动（按内容判断：{detectedBehavior}）</option>
            <option value="domain">domain（域名规则集）</option>
            <option value="ipcidr">ipcidr（IP 规则集）</option>
          </select>
        </label>
      </div>

      <div className="mt-3">
        <Checkbox
          label="同时更新可读的 .txt 源文件（推荐）"
          checked={writeText}
          onChange={onWriteTextChange}
          hint=".txt 方便你在 GitHub 网页上直接改，diff 也看得懂；.mrs 是给 mihomo 读的最终文件"
        />
      </div>

      {commitResult !== null && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">提交成功：{commitResult.sha.slice(0, 8)}</span>
            <Button variant="ghost" onClick={onDismissResult}>
              关闭
            </Button>
          </div>
          <p className="mt-1 break-all">
            <a className="underline" href={commitResult.htmlUrl} target="_blank" rel="noreferrer">
              {commitResult.htmlUrl}
            </a>
          </p>
          <p className="mt-2 break-all">
            raw：<a className="underline" href={urls.raw} target="_blank" rel="noreferrer">{urls.raw}</a>
          </p>
          <p className="break-all">
            jsDelivr：<a className="underline" href={urls.jsdelivr} target="_blank" rel="noreferrer">{urls.jsdelivr}</a>
          </p>
          <p className="mt-1 text-[11px]">
            raw.githubusercontent.com 有几分钟 CDN 缓存；OpenClash 侧还有自己的 provider 缓存与 interval。
          </p>
        </div>
      )}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer font-medium text-neutral-600 dark:text-neutral-300">
          OpenClash / mihomo 配置片段（记得写 format: mrs）
        </summary>
        <div className="mt-2 flex items-start gap-2">
          <pre className="flex-1 overflow-auto rounded-lg bg-neutral-950 p-3 text-[11px] leading-5 text-neutral-100">{snippet}</pre>
          <CopyButton text={snippet} />
        </div>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
        <Badge tone="neutral">behavior: {behavior}</Badge>
        <Badge tone="neutral">format: mrs</Badge>
        {writeText && <Badge tone="neutral">{ref.name}.txt</Badge>}
        <Badge tone="neutral">{ref.name}.mrs</Badge>
      </div>
    </Card>
  );
}
