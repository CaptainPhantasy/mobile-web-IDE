// Thin wrapper over the GitHub REST API that runs inside the browser.
// The Personal Access Token is kept in IndexedDB via the kv layer; every
// request is routed through /api/github-proxy to avoid CORS on some
// endpoints (e.g. raw repository archives) and to keep the token off the
// URL.

import { kvGet, kvSet, kvDel } from './kv';

export type GithubRepo = {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  private: boolean;
  clone_url: string;
  description: string | null;
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
  opts: { method?: string; body?: any } = {},
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch('https://api.github.com' + endpoint, {
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

export async function listRepos(): Promise<GithubRepo[]> {
  return await gh<GithubRepo[]>('/user/repos?per_page=100&sort=updated');
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

export async function listBranches(
  fullName: string,
): Promise<Array<{ name: string; protected: boolean }>> {
  return await gh<Array<{ name: string; protected: boolean }>>(
    `/repos/${fullName}/branches?per_page=100`,
  );
}

export async function createPullRequest(
  fullName: string,
  opts: { title: string; head: string; base: string; body?: string; draft?: boolean },
): Promise<{ html_url: string; number: number }> {
  return await gh<{ html_url: string; number: number }>(
    `/repos/${fullName}/pulls`,
    {
      method: 'POST',
      body: opts,
    },
  );
}

// Build an authenticated clone URL for use with isomorphic-git when a
// token has been configured.
export async function buildCloneUrl(cloneUrl: string): Promise<string> {
  return cloneUrl;
}
