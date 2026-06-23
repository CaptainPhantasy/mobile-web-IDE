// Client mirror of the cockpit API contract. Kept in sync with
// server/cockpit/types.ts (separate compilation roots; do not cross-import).

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: string; details?: unknown };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type ActionKind = 'read' | 'write' | 'verify' | 'deploy' | 'destructive';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface ActionConfig {
  id: string;
  label: string;
  kind: ActionKind;
  command: string;
  args: string[];
  confirm: boolean;
  shellScript?: boolean;
  timeoutMs?: number;
}

export interface RepoSummary {
  id: string;
  label: string;
  path: string;
  github: string | null;
  packageManager: PackageManager | null;
  defaultBranch: string | null;
  actionCount: number;
}

export interface RepoDetail extends RepoSummary {
  actions: ActionConfig[];
}

export interface ConfigStatus {
  configPresent: boolean;
  configPath: string;
  valid: boolean;
  errors: string[];
  authRequired: boolean;
  authConfigured: boolean;
  githubConfigured: boolean;
  repoCount: number;
}

export interface HealthStatus {
  status: 'ok';
  service: 'mwide-cockpit';
  time: string;
}

export interface ChangedFile {
  path: string;
  status: string;
}

export interface CommitInfo {
  sha: string;
  subject: string;
  author: string;
  date: string;
}

export interface RepoStatus {
  repoId: string;
  path: string;
  exists: boolean;
  branch: string | null;
  clean: boolean;
  ahead: number;
  behind: number;
  changedFiles: ChangedFile[];
  lastCommit: CommitInfo | null;
}

export interface RunActionRequest {
  confirm?: boolean;
}

export interface ActionRunResult {
  repoId: string;
  actionId: string;
  command: string;
  args: string[];
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface AuditEntry {
  timestamp: string;
  repoId: string;
  actionId: string;
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  timedOut: boolean;
  userAgent?: string;
  remoteAddress?: string;
}

export interface CockpitPullRequest {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  htmlUrl: string;
  headRef: string;
  baseRef: string;
  author: string;
  updatedAt: string;
}

export interface CockpitIssue {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  author: string;
  updatedAt: string;
  labels: string[];
}

export interface CockpitWorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  event: string;
  branch: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface BranchInfo {
  name: string;
  current: boolean;
}
