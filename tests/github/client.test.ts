import { describe, expect, it } from 'vitest';
import {
  GitHubClient,
  GitHubError,
  base64ToBytes,
  bytesToBase64,
  buildRawUrls,
  redactSecrets,
} from '../../src/github/client';
import { bytesResponse, createFakeGitHub, jsonResponse, type RecordedCall } from '../helpers/fake-github';

type Routes = Record<string, (call: RecordedCall) => Response | Promise<Response>>;

const TOKEN = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz';

function client(routes: Routes) {
  const fake = createFakeGitHub(routes);
  return {
    fake,
    gh: new GitHubClient({ token: TOKEN, fetchImpl: fake.fetchImpl }),
  };
}

describe('base64 工具', () => {
  it('往返一致（含 0x00/0xff 与多字节）', () => {
    const bytes = new Uint8Array([0, 1, 255, 128, 65, 66, 67]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('可以编码较大数组（分块）', () => {
    const bytes = new Uint8Array(200_000).map((_, index) => index % 251);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)).subarray(0, 3))).toEqual([0, 1, 2]);
    expect(base64ToBytes(bytesToBase64(bytes)).length).toBe(bytes.length);
  });
});

describe('redactSecrets', () => {
  it('抹掉 token 与常见 PAT 形态', () => {
    const text = `failed with ${TOKEN} and ghp_abcdefghijklmnopqrstuvwxyz0123`;
    const redacted = redactSecrets(text, TOKEN);
    expect(redacted).not.toContain(TOKEN);
    expect(redacted).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123');
    expect(redacted).toContain('***');
  });
});

describe('GitHubClient 基础请求', () => {
  it('getUser 带上 Authorization 与 API 版本头', async () => {
    const { gh, fake } = client({
      'GET /user': () => jsonResponse({ login: 'octocat' }),
    });
    const user = await gh.getUser();
    expect(user.login).toBe('octocat');
    expect(fake.calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(fake.calls[0].headers['x-github-api-version']).toBe('2022-11-28');
  });

  it('getRepo 提取 push 权限', async () => {
    const { gh } = client({
      'GET /repos/o/r': () =>
        jsonResponse({ full_name: 'o/r', default_branch: 'main', private: true, permissions: { push: true } }),
    });
    const repo = await gh.getRepo('o', 'r');
    expect(repo).toMatchObject({ fullName: 'o/r', defaultBranch: 'main', private: true, canPush: true });
  });

  it('readFile 用 raw 媒体类型，404 返回 null', async () => {
    const { gh, fake } = client({
      'GET /repos/o/r/contents/rule/pt.mrs': () => bytesResponse(Uint8Array.from([1, 2, 3])),
      'GET /repos/o/r/contents/rule/missing.mrs': () => jsonResponse({ message: 'Not Found' }, 404),
    });
    const found = await gh.readFile('o', 'r', 'rule/pt.mrs', 'main');
    expect(Array.from(found ?? [])).toEqual([1, 2, 3]);
    expect(fake.calls[0].headers.accept).toBe('application/vnd.github.raw');
    expect(await gh.readFile('o', 'r', 'rule/missing.mrs', 'main')).toBeNull();
  });

  it('listDirectory 兼容目录与单文件两种返回', async () => {
    const { gh } = client({
      'GET /repos/o/r/contents/rule': () =>
        jsonResponse([
          { name: 'pt.mrs', path: 'rule/pt.mrs', type: 'file', size: 1024 },
          { name: 'sub', path: 'rule/sub', type: 'dir', size: 0 },
        ]),
    });
    const entries = await gh.listDirectory('o', 'r', 'rule', 'main');
    expect(entries.map((entry) => `${entry.type}:${entry.name}`)).toEqual(['file:pt.mrs', 'dir:sub']);
  });
});

describe('GitHubClient 错误映射与脱敏', () => {
  it('401 提示 token 无效，并且不回显 token', async () => {
    const { gh } = client({
      'GET /user': () => jsonResponse({ message: `Bad credentials for ${TOKEN}` }, 401),
    });
    await expect(gh.getUser()).rejects.toThrowError(GitHubError);
    try {
      await gh.getUser();
    } catch (error) {
      const gitHubError = error as GitHubError;
      expect(gitHubError.status).toBe(401);
      expect(gitHubError.message).toContain('token 无效');
      expect(gitHubError.message).not.toContain(TOKEN);
    }
  });

  it('403 且速率限制耗尽时给出限流提示', async () => {
    const { gh } = client({
      'GET /user': () =>
        new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0' },
        }),
    });
    await expect(gh.getUser()).rejects.toThrowError(/速率限制/);
  });

  it('403 且非限流时提示权限不足', async () => {
    const { gh } = client({
      'GET /user': () => jsonResponse({ message: 'Resource not accessible' }, 403),
    });
    await expect(gh.getUser()).rejects.toThrowError(/权限不足/);
  });

  it('网络异常被包装成可读错误', async () => {
    const gh = new GitHubClient({
      token: TOKEN,
      fetchImpl: async () => {
        throw new Error('socket hang up');
      },
    });
    await expect(gh.getUser()).rejects.toThrowError(/网络请求失败/);
  });
});

