import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FloydApiError, FloydClient } from '@floyd/sdk';

const tokenFile = process.env.FLOYD_GATEWAY_TOKEN_FILE || '/Volumes/Storage/FLOYD_RUNTIME/core/gateway.token';
export const floyd = new FloydClient({
  baseUrl: process.env.FLOYD_CORE_URL,
  token: process.env.FLOYD_GATEWAY_TOKEN || (async () => (await fs.readFile(tokenFile, 'utf8')).trim()),
});

export async function resolveFloydProject(rootPath: string, signal: AbortSignal): Promise<string> {
  const state = await floyd.state(signal);
  const configured = process.env.FLOYD_PROJECT_ID;
  if (configured) {
    if (!state.projects.some((project) => project.id === configured)) throw new Error(`Unknown FLOYD_PROJECT_ID: ${configured}`);
    return configured;
  }
  const existing = state.projects.find((project) => project.root_path === rootPath);
  if (existing) return existing.id;
  const created = await floyd.registerProject({ name: path.basename(rootPath), root_path: rootPath }, signal);
  return created.id;
}

export { FloydApiError };
