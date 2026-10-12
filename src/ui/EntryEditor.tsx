import { useRef, useState } from 'react';
import { Badge, Button, Card } from './controls';

export function EntryEditor({
  text,
  onTextChange,
  onAddEntry,
  onDedupe,
  onSort,
  onClear,
  addError,
  stats,
  sourceLabel,
}: {
  text: string;
  onTextChange: (text: string) => void;
  onAddEntry: (raw: string) => void;
  onDedupe: () => void;
  onSort: () => void;
  onClear: () => void;
  addError: string | null;
  stats: { lines: number; valid: number; duplicates: number; issues: number; comments: number };
  sourceLabel: string;
}) {
  const [draft, setDraft] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const submitDraft = () => {
    if (draft.trim() === '') return;
    onAddEntry(draft);
    setDraft('');
  };

  return (
    <Card
      title="2. 编辑规则条目"
      subtitle={`${sourceLabel} · 有效 ${stats.valid} 条 · 重复 ${stats.duplicates} 条 · 非法 ${stats.issues} 条`}
      actions={
        <>
          <Badge tone={stats.issues > 0 ? 'red' : 'green'}>{stats.issues > 0 ? `${stats.issues} 条待修正` : '全部合法'}</Badge>
          <Button onClick={onDedupe}>去重</Button>
          <Button onClick={onSort}>排序</Button>
          <Button onClick={() => fileInput.current?.click()}>导入文件</Button>
          <Button variant="ghost" onClick={onClear}>
            清空
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitDraft();
            }
          }}
          placeholder="输入域名 / IP / CIDR / 区间 / URL，回车添加，例如 pt.example.com 或 1.2.3.0/24"
          className="min-w-[260px] flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
          aria-label="快速添加条目"
        />
        <Button variant="primary" onClick={submitDraft}>
          添加
        </Button>
      </div>
      {addError !== null && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{addError}</p>}

      <textarea
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        spellCheck={false}
        rows={18}
        placeholder={'# 每行一条，支持 # 注释\n+.example.com\n*.example.net\n10.0.0.0/8\n1.2.3.0-1.2.3.255'}
        className="mt-3 w-full resize-y rounded-lg border border-neutral-300 bg-white p-3 text-xs leading-5 outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-950"
        aria-label="规则条目"
      />

      <p className="mt-2 text-[11px] leading-5 text-neutral-500 dark:text-neutral-400">
        语法：<code>example.com</code> 只匹配自身；<code>+.example.com</code> 匹自身与所有子域；
        <code>.example.com</code> 只匹配子域；<code>*.example.com</code> 匹配任意单层；IP/CIDR 走 ipcidr 类型；
        区间会自动拆成最小 CIDR。域名与 IP 不能放在同一个文件里。
      </p>

      <input
        ref={fileInput}
        type="file"
        accept=".txt,.list,.text,text/plain"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file === undefined) return;
          const content = await file.text();
          onTextChange(text === '' ? content : `${text.replace(/\n$/, '')}\n${content}`);
          event.target.value = '';
        }}
      />
    </Card>
  );
}
