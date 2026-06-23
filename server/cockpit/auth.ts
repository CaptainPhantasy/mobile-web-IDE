// Cockpit token auth. checkAuth is pure (env injected) for unit testing.
import { timingSafeEqual } from 'crypto';
import type { Request, RequestHandler } from 'express';
import type { AuthConfig } from './types';

export interface AuthResult {
  ok: boolean;
  status?: 401 | 503;
  error?: string;
}

export function extractToken(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const auth = headers['authorization'] ?? headers['Authorization'];
  const authStr = Array.isArray(auth) ? auth[0] : auth;
  if (typeof authStr === 'string' && authStr.startsWith('Bearer ')) {
    const t = authStr.slice('Bearer '.length).trim();
    if (t.length > 0) return t;
  }
  const custom = headers['x-mwide-cockpit-token'] ?? headers['X-MWIDE-Cockpit-Token'];
  const customStr = Array.isArray(custom) ? custom[0] : custom;
  if (typeof customStr === 'string' && customStr.length > 0) return customStr;
  return null;
}

export function checkAuth(
  presentedToken: string | null,
  authConfig: AuthConfig,
  env: NodeJS.ProcessEnv = process.env,
): AuthResult {
  if (!authConfig.required) return { ok: true };
  const expected = env[authConfig.tokenEnv];
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: `Cockpit auth is required but ${authConfig.tokenEnv} is not configured`,
    };
  }
  if (!presentedToken) return { ok: false, status: 401, error: 'Unauthorized' };
  const a = Buffer.from(presentedToken);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

export function authMiddleware(getAuthConfig: () => AuthConfig | null): RequestHandler {
  return (req: Request, res, next) => {
    const authConfig = getAuthConfig();
    if (!authConfig) {
      res.status(503).json({ ok: false, error: 'Cockpit config is missing or invalid' });
      return;
    }
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const result = checkAuth(extractToken(headers), authConfig);
    if (result.ok) {
      next();
      return;
    }
    res.status(result.status).json({ ok: false, error: result.error });
  };
}
