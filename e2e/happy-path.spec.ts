/**
 * 真浏览器端到端：真实 DOM 事件 + 真实 wasm 编码，只有 GitHub API 是 mock 的。
 * 这一步同时验证「浏览器里 zstd wasm 能跑」和「提交内容解回来是预期规则」。
 */
import { test, expect, type Page } from '@playwright/test';
import { buildMrsPayload, parseMrsPayload, type RuleBehavior } from '../src/core/mrs';
import { nodeZstd } from '../tests/helpers/node-zstd';
import { base64ToBytes } from '../src/github/client';

const TOKEN = 'github_pat_E2E_only_do_not_leak_abcdefghijkl';
const OWNER = 'tester';
const REPO = 'rules';

interface Recorded {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

interface MockOptions {
  mrs?: Uint8Array | null;
  txt?: string | null;
  /** 让某些请求变慢，用来复现「读取期间用户已经输入」的竞态。key 形如 `GET /repos/.../contents/rule/pt.txt` */
  delays?: Record<string, number>;
}

async function mockGitHub(page: Page, options: MockOptions): Promise<{ requests: Recorded[] }> {
  const requests: Recorded[] = [];

  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname);
    const method = request.method();
    let body: Record<string, unknown> = {};
    const raw = request.postData();
    if (raw !== null && raw !== '') body = JSON.parse(raw) as Record<string, unknown>;
    requests.push({ method, path, body });

    const key = `${method} ${path}`;
    const delay = options.delays?.[key];
    if (delay !== undefined) await new Promise((resolve) => setTimeout(resolve, delay));

    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const bytes = (data: Uint8Array) =>
      route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(data) });

    switch (true) {
      case key === 'GET /user':
        return json({ login: 'tester' });
      case key === `GET /repos/${OWNER}/${REPO}`:
        return json({ full_name: `${OWNER}/${REPO}`, default_branch: 'main', private: false, permissions: { push: true } });
      case key === `GET /repos/${OWNER}/${REPO}/contents/rule/pt.txt`:
        return options.txt ? bytes(new TextEncoder().encode(options.txt)) : json({ message: 'Not Found' }, 404);
      case key === `GET /repos/${OWNER}/${REPO}/contents/rule/pt.mrs`:
        return options.mrs ? bytes(options.mrs) : json({ message: 'Not Found' }, 404);
      case key === `POST /repos/${OWNER}/${REPO}/git/blobs`:
        return json({ sha: `blob-${requests.length}` });
      case key === `GET /repos/${OWNER}/${REPO}/git/ref/heads/main`:
        return json({ object: { sha: 'head-sha' } });
      case key === `GET /repos/${OWNER}/${REPO}/git/commits/head-sha`:
        return json({ tree: { sha: 'base-tree' } });
      case key === `POST /repos/${OWNER}/${REPO}/git/trees`:
        return json({ sha: 'new-tree' });
      case key === `POST /repos/${OWNER}/${REPO}/git/commits`:
        return json({ sha: 'new-commit', html_url: `https://github.com/${OWNER}/${REPO}/commit/new-commit` });
      case key === `PATCH /repos/${OWNER}/${REPO}/git/refs/heads/main`:
        return json({ object: { sha: 'new-commit' } });
      default:
        return json({ message: `未 mock 的请求：${key}` }, 500);
    }
  });

  return { requests };
}

async function fillConnection(page: Page): Promise<void> {
  await page.getByLabel('GitHub Token（细粒度 PAT）').fill(TOKEN);
  await page.getByLabel('用户名 / 组织').fill(OWNER);
  await page.getByLabel('仓库名').fill(REPO);
  await page.getByLabel('分支').fill('main');
  await page.getByLabel('目录').fill('rule');
  await page.getByLabel('文件名（不含扩展名）').fill('pt');
}

async function existingMrs(entries: string[], behavior: RuleBehavior): Promise<Uint8Array> {
  return nodeZstd.compress(buildMrsPayload(entries, behavior));
}

/**
 * 点「连接并读取」并**等到读取真正结束**：只等按钮状态会漏掉「请求还没回来」的窗口，
 * 而那正是历史 bug 的来源——读取结果回来时会把用户在读取期间输入的内容覆盖掉。
 */
async function connectAndWait(page: Page): Promise<void> {
  await page.getByRole('button', { name: '连接并读取' }).click();
  await expect(page.getByText(/已连接 tester · tester\/rules/)).toBeVisible();
}

