// Cockpit config registry: load + validate + allowlist. Pure validator (no fs)
// so it is unit-testable against the example config object.
import path from 'path';
import fs from 'fs';
import type {
  CockpitConfig,
  RepoConfig,
  ActionConfig,
  RepoSummary,
  RepoDetail,
  PackageManager,
  ActionKind,
} from './types';

export const ALLOWED_COMMANDS: readonly string[] = [
  'git', 'npm', 'pnpm', 'yarn', 'bun', 'node', 'npx', 'vercel', 'gh', 'tsx', 'bash', 'zsh',
];
export const SHELL_COMMANDS: readonly string[] = ['bash', 'zsh'];
export const SHELL_CONTROL_TOKENS: readonly string[] = [
  ';', '&&', '||', '|', '>', '<', '`', '$(', '${', '\n', '\r',
];
export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 900_000;

const VALID_KINDS: readonly ActionKind[] = ['read', 'write', 'verify', 'deploy', 'destructive'];
const VALID_PMS: readonly PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  config: CockpitConfig | null;
}
export interface ConfigLoadResult {
  config: CockpitConfig | null;
  errors: string[];
  configPath: string;
  present: boolean;
}
export interface RepoPathResolution {
  ok: boolean;
  path?: string;
  error?: string;
}

export function defaultConfigPath(): string {
  return path.resolve(process.cwd(), 'mwide.repos.json');
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateConfig(raw: unknown): ConfigValidationResult {
  const errors: string[] = [];
  if (!isObj(raw)) {
    return { valid: false, errors: ['config must be a JSON object'], config: null };
  }

  if (typeof raw.version !== 'number') errors.push('missing or invalid version (must be a number)');

  const auth = raw.auth;
  if (!isObj(auth) || typeof auth.required !== 'boolean' || typeof auth.tokenEnv !== 'string') {
    errors.push('missing or invalid auth (must be { required: boolean, tokenEnv: string })');
  }

  const workspaceRoots = raw.workspaceRoots;
  const rootsValid =
    Array.isArray(workspaceRoots) &&
    workspaceRoots.length > 0 &&
    workspaceRoots.every((r) => typeof r === 'string');
  if (!rootsValid) errors.push('missing or empty workspaceRoots (must be a non-empty string array)');
  const roots: string[] = rootsValid
    ? (workspaceRoots as string[]).map((r) => path.resolve(r))
    : [];

  const repos = raw.repos;
  if (!Array.isArray(repos)) {
    errors.push('missing repos (must be an array)');
    return { valid: false, errors, config: null };
  }

  const repoIds = new Set<string>();
  repos.forEach((repo, ri) => {
    if (!isObj(repo)) {
      errors.push(`repos[${ri}] must be an object`);
      return;
    }
    const id = repo.id;
    const idLabel = typeof id === 'string' && id.length > 0 ? id : String(ri);
    if (typeof id !== 'string' || id.length === 0) {
      errors.push(`repos[${ri}] has empty or missing id`);
    } else {
      if (repoIds.has(id)) errors.push(`duplicate repo ids: ${id}`);
      repoIds.add(id);
    }
    if (typeof repo.label !== 'string') errors.push(`repo '${idLabel}' missing label`);
    if (typeof repo.path !== 'string' || repo.path.length === 0) {
      errors.push(`repo '${idLabel}' missing path`);
    } else if (roots.length > 0) {
      const resolved = path.resolve(repo.path);
      const inside = roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
      if (!inside) errors.push(`repo '${idLabel}' path is outside workspaceRoots: ${repo.path}`);
    }
    if (repo.packageManager !== undefined && !VALID_PMS.includes(repo.packageManager as PackageManager)) {
      errors.push(`repo '${idLabel}' has invalid packageManager`);
    }

    const actions = repo.actions;
    if (!Array.isArray(actions)) {
      errors.push(`repo '${idLabel}' actions must be an array`);
      return;
    }
    const actionIds = new Set<string>();
    actions.forEach((action, ai) => {
      if (!isObj(action)) {
        errors.push(`repo '${idLabel}' actions[${ai}] must be an object`);
        return;
      }
      const aid = action.id;
      const aLabel =
        typeof aid === 'string' && aid.length > 0 ? `repo '${idLabel}' action '${aid}'` : `repo '${idLabel}' actions[${ai}]`;
      if (typeof aid !== 'string' || aid.length === 0) {
        errors.push(`repo '${idLabel}' actions[${ai}] has empty or missing id`);
      } else {
        if (actionIds.has(aid)) errors.push(`repo '${idLabel}' has duplicate action ids: ${aid}`);
        actionIds.add(aid);
      }
      if (typeof action.label !== 'string') errors.push(`${aLabel} missing label`);
      if (typeof action.kind !== 'string' || !VALID_KINDS.includes(action.kind as ActionKind)) {
        errors.push(`${aLabel} has invalid kind`);
      }
      const command = action.command;
      if (typeof command !== 'string' || command.length === 0) {
        errors.push(`${aLabel} missing command`);
      } else {
        if (command.includes(' ')) errors.push(`${aLabel} command must not contain spaces: ${command}`);
        if (!ALLOWED_COMMANDS.includes(command)) errors.push(`${aLabel} command not allowlisted: ${command}`);
        if (SHELL_COMMANDS.includes(command) && action.shellScript !== true) {
          errors.push(`${aLabel} command '${command}' requires shellScript:true`);
        }
      }
      const args = action.args;
      if (!Array.isArray(args)) {
        errors.push(`${aLabel} args must be an array`);
      } else {
        args.forEach((arg, gi) => {
          if (typeof arg !== 'string') {
            errors.push(`${aLabel} args[${gi}] must be a string`);
            return;
          }
          for (const tok of SHELL_CONTROL_TOKENS) {
            if (arg.includes(tok)) {
              errors.push(`${aLabel} args[${gi}] contains shell-control token: ${JSON.stringify(tok)}`);
              break;
            }
          }
        });
      }
      if (typeof action.confirm !== 'boolean') errors.push(`${aLabel} missing confirm (boolean)`);
      if (action.kind === 'destructive' && action.confirm !== true) {
        errors.push(`${aLabel} is destructive and must set confirm:true`);
      }
      if (action.timeoutMs !== undefined) {
        if (typeof action.timeoutMs !== 'number') errors.push(`${aLabel} timeoutMs must be a number`);
        else if (action.timeoutMs > MAX_TIMEOUT_MS) errors.push(`${aLabel} timeoutMs exceeds max ${MAX_TIMEOUT_MS}`);
      }
    });
  });

  const valid = errors.length === 0;
  return { valid, errors, config: valid ? (raw as unknown as CockpitConfig) : null };
}

export function loadConfig(opts?: { configPath?: string }): ConfigLoadResult {
  const configPath = opts?.configPath ?? defaultConfigPath();
  if (!fs.existsSync(configPath)) {
    return { config: null, errors: [`config file not found: ${configPath}`], configPath, present: false };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    return { config: null, errors: [`invalid JSON in ${configPath}: ${(e as Error).message}`], configPath, present: true };
  }
  const { config, errors } = validateConfig(raw);
  return { config, errors, configPath, present: true };
}

export function getRepo(config: CockpitConfig, repoId: string): RepoConfig | null {
  return config.repos.find((r) => r.id === repoId) ?? null;
}

export function getAction(repo: RepoConfig, actionId: string): ActionConfig | null {
  return repo.actions.find((a) => a.id === actionId) ?? null;
}

export function resolveRepoPath(repo: RepoConfig, workspaceRoots: string[]): RepoPathResolution {
  const resolved = path.resolve(repo.path);
  const inside = workspaceRoots.some((root) => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
  if (!inside) return { ok: false, error: `repo path is outside workspaceRoots: ${repo.path}` };
  return { ok: true, path: resolved };
}

export function toSummary(repo: RepoConfig): RepoSummary {
  return {
    id: repo.id,
    label: repo.label,
    path: repo.path,
    github: repo.github ?? null,
    packageManager: repo.packageManager ?? null,
    defaultBranch: repo.defaultBranch ?? null,
    actionCount: repo.actions.length,
  };
}

export function toDetail(repo: RepoConfig): RepoDetail {
  return { ...toSummary(repo), actions: repo.actions };
}
