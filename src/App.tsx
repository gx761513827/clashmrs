import { useEffect, useMemo, useState } from 'react';
import {
  defaultCommitMessage,
  loadRuleset,
  type LoadSource,
  type RulesetRef,
  saveRuleset,
} from './app/ruleset-store';
import { downloadBinary, downloadText } from './app/download';
import { GitHubClient, type CommitResult, type RepoInfo } from './github/client';
import {
  detectBehavior,
  diffEntries,
  normalizeList,
  normalizeToken,
  serializeTextFile,
  splitByBehavior,
} from './core/rules';
import { sortByUtf8 } from './core/bytes';
import type { RuleBehavior } from './core/mrs';
import { Badge, Card, Notice } from './ui/controls';
import { CommitPanel } from './ui/CommitPanel';
import { DiffPreview } from './ui/DiffPreview';
import { EntryEditor } from './ui/EntryEditor';
import { RepoBar } from './ui/RepoBar';
import {
  clearToken as clearStoredToken,
  loadSettings,
  loadToken,
  saveSettings,
  saveToken,
  type Settings,
} from './state/store';
import { encodeInWorker, payloadSizeInWorker, workerZstd } from './workers/convert-client';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [token, setToken] = useState<string>(() => loadToken(loadSettings().rememberToken));
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [connectionText, setConnectionText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [originalEntries, setOriginalEntries] = useState<string[]>([]);
  const [loadedSource, setLoadedSource] = useState<LoadSource>('empty');
  const [loadedCount, setLoadedCount] = useState<number | undefined>(undefined);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [behaviorChoice, setBehaviorChoice] = useState<'auto' | RuleBehavior>('auto');
  const [message, setMessage] = useState('');
  const [messageTouched, setMessageTouched] = useState(false);
  const [writeText, setWriteText] = useState(true);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [detachedIps, setDetachedIps] = useState<string[]>([]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    saveToken(token, settings.rememberToken);
  }, [token, settings.rememberToken]);

  const ref = useMemo<RulesetRef>(
    () => ({
      owner: settings.owner.trim(),
      repo: settings.repo.trim(),
      branch: settings.branch.trim() === '' ? 'main' : settings.branch.trim(),
      dir: settings.dir.trim().replace(/^\/+|\/+$/g, ''),
      name: settings.name.trim() === '' ? 'ruleset' : settings.name.trim(),
    }),
    [settings],
  );

  const normalized = useMemo(() => normalizeList(text), [text]);
  const detection = useMemo(() => detectBehavior(normalized.entries), [normalized.entries]);
  const detectedBehavior: RuleBehavior = detection === 'ipcidr' ? 'ipcidr' : 'domain';
  const behavior: RuleBehavior = behaviorChoice === 'auto' ? detectedBehavior : behaviorChoice;
  const diff = useMemo(
    () => diffEntries(originalEntries, normalized.entries),
    [originalEntries, normalized.entries],
  );

  const effectiveMessage =
    messageTouched || message !== ''
      ? message
      : defaultCommitMessage(ref, behavior, diff.added.length, diff.removed.length);

  const canSubmit =
    token !== '' &&
    repoInfo !== null &&
    normalized.entries.length > 0 &&
    normalized.issues.length === 0 &&
    detection !== 'mixed';

  const sourceLabel =
    loadedSource === 'txt'
      ? '来源：仓库里的 .txt'
      : loadedSource === 'mrs'
        ? `来源：解码 .mrs（文件头记录 ${loadedCount ?? '?'} 条）`
        : '来源：空白新建';

  async function connect(): Promise<void> {
    setError(null);
    setCommitResult(null);
    if (token === '') {
      setError('请先填写 GitHub token');
      return;
    }
    if (ref.owner === '' || ref.repo === '') {
      setError('请先填写用户名与仓库名');
      return;
    }
    setBusy('读取中…');
    try {
      const client = new GitHubClient({ token });
      const user = await client.getUser();
      const info = await client.getRepo(ref.owner, ref.repo);
      setRepoInfo(info);

      const data = await loadRuleset(client, ref, workerZstd);
      setText(data.text);
      setOriginalEntries(data.originalEntries);
      setLoadedSource(data.source);
      setLoadedCount(data.count);
      setWarnings(data.warnings);
      setBehaviorChoice('auto');
      setMessage('');
      setMessageTouched(false);
      setPreviewText(null);
      setDetachedIps([]);
      setConnectionText(
        `已连接 ${user.login} · ${info.fullName}（默认分支 ${info.defaultBranch}${info.canPush ? '' : '，token 无 push 权限'}）`,
      );
    } catch (caught) {
      setConnectionText('');
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  }

  function addEntry(raw: string): void {
    const result = normalizeToken(raw);
    if (!result.ok) {
      setAddError(result.reason);
      return;
    }
    setAddError(null);
    const additions = result.entries.join('\n');
    setText((current) => (current === '' || current.endsWith('\n') ? `${current}${additions}\n` : `${current}\n${additions}\n`));
  }

  function replaceEntries(entries: string[]): void {
    setText(entries.length === 0 ? '' : `${entries.join('\n')}\n`);
  }

  function splitMixed(): void {
    const { domains, ips } = splitByBehavior(normalized.entries);
    replaceEntries(domains);
    setDetachedIps(ips);
  }

  async function preview(): Promise<void> {
    setError(null);
    setBusy('计算中…');
    try {
      const result = await payloadSizeInWorker(normalized.entries, behavior);
      const kb = result.payloadSize / 1024;
      setPreviewText(
        `共 ${result.count} 条，${behavior} 负载（zstd 压缩前）约 ${kb.toFixed(1)} KB；压缩后通常只有它的 1/4 到 1/8。`,
      );
    } catch (caught) {
      setPreviewText(null);
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  }

  async function download(kind: 'txt' | 'mrs'): Promise<void> {
    setError(null);
    if (normalized.entries.length === 0) {
      setError('列表为空，先添加域名或 IP');
      return;
    }
    setBusy('生成中…');
    try {
      if (kind === 'txt') {
        downloadText(serializeTextFile(normalized.entries), `${ref.name}.txt`);
      } else {
        const { bytes } = await encodeInWorker(normalized.entries, behavior);
        downloadBinary(bytes, `${ref.name}.mrs`);
      }
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  }

  async function submit(): Promise<void> {
    setError(null);
    if (normalized.issues.length > 0) {
      setError(`有 ${normalized.issues.length} 条输入无法解析，请先修正或删除这些行再提交`);
      return;
    }
    if (detection === 'mixed') {
      setError('域名和 IP 不能放在同一个规则集里，请先按类型拆分');
      return;
    }
    setBusy('提交中…');
    try {
      const client = new GitHubClient({ token });
      const result = await saveRuleset(client, ref, {
        entries: normalized.entries,
        behavior,
        message: effectiveMessage,
        writeText,
        zstd: workerZstd,
      });
      setCommitResult(result);
      setOriginalEntries(normalized.entries);
      setLoadedSource('txt');
      setWarnings([]);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">clashmrs · mihomo .mrs 规则集更新器</h1>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            在网页上添加域名或 IP，自动归一化并生成 MRSv1 的 <code>.mrs</code>，一次提交同时更新仓库里的
            <code>.txt</code> 与 <code>.mrs</code>。全部在浏览器里完成，没有后端。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Badge tone={loadedSource === 'empty' ? 'neutral' : 'blue'}>{sourceLabel}</Badge>
          <Badge tone={token === '' ? 'amber' : 'green'}>{token === '' ? '未填 token' : 'token 已填'}</Badge>
        </div>
      </header>

      <RepoBar
        settings={settings}
        token={token}
        onSettingsChange={setSettings}
        onTokenChange={setToken}
        onConnect={() => void connect()}
        busy={busy === '读取中…' ? busy : null}
        connectionText={connectionText}
        repoInfo={repoInfo}
        onClearToken={() => {
          clearStoredToken();
          setToken('');
          setRepoInfo(null);
          setConnectionText('');
        }}
      />

      {warnings.map((warning) => (
        <Notice key={warning} tone="warn">
          {warning}
        </Notice>
      ))}
      {error !== null && (
        <Notice tone="error" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
      {commitResult !== null && (
        <Notice tone="success">
          已提交 {commitResult.paths.join('、')}（{commitResult.sha.slice(0, 8)}）
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <EntryEditor
          text={text}
          onTextChange={setText}
          onAddEntry={addEntry}
          onDedupe={() => replaceEntries(Array.from(new Set(normalized.entries)))}
          onSort={() => replaceEntries(sortByUtf8(normalized.entries))}
          onClear={() => setText('')}
          addError={addError}
          sourceLabel={sourceLabel}
          stats={{
            lines: text.split(/\r?\n/).length,
            valid: normalized.entries.length,
            duplicates: normalized.duplicates.length,
            issues: normalized.issues.length,
            comments: normalized.comments,
          }}
        />

        <div className="flex flex-col gap-4">
          <DiffPreview
            diff={diff}
            issues={normalized.issues}
            duplicates={normalized.duplicates}
            detection={detection}
            behavior={behavior}
            onSplitMixed={splitMixed}
            detachedIps={detachedIps}
            onClearDetached={() => setDetachedIps([])}
          />
          <CommitPanel
            ref={ref}
            behavior={behavior}
            behaviorChoice={behaviorChoice}
            detectedBehavior={detectedBehavior}
            onBehaviorChoiceChange={setBehaviorChoice}
            detectionLabel={`有效 ${normalized.entries.length} 条`}
            message={effectiveMessage}
            onMessageChange={(value) => {
              setMessage(value);
              setMessageTouched(true);
            }}
            writeText={writeText}
            onWriteTextChange={setWriteText}
            previewText={previewText}
            onPreview={() => void preview()}
            onDownload={(kind) => void download(kind)}
            onSubmit={() => void submit()}
            busy={busy === '提交中…' || busy === '生成中…' || busy === '计算中…' ? busy : null}
            commitResult={commitResult}
            onDismissResult={() => setCommitResult(null)}
            canSubmit={canSubmit}
          />
        </div>
      </div>

      <Card title="怎么用" subtitle="三步走完，之后每次只要第 3 步">
        <ol className="list-decimal space-y-1 pl-5 text-xs text-neutral-700 dark:text-neutral-300">
          <li>
            在 GitHub 生成一个<strong>细粒度 PAT</strong>：Repository access 只勾这一个仓库，Permissions 里
            <code>Contents: Read and write</code>，有效期按需设置；粘到上面的输入框。
          </li>
          <li>
            填好用户名 / 仓库 / 分支 / 目录 / 文件名，点「连接并读取」——已有 <code>.mrs</code> 会被解码成条目列表。
          </li>
          <li>
            在编辑框里加域名或 IP（也可以直接粘贴一整段），检查变更预览，填提交信息，点「提交到 GitHub」。
          </li>
        </ol>
        <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          规则类型限制：mihomo 只支持 <code>domain</code> 与 <code>ipcidr</code> 两种行为的 <code>.mrs</code>；
          classic 规则集请继续用 plain text / yaml。OpenClash 里务必写 <code>format: mrs</code>，mihomo 不会自动识别。
        </p>
      </Card>
    </div>
  );
}