test('把新域名加进已有 .mrs 并提交，提交内容可解回新列表', async ({ page }) => {
  const mrs = await existingMrs(['example.com', '+.old-domain.com'], 'domain');
  const { requests } = await mockGitHub(page, { mrs, txt: null });

  await page.goto('./');
  await fillConnection(page);
  await connectAndWait(page);

  // 已有 .mrs 被解码进编辑器
  const editor = page.getByLabel('规则条目');
  await expect(editor).toHaveValue(/example\.com/);
  await expect(editor).toHaveValue(/\+\.old-domain\.com/);
  await expect(page.getByText(/已从 rule\/pt\.mrs 解码/)).toBeVisible();

  // 用快速添加加一条
  await page.getByLabel('快速添加条目').fill('https://pt.new-site.org/torrents.php?id=1');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await expect(editor).toHaveValue(/pt\.new-site\.org/);
  await expect(page.getByText('新增 1 · 删除 0 · 未变 2')).toBeVisible();

  // 提交
  await page.getByRole('button', { name: '提交到 GitHub' }).click();
  await expect(page.getByText(/提交成功/)).toBeVisible();
  await expect(page.getByRole('link', { name: /commit\/new-commit/ })).toBeVisible();

  // 校验提交内容
  const treeCall = requests.find((item) => item.method === 'POST' && item.path.endsWith('/git/trees'));
  expect(treeCall).toBeDefined();
  const tree = treeCall!.body.tree as { path: string }[];
  expect(tree.map((item) => item.path).sort()).toEqual(['rule/pt.mrs', 'rule/pt.txt']);

  const blobCalls = requests.filter((item) => item.method === 'POST' && item.path.endsWith('/git/blobs'));
  expect(blobCalls).toHaveLength(2);
  // saveRuleset 先写 .mrs
  const committed = base64ToBytes((blobCalls[0].body as { content: string }).content);
  const payload = await nodeZstd.decompress(committed);
  const parsed = parseMrsPayload(payload);
  expect(parsed.behavior).toBe('domain');
  expect(new Set(parsed.entries)).toEqual(
    new Set(['example.com', 'old-domain.com', '.old-domain.com', 'pt.new-site.org']),
  );

  const txtBlob = base64ToBytes((blobCalls[1].body as { content: string }).content);
  expect(new TextDecoder().decode(txtBlob)).toContain('pt.new-site.org');

  // token 绝不落进页面文本或 URL
  const text = await page.locator('body').innerText();
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain('github_pat_E2E');
  expect(page.url()).not.toContain('github_pat');
});

test('浏览器里真实生成 .mrs 并下载，解回来是同一份列表', async ({ page }) => {
  await mockGitHub(page, { mrs: null, txt: null });

  await page.goto('./');
  await fillConnection(page);
  await connectAndWait(page);
  await expect(page.getByText('来源：空白新建', { exact: true })).toBeVisible();

  await page.getByLabel('规则条目').fill('+.tracker-a.net\n10.0.0.0/8\n');
  // 混排时先看到提示，提交按钮被禁用
  await expect(page.getByText('域名与 IP 混排')).toBeVisible();
  await expect(page.getByRole('button', { name: '提交到 GitHub' })).toBeDisabled();

  // 只留域名后再下载 .mrs（走真实 wasm 编码 + 真实下载）
  await page.getByLabel('规则条目').fill('+.tracker-a.net\npt.example.org\n');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 .mrs' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('pt.mrs');

  const path = await download.path();
  expect(path).not.toBeNull();
  const { readFile } = await import('node:fs/promises');
  const bytes = new Uint8Array(await readFile(path!));
  expect(bytes[0]).toBe(0x28); // zstd magic

  const parsed = parseMrsPayload(await nodeZstd.decompress(bytes));
  expect(parsed.behavior).toBe('domain');
  expect(new Set(parsed.entries)).toEqual(
    new Set(['tracker-a.net', '.tracker-a.net', 'pt.example.org']),
  );
});

test('非法条目会被拦下，不会发出任何写请求', async ({ page }) => {
  const { requests } = await mockGitHub(page, { mrs: null, txt: null });

  await page.goto('./');
  await fillConnection(page);
  await connectAndWait(page);

  await page.getByLabel('规则条目').fill('good-domain.com\nbad..domain\n1.2.3.4/33\n');
  await expect(page.getByText(/有 2 条无法解析/)).toBeVisible();
  await expect(page.getByRole('button', { name: '提交到 GitHub' })).toBeDisabled();

  await page.getByRole('button', { name: '提交到 GitHub' }).click({ force: true }).catch(() => undefined);
  expect(requests.filter((item) => item.method !== 'GET')).toHaveLength(0);
});

test('读取还没回来时就开始输入，内容不会被加载结果覆盖（竞态回归）', async ({ page }) => {
  // 让仓库读取慢 1.5 秒，制造「请求在飞、用户已经在打字」的窗口
  await mockGitHub(page, {
    mrs: null,
    txt: '+.repo-original.example\n',
    delays: { 'GET /repos/tester/rules/contents/rule/pt.txt': 1500 },
  });

  await page.goto('./');
  await fillConnection(page);
  await page.getByRole('button', { name: '连接并读取' }).click();

  // 读取期间立刻输入
  const editor = page.getByLabel('规则条目');
  await editor.fill('+.typed-while-loading.example\n');

  await expect(page.getByText(/已连接 tester · tester\/rules/)).toBeVisible();
  // 用户输入必须被保留，仓库里的内容只作为 diff 基准
  await expect(editor).toHaveValue(/typed-while-loading\.example/);
  await expect(editor).not.toHaveValue(/repo-original/);
  await expect(page.getByText(/为了不丢失输入/)).toBeVisible();
  // 以仓库里的内容为基准：用户输入的这条算新增，仓库那条算删除
  await expect(page.getByText('新增 1 · 删除 1 · 未变 0')).toBeVisible();
});
