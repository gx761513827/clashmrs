import { describe, expect, it } from 'vitest';
import {
  defaultCommitMessage,
  loadRuleset,
  mrsPathOf,
  saveRuleset,
  textPathOf,
  type RulesetRef,
} from '../../src/app/ruleset-store';
import { base64ToBytes, GitHubClient, type FetchLike } from '../../src/github/client';
import { encodeMrs, decodeMrs } from '../../src/core/mrs';
import { utf8Encode } from '../../src/core/bytes';
import { createFakeGitHub, jsonResponse, bytesResponse, type RecordedCall } from '../helpers/fake-github';
import { nodeZstd } from '../helpers/node-zstd';

const REF: RulesetRef = { owner: 'me', repo: 'rules', branch: 'main', dir: 'rule', name: 'pt' };
const TOKEN = 'github_pat_test_only_abcdefghijkl';

type Routes = Record<string, (call: RecordedCall) => Response | Promise<Response>>;

function makeClient(routes: Routes) {
  const fake = createFakeGitHub(routes);
  const fetchImpl: FetchLike = fake.fetchImpl;
  return { fake, gh: new GitHubClient({ token: TOKEN, fetchImpl }) };
}

const TXT_KEY = `GET /repos/me/rules/contents/${textPathOf(REF)}`;
const MRS_KEY = `GET /repos/me/rules/contents/${mrsPathOf(REF)}`;

const COMMIT_ROUTES: Routes = {
  'POST /repos/me/rules/git/blobs': (call) => {
    const body = call.body as { content: string };
    return jsonResponse({ sha: `blob-${base64ToBytes(body.content).length}` });
  },
  'GET /repos/me/rules/git/ref/heads/main': () => jsonResponse({ object: { sha: 'head-sha' } }),
  'GET /repos/me/rules/git/commits/head-sha': () => jsonResponse({ tree: { sha: 'base-tree' } }),
  'POST /repos/me/rules/git/trees': () => jsonResponse({ sha: 'new-tree' }),
  'POST /repos/me/rules/git/commits': () =>
    jsonResponse({ sha: 'new-commit', html_url: 'https://github.com/me/rules/commit/new-commit' }),
  'PATCH /repos/me/rules/git/refs/heads/main': () => jsonResponse({ object: { sha: 'new-commit' } }),
};

describe('路径推导', () => {
  it('目录为空时落在仓库根目录', () => {
    const root: RulesetRef = { ...REF, dir: '' };
    expect(textPathOf(root)).toBe('pt.txt');
    expect(mrsPathOf(root)).toBe('pt.mrs');
  });

  it('目录带斜杠也能规范化', () => {
    const nested: RulesetRef = { ...REF, dir: '/rules/mihomo/' };
    expect(textPathOf(nested)).toBe('rules/mihomo/pt.txt');
  });
});

describe('loadRuleset', () => {
  it('优先读 .txt', async () => {
    const { gh, fake } = makeClient({
      [TXT_KEY]: () => bytesResponse(utf8Encode('example.com\n+.example.org\n')),
    });
    const loaded = await loadRuleset(gh, REF, nodeZstd);
    expect(loaded.source).toBe('txt');
    expect(loaded.entries).toEqual(['example.com', '+.example.org']);
    expect(loaded.originalEntries).toEqual(loaded.entries);
    expect(fake.countOf(MRS_KEY)).toBe(0);
  });

  it('.txt 不存在时从 .mrs 解码，并给出提示', async () => {
    const mrsBytes = await encodeMrs(['example.com', '*.example.org'], 'domain', nodeZstd);
    const { gh } = makeClient({
      [TXT_KEY]: () => jsonResponse({ message: 'Not Found' }, 404),
      [MRS_KEY]: () => bytesResponse(mrsBytes),
    });
    const loaded = await loadRuleset(gh, REF, nodeZstd);
    expect(loaded.source).toBe('mrs');
    expect(loaded.behavior).toBe('domain');
    expect(new Set(loaded.entries)).toEqual(new Set(['example.com', '*.example.org']));
    expect(loaded.warnings.join()).toContain('.txt');
  });

  it('ipcidr 类型的 .mrs 解码出 CIDR 文本', async () => {
    const mrsBytes = await encodeMrs(['10.0.0.0/8', '2001:db8::/32'], 'ipcidr', nodeZstd);
    const { gh } = makeClient({
      [TXT_KEY]: () => jsonResponse({ message: 'Not Found' }, 404),
      [MRS_KEY]: () => bytesResponse(mrsBytes),
    });
    const loaded = await loadRuleset(gh, REF, nodeZstd);
    expect(loaded.behavior).toBe('ipcidr');
    expect(loaded.entries).toEqual(['10.0.0.0/8', '2001:db8::/32']);
  });

  it('两个文件都不存在时按新文件处理', async () => {
    const { gh } = makeClient({
      [TXT_KEY]: () => jsonResponse({ message: 'Not Found' }, 404),
      [MRS_KEY]: () => jsonResponse({ message: 'Not Found' }, 404),
    });
    const loaded = await loadRuleset(gh, REF, nodeZstd);
    expect(loaded).toMatchObject({ source: 'empty', entries: [], behavior: 'domain' });
  });

  it('.mrs 损坏时给出可操作的错误', async () => {
    const { gh } = makeClient({
      [TXT_KEY]: () => jsonResponse({ message: 'Not Found' }, 404),
      [MRS_KEY]: () => bytesResponse(utf8Encode('这不是 mrs')),
    });
    await expect(loadRuleset(gh, REF, nodeZstd)).rejects.toThrowError(/无法解析/);
  });
});

