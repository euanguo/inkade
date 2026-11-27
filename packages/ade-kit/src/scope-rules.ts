import { matchGlob } from "@inkade/core";
import type { ProjectScopeRule, SpaceId } from "@inkade/core";

export interface RepoContext {
  readonly repoName?: string | undefined;
  readonly gitRemote?: string | undefined;
  readonly localPath?: string | undefined;
}

export type ProjectScopeRuleCandidate = Pick<
  ProjectScopeRule,
  "id" | "matchType" | "pattern" | "writableSpaceIds" | "readonlySpaceIds" | "priority"
> & {
  readonly defaultInboxSpaceId?: SpaceId | undefined;
  readonly defaultResearchSpaceId?: SpaceId | undefined;
  readonly extraInstructions?: string | undefined;
};

export interface MatchedProjectScopeRule<
  TRule extends ProjectScopeRuleCandidate = ProjectScopeRule,
> {
  readonly rule: TRule;
  readonly writableSpaceIds: readonly SpaceId[];
  readonly readonlySpaceIds: readonly SpaceId[];
  readonly allReadableSpaceIds: readonly SpaceId[];
}

function hasGlobWildcards(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern);
}

/**
 * Normalizes SSH, HTTPS, and scp-style git remote URLs into a canonical `host/owner/repo` string.
 */
export function normalizeGitRemote(remote: string): string {
  let value = remote.trim();
  if (!value) return "";

  const sshProtocolMatch = /^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(value);
  if (sshProtocolMatch) {
    value = `${sshProtocolMatch[1] ?? ""}/${sshProtocolMatch[2] ?? ""}`;
  } else {
    const scpMatch = /^(?:[^@]+@)?([^/:]+):([^/].*)$/.exec(value);
    if (scpMatch && !/^https?$/i.test(scpMatch[1] ?? "")) {
      value = `${scpMatch[1] ?? ""}/${scpMatch[2] ?? ""}`;
    } else {
      const httpMatch = /^https?:\/\/(?:[^@]+@)?([^/]+)\/(.+)$/i.exec(value);
      if (httpMatch) {
        value = `${httpMatch[1] ?? ""}/${httpMatch[2] ?? ""}`;
      }
    }
  }

  return value
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function normalizeRepoName(name: string): string {
  return name
    .trim()
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function normalizeLocalPath(targetPath: string): string {
  const forward = targetPath.trim().replace(/\\/g, "/");
  if (forward === "/") return "/";
  return forward.replace(/\/+$/, "");
}

function dedupePreserveOrder<T extends string>(ids: readonly T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const id of ids) {
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

function doesRuleMatch(repoContext: RepoContext, rule: ProjectScopeRuleCandidate): boolean {
  const rawPattern = rule.pattern.trim();
  if (!rawPattern) return false;

  switch (rule.matchType) {
    case "git_remote": {
      if (!repoContext.gitRemote) return false;
      const target = normalizeGitRemote(repoContext.gitRemote);
      const pattern = normalizeGitRemote(rawPattern);
      if (!target || !pattern) return false;
      if (hasGlobWildcards(pattern)) {
        return matchGlob(pattern, target);
      }
      return target === pattern || (!pattern.includes(":") && target.endsWith(`/${pattern}`));
    }
    case "repo_name": {
      if (!repoContext.repoName) return false;
      const target = normalizeRepoName(repoContext.repoName);
      const pattern = normalizeRepoName(rawPattern);
      if (!target || !pattern) return false;
      if (hasGlobWildcards(pattern)) {
        return matchGlob(pattern, target);
      }
      return target === pattern;
    }
    case "path_glob": {
      if (!repoContext.localPath) return false;
      const target = normalizeLocalPath(repoContext.localPath);
      const pattern = normalizeLocalPath(rawPattern);
      if (!target || !pattern) return false;
      return matchGlob(pattern, target);
    }
  }
}

/**
 * Matches the highest-priority `ProjectScopeRule` against the current repository context.
 */
export function matchProjectScopeRule<TRule extends ProjectScopeRuleCandidate>(
  repoContext: RepoContext,
  rules: readonly TRule[],
): MatchedProjectScopeRule<TRule> | null {
  if (rules.length === 0) return null;

  const sorted = rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => {
      if (b.rule.priority !== a.rule.priority) {
        return b.rule.priority - a.rule.priority;
      }
      return a.index - b.index;
    });

  for (const entry of sorted) {
    if (doesRuleMatch(repoContext, entry.rule)) {
      const writableSpaceIds = dedupePreserveOrder(entry.rule.writableSpaceIds);
      const readonlySpaceIds = dedupePreserveOrder(entry.rule.readonlySpaceIds);
      const allReadableSpaceIds = dedupePreserveOrder([
        ...writableSpaceIds,
        ...readonlySpaceIds,
      ]);
      return {
        rule: entry.rule,
        writableSpaceIds,
        readonlySpaceIds,
        allReadableSpaceIds,
      };
    }
  }

  return null;
}