describe('GitHubClient.commitFiles', () => {
  const files = [
    { path: 'rule/pt.txt', content: new TextEncoder().encode('example.com\n') },
    { path: 'rule/pt.mrs', content: Uint8Array.from([40, 181, 47, 253, 9, 9]) },
  ];

  function routes(overrides: Routes = {}): Routes {
    const base: Routes = {
      'POST /repos/o/r/git/blobs': (call) => {
        const body = call.body as { content: string };
        return jsonResponse({ sha: `blob-${base64ToBytes(body.content).length}` });
      },
      'GET /repos/o/r/git/ref/heads/main': () => jsonResponse({ object: { sha: 'head-sha' } }),
      'GET /repos/o/r/git/commits/head-sha': () => jsonResponse({ tree: { sha: 'base-tree' } }),
      'POST /repos/o/r/git/trees': () => jsonResponse({ sha: 'new-tree' }),
      'POST /repos/o/r/git/commits': () =>
        jsonResponse({ sha: 'new-commit', html_url: 'https://github.com/o/r/commit/new-commit' }),
      'PATCH /repos/o/r/git/refs/heads/main': () => jsonResponse({ object: { sha: 'new-commit' } }),
    };
    return { ...base, ...overrides };
  }

  it('按 blobs → tree → commit → ref 顺序原子提交', async () => {
    const { fake, gh } = client(routes());
    const result = await gh.commitFiles({
      owner: 'o',
      repo: 'r',
      branch: 'main',
      message: 'chore(pt): update rules',
      files,
    });

    expect(result.sha).toBe('new-commit');
    expect(result.htmlUrl).toContain('/commit/new-commit');
    expect(fake.callKeys()).toEqual([
      'POST /repos/o/r/git/blobs',
      'POST /repos/o/r/git/blobs',
      'GET /repos/o/r/git/ref/heads/main',
      'GET /repos/o/r/git/commits/head-sha',
      'POST /repos/o/r/git/trees',
      'POST /repos/o/r/git/commits',
      'PATCH /repos/o/r/git/refs/heads/main',
    ]);

    // 提交内容必须能还原成原始字节
    const blobCalls = fake.calls.filter((call) => call.key === 'POST /repos/o/r/git/blobs');
    const first = base64ToBytes((blobCalls[0].body as { content: string }).content);
    expect(new TextDecoder().decode(first)).toBe('example.com\n');

    const treeCall = fake.calls.find((call) => call.key === 'POST /repos/o/r/git/trees');
    const treeBody = treeCall?.body as { base_tree: string; tree: { path: string; sha: string }[] };
    expect(treeBody.base_tree).toBe('base-tree');
    expect(treeBody.tree.map((item) => item.path)).toEqual(['rule/pt.txt', 'rule/pt.mrs']);

    const commitCall = fake.calls.find((call) => call.key === 'POST /repos/o/r/git/commits');
    const commitBody = commitCall?.body as { parents: string[]; tree: string; message: string };
    expect(commitBody.parents).toEqual(['head-sha']);
    expect(commitBody.tree).toBe('new-tree');
    expect(commitBody.message).toBe('chore(pt): update rules');

    const refCall = fake.calls.find((call) => call.key === 'PATCH /repos/o/r/git/refs/heads/main');
    expect(refCall?.body).toEqual({ sha: 'new-commit', force: false });
  });

  it('ref 冲突（422）时重取 head 重试一次', async () => {
    let patchCount = 0;
    const { fake, gh } = client(
      routes({
        'PATCH /repos/o/r/git/refs/heads/main': () => {
          patchCount++;
          return patchCount === 1
            ? jsonResponse({ message: 'Update is not a fast forward' }, 422)
            : jsonResponse({ object: { sha: 'new-commit' } });
        },
        'GET /repos/o/r/git/ref/heads/main': () => jsonResponse({ object: { sha: 'head-sha' } }),
      }),
    );
    const result = await gh.commitFiles({
      owner: 'o',
      repo: 'r',
      branch: 'main',
      message: 'retry',
      files,
    });
    expect(patchCount).toBe(2);
    expect(fake.countOf('GET /repos/o/r/git/ref/heads/main')).toBe(2);
    expect(result.sha).toBe('new-commit');
  });

  it('重试后仍失败就抛错，不吞掉问题', async () => {
    const { gh } = client(
      routes({
        'PATCH /repos/o/r/git/refs/heads/main': () =>
          jsonResponse({ message: 'Update is not a fast forward' }, 422),
      }),
    );
    await expect(
      gh.commitFiles({ owner: 'o', repo: 'r', branch: 'main', message: 'fail', files }),
    ).rejects.toThrowError(/提交被拒绝/);
  });

  it('分支名含斜杠时正确编码 ref', async () => {
    const { fake, gh } = client({
      ...routes(),
      'GET /repos/o/r/git/ref/heads/feat/rules': () => jsonResponse({ object: { sha: 'head-sha' } }),
      'PATCH /repos/o/r/git/refs/heads/feat/rules': () => jsonResponse({ object: { sha: 'new-commit' } }),
    });
    await gh.commitFiles({
      owner: 'o',
      repo: 'r',
      branch: 'feat/rules',
      message: 'branch with slash',
      files: [files[1]],
    });
    expect(fake.callKeys()).toContain('GET /repos/o/r/git/ref/heads/feat/rules');
    expect(fake.callKeys()).toContain('PATCH /repos/o/r/git/refs/heads/feat/rules');
  });

  it('没有文件时不发请求', async () => {
    const { fake, gh } = client(routes());
    await expect(
      gh.commitFiles({ owner: 'o', repo: 'r', branch: 'main', message: 'empty', files: [] }),
    ).rejects.toThrowError(/没有要提交的文件/);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('buildRawUrls', () => {
  it('生成 raw 与 jsDelivr 地址', () => {
    expect(buildRawUrls('o', 'r', 'main', '/rule/pt.mrs')).toEqual({
      raw: 'https://raw.githubusercontent.com/o/r/main/rule/pt.mrs',
      jsdelivr: 'https://cdn.jsdelivr.net/gh/o/r@main/rule/pt.mrs',
    });
  });
});
