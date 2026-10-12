/**
 * 「仓库里的一个规则集」这一层的读写逻辑：把 core（编解码）和 GitHub（读写提交）接起来。
 * UI 只调用这里，便于用假 fetch 做端到端逻辑测试。
 */
import { utf8Decode, utf8Encode } from '../core/bytes';
import { normalizeDomainEntries } from '../core/domain-set';
import { decodeMrs, encodeMrs, type ParsedMrs, type RuleBehavior } from '../core/mrs';
import { detectBehavior, parseTextFile, serializeTextFile } from '../core/rules';
import type { ZstdCodec } from '../core/zstd-port';
import { GitHubClient, type CommitResult } from '../github/client';

export interface RulesetRef {
  owner: string;
  repo: string;
  branch: string;
  /** 目录，允许为空字符串（仓库根目录） */
  dir: string;
  /** 不含扩展名的文件名，例如 "pt" */
  name: string;
}

function joinPath(dir: string, file: string): string {
  const clean = dir.replace(/^\/+|\/+$/g, '');
  return clean === '' ? file : `${clean}/${file}`;
}

export function textPathOf(ref: RulesetRef): string {
  return joinPath(ref.dir, `${ref.name}.txt`);
}

export function mrsPathOf(ref: RulesetRef): string {
  return joinPath(ref.dir, `${ref.name}.mrs`);
}

export type LoadSource = 'txt' | 'mrs' | 'empty';

export interface LoadedRuleset {
  entries: string[];
  behavior: RuleBehavior;
  source: LoadSource;
  /** 直接放进编辑框的原始文本（.txt 会保留用户的注释与空行）。 */
  text: string;
  /** 文件头里记录的条数（仅 .mrs 有）。 */
  count?: number;
  /** 修改前的条目，用于 diff。 */
  originalEntries: string[];
  warnings: string[];
}

/** 读取规则集：优先用可读的 .txt，没有再用 .mrs，都没有则是新文件。 */
export async function loadRuleset(
  client: GitHubClient,
  ref: RulesetRef,
  zstd: ZstdCodec,
): Promise<LoadedRuleset> {
  const warnings: string[] = [];

  const textBytes = await client.readFile(ref.owner, ref.repo, textPathOf(ref), ref.branch);
  if (textBytes !== null) {
    const content = utf8Decode(textBytes);
    const entries = parseTextFile(content);
    const detection = detectBehavior(entries);
    const behavior: RuleBehavior = detection === 'ipcidr' ? 'ipcidr' : 'domain';
    if (detection === 'mixed') {
      warnings.push('.txt 里同时存在域名与 IP，已按 domain 处理，请先按类型拆分再提交');
    }
    return { entries, behavior, source: 'txt', text: content, originalEntries: entries, warnings };
  }

  const mrsBytes = await client.readFile(ref.owner, ref.repo, mrsPathOf(ref), ref.branch);
  if (mrsBytes !== null) {
    let parsed: ParsedMrs;
    try {
      parsed = await decodeMrs(mrsBytes, zstd);
    } catch (error) {
      throw new Error(
        `${mrsPathOf(ref)} 无法解析：${error instanceof Error ? error.message : String(error)}。` +
          '可以清空编辑框后从零重建这个规则集。',
      );
    }
    const entries =
      parsed.behavior === 'domain' ? normalizeDomainEntries(parsed.entries) : parsed.entries;
    warnings.push(`仓库里没有 .txt，已从 ${mrsPathOf(ref)} 解码出条目；提交后会自动补上 .txt 源文件`);
    return {
      entries,
      behavior: parsed.behavior,
      source: 'mrs',
      text: entries.join('\n'),
      count: parsed.count,
      originalEntries: entries,
      warnings,
    };
  }

  return { entries: [], behavior: 'domain', source: 'empty', text: '', originalEntries: [], warnings };
}

export interface SaveRulesetInput {
  entries: string[];
  behavior: RuleBehavior;
  message: string;
  /** 是否同时写 .txt 源文件（默认 true） */
  writeText?: boolean;
  /** 先探测一次 .txt 是否存在，用于决定是否提示 behavior 变化（可选）。 */
  zstd: ZstdCodec;
}

export interface SaveRulesetResult extends CommitResult {
  mrsBytes: Uint8Array;
  textContent: string | null;
}

/** 生成 .mrs（顺带生成 .txt）并一次性提交到 GitHub。 */
export async function saveRuleset(
  client: GitHubClient,
  ref: RulesetRef,
  input: SaveRulesetInput,
): Promise<SaveRulesetResult> {
  if (input.entries.length === 0) {
    throw new Error('规则列表为空，mihomo 不接受空规则集');
  }
  const detection = detectBehavior(input.entries);
  if (detection === 'mixed') {
    throw new Error('域名与 IP 不能放在同一个规则集里，请先按类型拆分');
  }
  if (detection !== 'empty' && detection !== input.behavior) {
    throw new Error(`列表内容是 ${detection}，与当前选择的 behavior（${input.behavior}）不一致`);
  }

  const mrsBytes = await encodeMrs(input.entries, input.behavior, input.zstd);
  const writeText = input.writeText ?? true;
  const textContent = writeText ? serializeTextFile(input.entries) : null;

  const files = [{ path: mrsPathOf(ref), content: mrsBytes }];
  if (textContent !== null) files.push({ path: textPathOf(ref), content: utf8Encode(textContent) });

  const result = await client.commitFiles({
    owner: ref.owner,
    repo: ref.repo,
    branch: ref.branch,
    message: input.message,
    files,
  });

  return { ...result, mrsBytes, textContent };
}

export function defaultCommitMessage(
  ref: RulesetRef,
  behavior: RuleBehavior,
  added: number,
  removed: number,
): string {
  const delta = `+${added}/-${removed}`;
  return `chore(${ref.name}): update ${behavior} rules (${delta}) via clashmrs`;
}
