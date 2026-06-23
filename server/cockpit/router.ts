// Cockpit API router. Loads config per-request, returns the {ok,...} envelope on
// every route, catches all errors, and applies auth to all routes except
// /health and /config/status (liveness + bootstrap; they expose no secrets).
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ApiResponse, CockpitConfig, RepoConfig, RunActionRequest } from './types';
import { loadConfig, getRepo, toSummary, toDetail } from './repo-registry';
import { authMiddleware } from './auth';
import { getRepoStatus, getBranches } from './git-status';
import { readAudit } from './audit-log';
import { executeAction } from './action-runner';
import { listPulls, listIssues, listWorkflows, getGithubToken, GithubError } from './github-service';

export interface CockpitRouterOptions {
  configPath?: string;
  auditPath?: string;
}

export function createCockpitRouter(opts?: CockpitRouterOptions): Router {
  const router = Router();
  const configPath = opts?.configPath;
  const auditPath = opts?.auditPath;
  const load = () => loadConfig({ configPath });

  function send<T>(res: Response, status: number, body: ApiResponse<T>): void {
    res.status(status).json(body);
  }
  function ok<T>(res: Response, data: T): void {
    send(res, 200, { ok: true, data });
  }
  function fail(res: Response, status: number, error: string): void {
    send(res, status, { ok: false, error });
  }

  type AsyncHandler = (req: Request, res: Response) => Promise<void>;
  function asyncH(fn: AsyncHandler) {
    return (req: Request, res: Response): void => {
      fn(req, res).catch((err: unknown) => {
        if (err instanceof GithubError) {
          fail(res, err.status, err.message);
          return;
        }
        fail(res, 500, err instanceof Error ? err.message : 'Internal cockpit error');
      });
    };
  }

  function requireConfig(res: Response): CockpitConfig | null {
    const { config } = load();
    if (!config) {
      fail(res, 503, 'Cockpit config is missing or invalid');
      return null;
    }
    return config;
  }
  function requireRepo(req: Request, res: Response): RepoConfig | null {
    const config = requireConfig(res);
    if (!config) return null;
    const repo = getRepo(config, req.params.repoId);
    if (!repo) {
      fail(res, 404, `unknown repo: ${req.params.repoId}`);
      return null;
    }
    return repo;
  }

  // ---- Unauthenticated: liveness + bootstrap (no secrets exposed) ----
  router.get('/health', (_req, res) => {
    ok(res, { status: 'ok', service: 'mwide-cockpit', time: new Date().toISOString() });
  });

  router.get('/config/status', (_req, res) => {
    const { config, errors, configPath: cp, present } = load();
    const tokenEnv = config?.auth.tokenEnv ?? 'MWIDE_COCKPIT_TOKEN';
    ok(res, {
      configPresent: present,
      configPath: cp,
      valid: config !== null,
      errors,
      authRequired: config?.auth.required ?? true,
      authConfigured: Boolean(process.env[tokenEnv]),
      githubConfigured: getGithubToken() !== null,
      repoCount: config?.repos.length ?? 0,
    });
  });

  // ---- Everything below requires auth when configured ----
  router.use(authMiddleware(() => load().config?.auth ?? null));

  router.get('/repos', (_req, res) => {
    const config = requireConfig(res);
    if (!config) return;
    ok(res, config.repos.map(toSummary));
  });

  router.get('/repos/:repoId', (req, res) => {
    const repo = requireRepo(req, res);
    if (!repo) return;
    ok(res, toDetail(repo));
  });

  router.get(
    '/repos/:repoId/status',
    asyncH(async (req, res) => {
      const repo = requireRepo(req, res);
      if (!repo) return;
      ok(res, await getRepoStatus(repo));
    }),
  );

  router.get(
    '/repos/:repoId/branches',
    asyncH(async (req, res) => {
      const repo = requireRepo(req, res);
      if (!repo) return;
      ok(res, await getBranches(repo));
    }),
  );

  router.get(
    '/repos/:repoId/github/pulls',
    asyncH(async (req, res) => {
      const repo = requireRepo(req, res);
      if (!repo) return;
      if (!repo.github) {
        fail(res, 400, `repo '${repo.id}' has no github configured`);
        return;
      }
      ok(res, await listPulls(repo.github));
    }),
  );

  router.get(
    '/repos/:repoId/github/issues',
    asyncH(async (req, res) => {
      const repo = requireRepo(req, res);
      if (!repo) return;
      if (!repo.github) {
        fail(res, 400, `repo '${repo.id}' has no github configured`);
        return;
      }
      ok(res, await listIssues(repo.github));
    }),
  );

  router.get(
    '/repos/:repoId/github/workflows',
    asyncH(async (req, res) => {
      const repo = requireRepo(req, res);
      if (!repo) return;
      if (!repo.github) {
        fail(res, 400, `repo '${repo.id}' has no github configured`);
        return;
      }
      ok(res, await listWorkflows(repo.github));
    }),
  );

  router.get(
    '/repos/:repoId/audit',
    asyncH(async (req, res) => {
      const repo = requireRepo(req, res);
      if (!repo) return;
      ok(res, await readAudit(repo.id, { auditPath, limit: 100 }));
    }),
  );

  router.post(
    '/repos/:repoId/actions/:actionId/run',
    asyncH(async (req, res) => {
      const config = requireConfig(res);
      if (!config) return;
      const body = (req.body ?? {}) as RunActionRequest;
      const outcome = await executeAction(config, req.params.repoId, req.params.actionId, {
        confirm: body.confirm,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
        remoteAddress: req.ip,
        auditPath,
      });
      if (!outcome.ok) {
        fail(res, outcome.status, outcome.error);
        return;
      }
      ok(res, outcome.result);
    }),
  );

  return router;
}
