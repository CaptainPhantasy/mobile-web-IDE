// Server-side GitHub REST client for the cockpit. Uses global fetch (Node 18+),
// GITHUB_TOKEN/GH_TOKEN only — never the browser PAT. No Octokit dependency.
import type { CockpitPullRequest, CockpitIssue, CockpitWorkflowRun } from './types';

export class GithubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
  }
}

export function getGithubToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.GITHUB_TOKEN || env.GH_TOKEN || null;
}

interface GithubRequestOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
function bool(v: unknown): boolean {
  return v === true;
}

async function ghGet(fullName: string, suffix: string, opts?: GithubRequestOptions): Promise<unknown> {
  const env = opts?.env ?? process.env;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const token = getGithubToken(env);
  if (!token) throw new GithubError(503, 'GitHub token is not configured on the server');
  const res = await fetchImpl(`https://api.github.com/repos/${fullName}${suffix}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mwide-cockpit',
    },
  });
  if (!res.ok) throw new GithubError(res.status, `GitHub API error ${res.status}`);
  return res.json();
}

export async function listPulls(fullName: string, opts?: GithubRequestOptions): Promise<CockpitPullRequest[]> {
  const data = await ghGet(fullName, '/pulls?state=open&per_page=30', opts);
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const r = asRecord(item);
    const head = asRecord(r.head);
    const base = asRecord(r.base);
    const user = asRecord(r.user);
    return {
      number: num(r.number),
      title: str(r.title),
      state: str(r.state),
      draft: bool(r.draft),
      htmlUrl: str(r.html_url),
      headRef: str(head.ref),
      baseRef: str(base.ref),
      author: str(user.login),
      updatedAt: str(r.updated_at),
    };
  });
}

export async function listIssues(fullName: string, opts?: GithubRequestOptions): Promise<CockpitIssue[]> {
  const data = await ghGet(fullName, '/issues?state=open&per_page=30', opts);
  if (!Array.isArray(data)) return [];
  return data
    .filter((item) => !('pull_request' in asRecord(item)))
    .map((item) => {
      const r = asRecord(item);
      const user = asRecord(r.user);
      const labels = Array.isArray(r.labels)
        ? r.labels.map((l) => str(asRecord(l).name)).filter((n) => n.length > 0)
        : [];
      return {
        number: num(r.number),
        title: str(r.title),
        state: str(r.state),
        htmlUrl: str(r.html_url),
        author: str(user.login),
        updatedAt: str(r.updated_at),
        labels,
      };
    });
}

export async function listWorkflows(fullName: string, opts?: GithubRequestOptions): Promise<CockpitWorkflowRun[]> {
  const data = asRecord(await ghGet(fullName, '/actions/runs?per_page=20', opts));
  const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
  return runs.map((item) => {
    const r = asRecord(item);
    const conclusion = r.conclusion;
    return {
      id: num(r.id),
      name: str(r.name),
      status: str(r.status),
      conclusion: typeof conclusion === 'string' ? conclusion : null,
      event: str(r.event),
      branch: str(r.head_branch),
      htmlUrl: str(r.html_url),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
    };
  });
}
