// ---- API envelope ----
export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: string; details?: unknown };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

// ---- Config ----
export type ActionKind = 'read' | 'write' | 'verify' | 'deploy' | 'destructive';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type ActionConfig = {
  id: string;
  label: string;
  kind: ActionKind;
  command: string;        // must be allowlisted; no spaces
  args: string[];         // array; no shell-control tokens
  confirm: boolean;       // MUST be true when kind === 'destructive'
  shellScript?: boolean;  // only true permits command 'bash'|'zsh'; args[0] must be inside repo path
  timeoutMs?: number;     // clamped to [1000, 900000]; default 120000
};

export type RepoConfig = {
  id: string;
  label: string;
  path: string;           // absolute; must resolve inside a workspaceRoot
  github?: string;        // "owner/repo"
  packageManager?: PackageManager;
  defaultBranch?: string;
  actions: ActionConfig[];
};

export type AuthConfig = { required: boolean; tokenEnv: string };

export type CockpitConfig = {
  version: number;
  auth: AuthConfig;
  workspaceRoots: string[];
  repos: RepoConfig[];
};

// ---- Derived / responses ----
export type ConfigStatus = {
  configPresent: boolean;
  configPath: string;
  valid: boolean;
  errors: string[];
  authRequired: boolean;
  authConfigured: boolean;   // env token present — NEVER the token value
  githubConfigured: boolean; // GITHUB_TOKEN or GH_TOKEN present
  repoCount: number;
};

export type HealthStatus = { status: 'ok'; service: 'mwide-cockpit'; time: string };

export type RepoSummary = {
  id: string; label: string; path: string;
  github: string | null;
  packageManager: PackageManager | null;
  defaultBranch: string | null;
  actionCount: number;
};

export type RepoDetail = RepoSummary & { actions: ActionConfig[] };

export type RepoStatus = {
  repoId: string;
  path: string;
  exists: boolean;
  branch: string | null;
  clean: boolean;
  ahead: number;
  behind: number;
  changedFiles: Array<{ path: string; status: string }>;
  lastCommit: { sha: string; subject: string; author: string; date: string } | null;
};

export type RunActionRequest = { confirm?: boolean };

export type ActionRunResult = {
  repoId: string; actionId: string;
  command: string; args: string[];
  exitCode: number | null; signal: string | null;
  timedOut: boolean;
  startedAt: string; endedAt: string; durationMs: number;
  stdout: string; stderr: string;
};

export type AuditEntry = {
  timestamp: string; repoId: string; actionId: string;
  command: string; args: string[]; cwd: string;
  exitCode: number | null; signal: string | null;
  durationMs: number; timedOut: boolean;
  userAgent?: string; remoteAddress?: string;
};

export type CockpitPullRequest = {
  number: number; title: string; state: string; draft: boolean;
  htmlUrl: string; headRef: string; baseRef: string; author: string; updatedAt: string;
};
export type CockpitIssue = {
  number: number; title: string; state: string; htmlUrl: string;
  author: string; updatedAt: string; labels: string[];
};
export type CockpitWorkflowRun = {
  id: number; name: string; status: string; conclusion: string | null;
  event: string; branch: string; htmlUrl: string; createdAt: string; updatedAt: string;
};

export type BranchInfo = { name: string; current: boolean };
