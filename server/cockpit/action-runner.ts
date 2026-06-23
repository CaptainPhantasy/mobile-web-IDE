// Safe action runner: allowlist + spawn(shell:false) + arg-token rejection +
// workspace confinement + confirm gating + timeout cap + audit. NEVER uses exec.
import { spawn } from 'child_process';
import path from 'path';
import type { CockpitConfig, RepoConfig, ActionConfig, ActionRunResult, AuditEntry } from './types';
import {
  ALLOWED_COMMANDS,
  SHELL_COMMANDS,
  SHELL_CONTROL_TOKENS,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  getRepo,
  getAction,
  resolveRepoPath,
} from './repo-registry';
import { appendAudit } from './audit-log';

export interface RunOutcome {
  ok: boolean;
  result?: ActionRunResult;
  status?: number;
  error?: string;
}

export interface PreflightResult {
  ok: boolean;
  cwd?: string;
  status?: number;
  error?: string;
}

export interface ArgValidation {
  ok: boolean;
  error?: string;
}

export interface ExecuteActionOptions {
  confirm?: boolean;
  userAgent?: string;
  remoteAddress?: string;
  auditPath?: string;
  spawnImpl?: typeof spawn;
  now?: () => number;
}

const MAX_OUTPUT_BYTES = 1_000_000;

export function clampTimeout(ms?: number): number {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return DEFAULT_TIMEOUT_MS;
  if (ms < 1000) return 1000;
  if (ms > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
  return ms;
}

export function validateActionArgs(command: string, args: string[]): ArgValidation {
  if (typeof command !== 'string' || command.includes(' ')) {
    return { ok: false, error: `command must not contain spaces: ${command}` };
  }
  if (!Array.isArray(args)) return { ok: false, error: 'args must be an array' };
  for (const arg of args) {
    if (typeof arg !== 'string') return { ok: false, error: 'args must all be strings' };
    for (const tok of SHELL_CONTROL_TOKENS) {
      if (arg.includes(tok)) {
        return { ok: false, error: `arg contains shell-control token: ${JSON.stringify(tok)}` };
      }
    }
  }
  return { ok: true };
}

export function preflight(
  repo: RepoConfig,
  action: ActionConfig,
  workspaceRoots: string[],
  confirm: boolean | undefined,
): PreflightResult {
  const resolved = resolveRepoPath(repo, workspaceRoots);
  if (!resolved.ok) return { ok: false, status: 400, error: resolved.error };
  const cwd = resolved.path;

  if (!ALLOWED_COMMANDS.includes(action.command)) {
    return { ok: false, status: 400, error: `command not allowlisted: ${action.command}` };
  }
  if (SHELL_COMMANDS.includes(action.command)) {
    if (action.shellScript !== true) {
      return { ok: false, status: 400, error: `command '${action.command}' requires shellScript:true` };
    }
    const script = action.args[0];
    if (typeof script !== 'string') {
      return { ok: false, status: 400, error: 'shellScript action requires a script path as the first arg' };
    }
    const resolvedScript = path.resolve(cwd, script);
    if (resolvedScript !== cwd && !resolvedScript.startsWith(cwd + path.sep)) {
      return { ok: false, status: 400, error: 'shellScript path must be inside the repo' };
    }
  }
  const argsCheck = validateActionArgs(action.command, action.args);
  if (!argsCheck.ok) return { ok: false, status: 400, error: argsCheck.error };

  if (action.confirm || action.kind === 'destructive') {
    if (confirm !== true) {
      return { ok: false, status: 400, error: `Confirmation required for action: ${action.id}` };
    }
  }
  return { ok: true, cwd };
}

export async function executeAction(
  config: CockpitConfig,
  repoId: string,
  actionId: string,
  opts: ExecuteActionOptions,
): Promise<RunOutcome> {
  const repo = getRepo(config, repoId);
  if (!repo) return { ok: false, status: 404, error: `unknown repo: ${repoId}` };
  const action = getAction(repo, actionId);
  if (!action) return { ok: false, status: 404, error: `unknown action: ${actionId}` };

  const pre = preflight(repo, action, config.workspaceRoots, opts.confirm);
  if (!pre.ok) return { ok: false, status: pre.status, error: pre.error };

  const cwd = pre.cwd;
  const timeout = clampTimeout(action.timeoutMs);
  const spawnImpl = opts.spawnImpl ?? spawn;
  const now = opts.now ?? Date.now;
  const startMs = now();
  const startedAt = new Date(startMs).toISOString();

  const { promise, resolve } = Promise.withResolvers<ActionRunResult>();
  let stdout = '';
  let stderr = '';
  let outBytes = 0;
  let errBytes = 0;
  let timedOut = false;
  let settled = false;

  const child = spawnImpl(action.command, action.args, {
    cwd,
    shell: false,
    env: process.env,
  });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, timeout);

  const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const endMs = now();
    resolve({
      repoId,
      actionId,
      command: action.command,
      args: action.args,
      exitCode,
      signal: signal ?? null,
      timedOut,
      startedAt,
      endedAt: new Date(endMs).toISOString(),
      durationMs: endMs - startMs,
      stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
      stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
    });
  };

  child.stdout?.on('data', (d: Buffer) => {
    if (outBytes < MAX_OUTPUT_BYTES) {
      stdout += d.toString();
      outBytes += d.length;
    }
  });
  child.stderr?.on('data', (d: Buffer) => {
    if (errBytes < MAX_OUTPUT_BYTES) {
      stderr += d.toString();
      errBytes += d.length;
    }
  });
  child.on('error', (err: Error) => {
    stderr += `\n[spawn error] ${err.message}`;
    finish(null, null);
  });
  child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    finish(code, signal);
  });

  const result = await promise;

  const audit: AuditEntry = {
    timestamp: startedAt,
    repoId,
    actionId,
    command: action.command,
    args: action.args,
    cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    userAgent: opts.userAgent,
    remoteAddress: opts.remoteAddress,
  };
  try {
    await appendAudit(audit, { auditPath: opts.auditPath });
  } catch {
    // audit is best-effort; never fail the action because logging failed
  }

  return { ok: true, result };
}
