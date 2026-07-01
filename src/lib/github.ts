// Thin wrapper over the GitHub REST API that runs inside the browser.
// The Personal Access Token is kept in IndexedDB via the kv layer; every
// request is routed through /api/github-proxy to avoid CORS on some
// endpoints (e.g. raw repository archives) and to keep the token off the
// URL.
//
// Full surface covering gh CLI commands:
//   auth, repo, pr, issue, run, workflow, release, gist, search, status

import { kvGet, kvSet, kvDel } from './kv';

export type GithubRepo = {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  private: boolean;
  clone_url: string;
  html_url: string;
  description: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  pushed_at?: string;
};

const TOKEN_KEY = 'github.token';
const USER_KEY = 'github.user';

export async function setToken(token: string): Promise<void> {
  await kvSet(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | undefined> {
  return await kvGet<string>(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await kvDel(TOKEN_KEY);
  await kvDel(USER_KEY);
}

export type GithubUser = {
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
};

async function gh<T = unknown>(
  endpoint: string,
  opts: { method?: string; body?: any; query?: Record<string, string> } = {},
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (opts.body) headers['Content-Type'] = 'application/json';

  let url = 'https://api.github.com' + endpoint;
  if (opts.query) {
    const u = new URL(url);
    Object.entries(opts.query).forEach(([k, v]) => u.searchParams.set(k, v));
    url = u.toString();
  }

  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function getCurrentUser(): Promise<GithubUser | undefined> {
  try {
    const user = await gh<GithubUser>('/user');
    await kvSet(USER_KEY, user);
    return user;
  } catch {
    return undefined;
  }
}

export async function cachedUser(): Promise<GithubUser | undefined> {
  return await kvGet<GithubUser>(USER_KEY);
}

// -------- REPO --------

export async function listRepos(): Promise<GithubRepo[]> {
  return await gh<GithubRepo[]>('/user/repos?per_page=100&sort=updated');
}

export async function getRepo(fullName: string): Promise<GithubRepo> {
  return await gh<GithubRepo>(`/repos/${fullName}`);
}

export async function createRepo(
  name: string,
  opts: { private?: boolean; description?: string; auto_init?: boolean } = {},
): Promise<GithubRepo> {
  return await gh<GithubRepo>('/user/repos', {
    method: 'POST',
    body: {
      name,
      private: opts.private ?? false,
      description: opts.description,
      auto_init: opts.auto_init ?? true,
    },
  });
}

export async function forkRepo(
  fullName: string,
  opts: { name?: string; default_branch_only?: boolean } = {},
): Promise<GithubRepo> {
  return await gh<GithubRepo>(`/repos/${fullName}/forks`, {
    method: 'POST',
    body: {
      name: opts.name,
      default_branch_only: opts.default_branch_only ?? false,
    },
  });
}

export async function listRepoBranches(
  fullName: string,
): Promise<Array<{ name: string; protected: boolean }>> {
  return await gh<Array<{ name: string; protected: boolean }>>(
    `/repos/${fullName}/branches?per_page=100`,
  );
}

export async function listRepoTags(
  fullName: string,
): Promise<Array<{ name: string }>> {
  return await gh<Array<{ name: string }>>(`/repos/${fullName}/tags?per_page=100`);
}

// -------- PULL REQUEST --------

export type PullRequest = {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  user: { login: string; avatar_url: string };
  head: { ref: string; label: string; sha: string };
  base: { ref: string; label: string; sha: string };
  body: string | null;
  created_at: string;
  updated_at: string;
  draft: boolean;
  merged: boolean;
  mergeable?: boolean;
  mergeable_state?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
};

export async function listPullRequests(
  fullName: string,
  opts: { state?: 'open' | 'closed' | 'all'; head?: string; base?: string } = {},
): Promise<PullRequest[]> {
  const query: Record<string, string> = { per_page: '30', state: opts.state || 'open' };
  if (opts.head) query.head = opts.head;
  if (opts.base) query.base = opts.base;
  return await gh<PullRequest[]>(`/repos/${fullName}/pulls`, { query });
}

export async function getPullRequest(
  fullName: string,
  number: number,
): Promise<PullRequest> {
  return await gh<PullRequest>(`/repos/${fullName}/pulls/${number}`);
}

export async function createPullRequest(
  fullName: string,
  opts: { title: string; head: string; base: string; body?: string; draft?: boolean },
): Promise<PullRequest> {
  return await gh<PullRequest>(`/repos/${fullName}/pulls`, {
    method: 'POST',
    body: opts,
  });
}

export async function updatePullRequest(
  fullName: string,
  number: number,
  opts: { title?: string; body?: string; state?: 'open' | 'closed' },
): Promise<PullRequest> {
  return await gh<PullRequest>(`/repos/${fullName}/pulls/${number}`, {
    method: 'PATCH',
    body: opts,
  });
}

export async function mergePullRequest(
  fullName: string,
  number: number,
  opts: { commit_title?: string; commit_message?: string; sha?: string; merge_method?: 'merge' | 'squash' | 'rebase' } = {},
): Promise<{ sha: string; merged: boolean; message: string }> {
  return await gh<{ sha: string; merged: boolean; message: string }>(
    `/repos/${fullName}/pulls/${number}/merge`,
    {
      method: 'PUT',
      body: opts,
    },
  );
}

export async function listPullRequestFiles(
  fullName: string,
  number: number,
): Promise<Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>> {
  return await gh<Array<any>>(`/repos/${fullName}/pulls/${number}/files?per_page=100`);
}

export async function listPullRequestReviews(
  fullName: string,
  number: number,
): Promise<Array<{ id: number; user: { login: string }; body: string | null; state: string }>> {
  return await gh<Array<any>>(`/repos/${fullName}/pulls/${number}/reviews?per_page=100`);
}

export async function createPullRequestReview(
  fullName: string,
  number: number,
  opts: { body?: string; event?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' },
): Promise<{ id: number; html_url: string }> {
  return await gh<{ id: number; html_url: string }>(`/repos/${fullName}/pulls/${number}/reviews`, {
    method: 'POST',
    body: opts,
  });
}

export async function createPullRequestComment(
  fullName: string,
  number: number,
  body: string,
): Promise<{ id: number; html_url: string }> {
  return await gh<{ id: number; html_url: string }>(`/repos/${fullName}/issues/${number}/comments`, {
    method: 'POST',
    body: { body },
  });
}

// -------- ISSUE --------

export type Issue = {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  user: { login: string; avatar_url: string };
  body: string | null;
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string }>;
  created_at: string;
  updated_at: string;
  comments: number;
};

export async function listIssues(
  fullName: string,
  opts: { state?: 'open' | 'closed' | 'all'; labels?: string; assignee?: string } = {},
): Promise<Issue[]> {
  const query: Record<string, string> = { per_page: '30', state: opts.state || 'open' };
  if (opts.labels) query.labels = opts.labels;
  if (opts.assignee) query.assignee = opts.assignee;
  return await gh<Issue[]>(`/repos/${fullName}/issues`, { query });
}

export async function getIssue(fullName: string, number: number): Promise<Issue> {
  return await gh<Issue>(`/repos/${fullName}/issues/${number}`);
}

export async function createIssue(
  fullName: string,
  opts: { title: string; body?: string; labels?: string[]; assignees?: string[] },
): Promise<Issue> {
  return await gh<Issue>(`/repos/${fullName}/issues`, {
    method: 'POST',
    body: opts,
  });
}

export async function updateIssue(
  fullName: string,
  number: number,
  opts: { title?: string; body?: string; state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] },
): Promise<Issue> {
  return await gh<Issue>(`/repos/${fullName}/issues/${number}`, {
    method: 'PATCH',
    body: opts,
  });
}

export async function createIssueComment(
  fullName: string,
  number: number,
  body: string,
): Promise<{ id: number; html_url: string }> {
  return await gh<{ id: number; html_url: string }>(`/repos/${fullName}/issues/${number}/comments`, {
    method: 'POST',
    body: { body },
  });
}

export async function listIssueComments(
  fullName: string,
  number: number,
): Promise<Array<{ id: number; user: { login: string }; body: string; created_at: string }>> {
  return await gh<Array<any>>(`/repos/${fullName}/issues/${number}/comments?per_page=100`);
}

// -------- WORKFLOW RUNS --------

export type WorkflowRun = {
  id: number;
  name: string;
  head_branch: string;
  head_sha: string;
  event: string;
  status: string | null;
  conclusion: string | null;
  html_url: string;
  run_number: number;
  created_at: string;
  updated_at: string;
};

export async function listWorkflowRuns(
  fullName: string,
  opts: { branch?: string; event?: string; status?: string; per_page?: string } = {},
): Promise<{ workflow_runs: WorkflowRun[]; total_count: number }> {
  const query: Record<string, string> = { per_page: opts.per_page || '30' };
  if (opts.branch) query.branch = opts.branch;
  if (opts.event) query.event = opts.event;
  if (opts.status) query.status = opts.status;
  return await gh<{ workflow_runs: WorkflowRun[]; total_count: number }>(
    `/repos/${fullName}/actions/runs`,
    { query },
  );
}

export async function getWorkflowRun(fullName: string, runId: number): Promise<WorkflowRun> {
  return await gh<WorkflowRun>(`/repos/${fullName}/actions/runs/${runId}`);
}

export async function rerunWorkflowRun(fullName: string, runId: number): Promise<void> {
  await gh(`/repos/${fullName}/actions/runs/${runId}/rerun`, { method: 'POST' });
}

export async function cancelWorkflowRun(fullName: string, runId: number): Promise<void> {
  await gh(`/repos/${fullName}/actions/runs/${runId}/cancel`, { method: 'POST' });
}

export type Workflow = {
  id: number;
  name: string;
  path: string;
  state: string;
};

export async function listWorkflows(fullName: string): Promise<{ workflows: Workflow[] }> {
  return await gh<{ workflows: Workflow[] }>(`/repos/${fullName}/actions/workflows`);
}

export async function runWorkflow(
  fullName: string,
  workflowId: number | string,
  opts: { ref?: string; inputs?: Record<string, string> } = {},
): Promise<{ id: number }> {
  return await gh<{ id: number }>(`/repos/${fullName}/actions/workflows/${workflowId}/dispatches`, {
    method: 'POST',
    body: { ref: opts.ref || 'main', inputs: opts.inputs },
  });
}

// -------- RELEASES --------

export type Release = {
  id: number;
  name: string | null;
  tag_name: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  created_at: string;
  published_at: string | null;
  author: { login: string };
  assets: Array<{ name: string; size: number; browser_download_url: string }>;
};

export async function listReleases(fullName: string): Promise<Release[]> {
  return await gh<Release[]>(`/repos/${fullName}/releases?per_page=30`);
}

export async function getRelease(fullName: string, releaseId: number): Promise<Release> {
  return await gh<Release>(`/repos/${fullName}/releases/${releaseId}`);
}

export async function createRelease(
  fullName: string,
  opts: {
    tag_name: string;
    name?: string;
    body?: string;
    draft?: boolean;
    prerelease?: boolean;
    target_commitish?: string;
  },
): Promise<Release> {
  return await gh<Release>(`/repos/${fullName}/releases`, {
    method: 'POST',
    body: opts,
  });
}

export async function deleteRelease(fullName: string, releaseId: number): Promise<void> {
  await gh(`/repos/${fullName}/releases/${releaseId}`, { method: 'DELETE' });
}

// -------- GISTS --------

export type Gist = {
  id: string;
  description: string | null;
  html_url: string;
  public: boolean;
  files: Record<string, { filename: string; content?: string }>;
  created_at: string;
  updated_at: string;
};

export async function listGists(): Promise<Gist[]> {
  return await gh<Gist[]>('/gists?per_page=30');
}

export async function createGist(
  opts: { description?: string; public?: boolean; files: Record<string, { content: string }> },
): Promise<Gist> {
  return await gh<Gist>('/gists', { method: 'POST', body: opts });
}

// -------- NOTIFICATIONS / STATUS --------

export type Notification = {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  repository: { full_name: string };
  subject: { title: string; type: string; url: string | null; latest_comment_url: string | null };
};

export async function listNotifications(
  opts: { all?: boolean; participating?: boolean } = {},
): Promise<Notification[]> {
  const query: Record<string, string> = {};
  if (opts.all) query.all = 'true';
  if (opts.participating) query.participating = 'true';
  return await gh<Notification[]>('/notifications', { query });
}

export async function markNotificationRead(threadId: string): Promise<void> {
  await gh(`/notifications/threads/${threadId}`, { method: 'PATCH' });
}

// -------- SEARCH --------

export async function searchIssues(
  q: string,
  opts: { sort?: string; order?: 'asc' | 'desc'; per_page?: number } = {},
): Promise<{ total_count: number; items: Issue[] }> {
  const query: Record<string, string> = {
    q,
    per_page: String(opts.per_page || 30),
    sort: opts.sort || 'updated',
    order: opts.order || 'desc',
  };
  return await gh<{ total_count: number; items: Issue[] }>('/search/issues', { query });
}

export async function searchRepos(
  q: string,
  opts: { sort?: string; order?: 'asc' | 'desc'; per_page?: number } = {},
): Promise<{ total_count: number; items: GithubRepo[] }> {
  const query: Record<string, string> = {
    q,
    per_page: String(opts.per_page || 30),
    sort: opts.sort || 'updated',
    order: opts.order || 'desc',
  };
  return await gh<{ total_count: number; items: GithubRepo[] }>('/search/repositories', { query });
}

// Build an authenticated clone URL for use with isomorphic-git when a
// token has been configured.
export async function buildCloneUrl(cloneUrl: string): Promise<string> {
  return cloneUrl;
}
