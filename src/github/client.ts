/**
 * GitHub REST 集成（浏览器直连）。
 *
 * 关键点：
 *  - 读文件用 `Accept: application/vnd.github.raw`，绕开 Contents API 的 1MB base64 限制；
 *  - 写文件走 Git Data API（blobs → tree → commit → ref），一次提交同时更新 .txt 与 .mrs；
 *  - token 只进 Authorization 头，所有错误信息统一脱敏。
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const GITHUB_API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

/** 把 token 从任何要展示的文本里抹掉。 */
export function redactSecrets(text: string, token: string): string {
  let output = text;
  if (token !== '') output = output.split(token).join('***');
  output = output.replace(/github_pat_[A-Za-z0-9_]{10,}/g, '***');
  output = output.replace(/gh[pousr]_[A-Za-z0-9]{10,}/g, '***');
  return output;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text.replace(/\s/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  canPush: boolean;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
}

export interface FileToCommit {
  path: string;
  content: Uint8Array;
}

export interface CommitResult {
  sha: string;
  htmlUrl: string;
  paths: string[];
}

export interface GitHubClientOptions {
  token: string;
  fetchImpl?: FetchLike;
  apiBase?: string;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  accept?: string;
  /** 允许把 HTTP 404 映射成 null，而不是抛错（用于「文件还不存在」）。 */
  allow404?: boolean;
}

export class GitHubClient {
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiBase: string;

  constructor(options: GitHubClientOptions) {
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.apiBase = options.apiBase ?? GITHUB_API_BASE;
  }

  private headers(accept: string): Record<string, string> {
    return {
      accept,
      authorization: `Bearer ${this.token}`,
      'x-github-api-version': API_VERSION,
      'content-type': 'application/json',
    };
  }

  private async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = `${this.apiBase}${path}`;
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers: this.headers(options.accept ?? 'application/vnd.github+json'),
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw new GitHubError(
        redactSecrets(`网络请求失败：${error instanceof Error ? error.message : String(error)}`, this.token),
        0,
      );
    }

    if (response.ok) return response;
    if (response.status === 404 && options.allow404) return response;

    throw await this.toError(response);
  }

  private async toError(response: Response): Promise<GitHubError> {
    let detail = '';
    try {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text) as { message?: string; errors?: unknown };
        detail = parsed.message ?? text;
        if (parsed.errors !== undefined) detail += ` ${JSON.stringify(parsed.errors)}`;
      } catch {
        detail = text;
      }
    } catch {
      detail = '';
    }
    detail = redactSecrets(detail.slice(0, 500), this.token);

    const rateLimited = response.headers.get('x-ratelimit-remaining') === '0';
    let message: string;
    switch (response.status) {
      case 401:
        message = 'token 无效或已过期，请重新生成 PAT';
        break;
      case 403:
        message = rateLimited
          ? 'GitHub API 速率限制已达上限，请稍后再试'
          : 'token 权限不足（需要该仓库的 Contents: Read and write）';
        break;
      case 404:
        message = '找不到仓库或文件，也可能是 token 没有访问该私有仓库的权限';
        break;
      case 409:
      case 422:
        message = '提交被拒绝：分支可能受保护，或本地状态已过期（会先自动重试一次）';
        break;
      default:
        message = `GitHub API 返回 ${response.status} ${response.statusText}`;
    }

    return new GitHubError(detail === '' ? message : `${message}（${detail}）`, response.status, detail);
  }

  /** 校验 token：返回登录名。 */
  async getUser(): Promise<{ login: string }> {
    const response = await this.request('/user');
    return (await response.json()) as { login: string };
  }

  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    const response = await this.request(`/repos/${owner}/${repo}`);
    const data = (await response.json()) as {
      full_name: string;
      default_branch: string;
      private: boolean;
      permissions?: { push?: boolean };
    };
    return {
      fullName: data.full_name,
      defaultBranch: data.default_branch,
      private: data.private,
      canPush: data.permissions?.push === true,
    };
  }

  async listDirectory(owner: string, repo: string, path: string, ref: string): Promise<DirectoryEntry[]> {
    const clean = path.replace(/^\/+|\/+$/g, '');
    const suffix = clean === '' ? '' : `/${clean}`;
    const response = await this.request(
      `/repos/${owner}/${repo}/contents${suffix}?ref=${encodeURIComponent(ref)}`,
      { allow404: true },
    );
    if (response.status === 404) return [];
    const data = (await response.json()) as
      | { name: string; path: string; type: string; size: number }[]
      | { name: string; path: string; type: string; size: number };
    const list = Array.isArray(data) ? data : [data];
    return list.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type === 'dir' ? 'dir' : 'file',
      size: entry.size ?? 0,
    }));
  }

  /** 读取文件原始字节；文件不存在返回 null。 */
  async readFile(owner: string, repo: string, path: string, ref: string): Promise<Uint8Array | null> {
    const clean = path.replace(/^\/+/, '');
    const response = await this.request(
      `/repos/${owner}/${repo}/contents/${encodeURI(clean)}?ref=${encodeURIComponent(ref)}`,
      { accept: 'application/vnd.github.raw', allow404: true },
    );
    if (response.status === 404) return null;
    return new Uint8Array(await response.arrayBuffer());
  }

  async createBlob(owner: string, repo: string, content: Uint8Array): Promise<string> {
    const response = await this.request(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: { content: bytesToBase64(content), encoding: 'base64' },
    });
    const data = (await response.json()) as { sha: string };
    return data.sha;
  }

  private async getHead(owner: string, repo: string, branch: string): Promise<string> {
    const response = await this.request(
      `/repos/${owner}/${repo}/git/ref/${encodeURIComponent(`heads/${branch}`)}`,
    );
    const data = (await response.json()) as { object: { sha: string } };
    return data.object.sha;
  }

  private async getTreeSha(owner: string, repo: string, commitSha: string): Promise<string> {
    const response = await this.request(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
    const data = (await response.json()) as { tree: { sha: string } };
    return data.tree.sha;
  }

  /** 一次提交同时写入多个文件（原子）。ref 冲突时自动重取 head 重试一次。 */
  async commitFiles(input: {
    owner: string;
    repo: string;
    branch: string;
    message: string;
    files: FileToCommit[];
  }): Promise<CommitResult> {
    const { owner, repo, branch, message, files } = input;
    if (files.length === 0) throw new GitHubError('没有要提交的文件', 0);

    const blobShas: string[] = [];
    for (const file of files) {
      blobShas.push(await this.createBlob(owner, repo, file.content));
    }

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const headSha = await this.getHead(owner, repo, branch);
        const baseTreeSha = await this.getTreeSha(owner, repo, headSha);

        const treeResponse = await this.request(`/repos/${owner}/${repo}/git/trees`, {
          method: 'POST',
          body: {
            base_tree: baseTreeSha,
            tree: files.map((file, index) => ({
              path: file.path.replace(/^\/+/, ''),
              mode: '100644',
              type: 'blob',
              sha: blobShas[index],
            })),
          },
        });
        const treeData = (await treeResponse.json()) as { sha: string };

        const commitResponse = await this.request(`/repos/${owner}/${repo}/git/commits`, {
          method: 'POST',
          body: { message, tree: treeData.sha, parents: [headSha] },
        });
        const commitData = (await commitResponse.json()) as { sha: string; html_url: string };

        const refResponse = await this.request(
          `/repos/${owner}/${repo}/git/refs/${encodeURIComponent(`heads/${branch}`)}`,
          { method: 'PATCH', body: { sha: commitData.sha, force: false } },
        );
        if (!refResponse.ok) throw await this.toError(refResponse);

        return {
          sha: commitData.sha,
          htmlUrl: commitData.html_url,
          paths: files.map((file) => file.path),
        };
      } catch (error) {
        lastError = error;
        const retryable = error instanceof GitHubError && (error.status === 422 || error.status === 409);
        if (!retryable || attempt === 1) throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new GitHubError('提交失败', 0);
  }
}

/** 拼接 raw 与 jsDelivr 的下载地址，方便直接贴进 OpenClash。 */
export function buildRawUrls(owner: string, repo: string, branch: string, path: string): {
  raw: string;
  jsdelivr: string;
} {
  const clean = path.replace(/^\/+/, '');
  return {
    raw: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${clean}`,
    jsdelivr: `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${clean}`,
  };
}
