// Typed cockpit API client. Calls absolute /api/cockpit/* and unwraps the
// {ok,...} envelope, throwing ApiError on failure. Bearer token is the cockpit
// secret the user pastes in Settings (stored client-side; the server never
// returns the expected token).
import type {
  HealthStatus,
  ConfigStatus,
  RepoSummary,
  RepoDetail,
  RepoStatus,
  BranchInfo,
  CockpitPullRequest,
  CockpitIssue,
  CockpitWorkflowRun,
  AuditEntry,
  ActionRunResult,
  RunActionRequest,
} from './types';

const TOKEN_KEY = 'mwide:cockpit:token';

export class ApiError extends Error {
  status?: number;
  details?: unknown;
  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* localStorage unavailable */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* localStorage unavailable */
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`/api/cockpit${path}`, { ...init, headers });
  } catch (e) {
    throw new ApiError(`Network error: ${e instanceof Error ? e.message : 'unknown'}`);
  }

  let body: { ok: boolean; data?: T; error?: string; details?: unknown };
  try {
    body = (await res.json()) as { ok: boolean; data?: T; error?: string; details?: unknown };
  } catch {
    throw new ApiError(`Unexpected non-JSON response (HTTP ${res.status})`, res.status);
  }
  if (!body.ok) throw new ApiError(body.error ?? 'Request failed', res.status, body.details);
  return body.data as T;
}

export const cockpitApi = {
  health: (): Promise<HealthStatus> => call<HealthStatus>('/health'),
  configStatus: (): Promise<ConfigStatus> => call<ConfigStatus>('/config/status'),
  listRepos: (): Promise<RepoSummary[]> => call<RepoSummary[]>('/repos'),
  getRepo: (id: string): Promise<RepoDetail> => call<RepoDetail>(`/repos/${encodeURIComponent(id)}`),
  repoStatus: (id: string): Promise<RepoStatus> => call<RepoStatus>(`/repos/${encodeURIComponent(id)}/status`),
  branches: (id: string): Promise<BranchInfo[]> => call<BranchInfo[]>(`/repos/${encodeURIComponent(id)}/branches`),
  pulls: (id: string): Promise<CockpitPullRequest[]> =>
    call<CockpitPullRequest[]>(`/repos/${encodeURIComponent(id)}/github/pulls`),
  issues: (id: string): Promise<CockpitIssue[]> =>
    call<CockpitIssue[]>(`/repos/${encodeURIComponent(id)}/github/issues`),
  workflows: (id: string): Promise<CockpitWorkflowRun[]> =>
    call<CockpitWorkflowRun[]>(`/repos/${encodeURIComponent(id)}/github/workflows`),
  audit: (id: string): Promise<AuditEntry[]> => call<AuditEntry[]>(`/repos/${encodeURIComponent(id)}/audit`),
  runAction: (id: string, actionId: string, body?: RunActionRequest): Promise<ActionRunResult> =>
    call<ActionRunResult>(`/repos/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}/run`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
};
