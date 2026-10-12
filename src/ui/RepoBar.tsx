import type { RepoInfo } from '../github/client';
import type { Settings } from '../state/store';
import { Badge, Button, Card, Checkbox, TextField } from './controls';

export function RepoBar({
  settings,
  token,
  onSettingsChange,
  onTokenChange,
  onConnect,
  busy,
  connectionText,
  repoInfo,
  onClearToken,
}: {
  settings: Settings;
  token: string;
  onSettingsChange: (settings: Settings) => void;
  onTokenChange: (token: string) => void;
  onConnect: () => void;
  busy: string | null;
  connectionText: string;
  repoInfo: RepoInfo | null;
  onClearToken: () => void;
}) {
  const update = (patch: Partial<Settings>) => onSettingsChange({ ...settings, ...patch });
  const target = [settings.owner, settings.repo].filter(Boolean).join('/') || '（未填写）';

  return (
    <Card
      title="1. 连接 GitHub 仓库"
      subtitle={`目标：${target} · ${settings.branch || 'main'} · ${settings.dir ? `${settings.dir}/` : ''}${settings.name}.mrs`}
      actions={
        <>
          <Button variant="primary" onClick={onConnect} disabled={busy !== null}>
            {busy !== null ? busy : '连接并读取'}
          </Button>
          {repoInfo !== null && <Badge tone="green">{repoInfo.fullName}</Badge>}
          {repoInfo !== null && !repoInfo.canPush && <Badge tone="amber">无 push 权限</Badge>}
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <TextField
          label="GitHub Token（细粒度 PAT）"
          type="password"
          value={token}
          onChange={onTokenChange}
          placeholder="github_pat_..."
          autoComplete="off"
          hint="只保存在你的浏览器里，只发往 api.github.com"
        />
        <TextField label="用户名 / 组织" value={settings.owner} onChange={(value) => update({ owner: value })} placeholder="your-name" />
        <TextField label="仓库名" value={settings.repo} onChange={(value) => update({ repo: value })} placeholder="clash-rules" />
        <TextField label="分支" value={settings.branch} onChange={(value) => update({ branch: value })} placeholder="main" />
        <TextField
          label="目录"
          value={settings.dir}
          onChange={(value) => update({ dir: value })}
          placeholder="rule（留空表示根目录）"
          monospace
        />
        <TextField
          label="文件名（不含扩展名）"
          value={settings.name}
          onChange={(value) => update({ name: value })}
          placeholder="pt"
          monospace
          hint="会同时更新 .mrs 与 .txt"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Checkbox
          label="把 token 记到本机（localStorage）"
          checked={settings.rememberToken}
          onChange={(checked) => update({ rememberToken: checked })}
          hint="不勾选时只存在当前标签页的 sessionStorage，关掉浏览器就没了"
        />
        <div className="flex items-center gap-2">
          {connectionText !== '' && (
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{connectionText}</span>
          )}
          <Button variant="ghost" onClick={onClearToken}>
            清除 token
          </Button>
        </div>
      </div>
    </Card>
  );
}