describe('saveRuleset', () => {
  it('一次提交同时写 .txt 与 .mrs，且 .mrs 能解回同一份列表', async () => {
    const { gh, fake } = makeClient(COMMIT_ROUTES);
    const entries = ['example.com', '+.example.org'];
    const result = await saveRuleset(gh, REF, {
      entries,
      behavior: 'domain',
      message: 'chore(pt): update domain rules (+2/-0) via clashmrs',
      zstd: nodeZstd,
    });

    expect(result.sha).toBe('new-commit');
    expect(result.paths).toEqual(['rule/pt.mrs', 'rule/pt.txt']);

    const blobCalls = fake.calls.filter((call) => call.key === 'POST /repos/me/rules/git/blobs');
    expect(blobCalls).toHaveLength(2);
    const mrsBytes = base64ToBytes((blobCalls[0].body as { content: string }).content);
    const txt = new TextDecoder().decode(
      base64ToBytes((blobCalls[1].body as { content: string }).content),
    );

    const decoded = await decodeMrs(mrsBytes, nodeZstd);
    expect(decoded.behavior).toBe('domain');
    // "+.example.org" 在 mrs 内部展开成「自身 + 子域」两条
    expect(new Set(decoded.entries)).toEqual(new Set(['example.com', 'example.org', '.example.org']));
    expect(txt).toBe('example.com\n+.example.org\n');
  });

  it('writeText=false 时只提交 .mrs', async () => {
    const { gh, fake } = makeClient(COMMIT_ROUTES);
    await saveRuleset(gh, REF, {
      entries: ['10.0.0.0/8'],
      behavior: 'ipcidr',
      message: 'only mrs',
      writeText: false,
      zstd: nodeZstd,
    });
    const treeCall = fake.calls.find((call) => call.key === 'POST /repos/me/rules/git/trees');
    const tree = (treeCall?.body as { tree: { path: string }[] }).tree;
    expect(tree.map((item) => item.path)).toEqual(['rule/pt.mrs']);
  });

  it('空列表拒绝提交', async () => {
    const { gh, fake } = makeClient(COMMIT_ROUTES);
    await expect(
      saveRuleset(gh, REF, { entries: [], behavior: 'domain', message: 'x', zstd: nodeZstd }),
    ).rejects.toThrowError(/空规则集/);
    expect(fake.calls).toHaveLength(0);
  });

  it('域名与 IP 混在一起时拒绝提交', async () => {
    const { gh, fake } = makeClient(COMMIT_ROUTES);
    await expect(
      saveRuleset(gh, REF, {
        entries: ['example.com', '10.0.0.0/8'],
        behavior: 'domain',
        message: 'x',
        zstd: nodeZstd,
      }),
    ).rejects.toThrowError(/不能放在同一个规则集/);
    expect(fake.calls).toHaveLength(0);
  });

  it('behavior 与列表内容不一致时拒绝提交', async () => {
    const { gh } = makeClient(COMMIT_ROUTES);
    await expect(
      saveRuleset(gh, REF, {
        entries: ['example.com'],
        behavior: 'ipcidr',
        message: 'x',
        zstd: nodeZstd,
      }),
    ).rejects.toThrowError(/不一致/);
  });
});

describe('defaultCommitMessage', () => {
  it('带文件、behavior 与增删计数', () => {
    expect(defaultCommitMessage(REF, 'domain', 3, 1)).toBe(
      'chore(pt): update domain rules (+3/-1) via clashmrs',
    );
  });
});
