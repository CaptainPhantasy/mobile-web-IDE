import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  FloydApiError,
  FloydClient,
  type ExperienceEnvelope,
  type ExperienceEnvelopePatch,
} from '@floyd/sdk';

const tokenFile = process.env.FLOYD_GATEWAY_TOKEN_FILE || '/Volumes/Storage/FLOYD_RUNTIME/core/gateway.token';
export const floyd = new FloydClient({
  baseUrl: process.env.FLOYD_CORE_URL,
  token: process.env.FLOYD_GATEWAY_TOKEN || (async () => (await fs.readFile(tokenFile, 'utf8')).trim()),
});

export const FLOYD_IDE_SURFACE_ID = 'ide';
export const FLOYD_IDE_CAPABILITIES = [
  'active-context',
  'artifacts',
  'coding-runs',
  'composer',
  'drafts',
  'durable-transcript',
  'experience-stream',
  'files',
  'model-route-display',
  'permissions',
  'questions',
  'selected-view',
  'terminal',
  'workspaces',
] as const;

export type FloydProjectSummary = { id: string; name: string; root_path: string };

export async function negotiateFloydExperience(signal: AbortSignal) {
  return floyd.negotiateExperience({
    surface_id: FLOYD_IDE_SURFACE_ID,
    capabilities: [...FLOYD_IDE_CAPABILITIES],
  }, signal);
}

export async function getFloydExperience(signal: AbortSignal): Promise<{
  envelope: ExperienceEnvelope;
  project: FloydProjectSummary | null;
}> {
  const [envelope, state] = await Promise.all([floyd.experience('primary', signal), floyd.state(signal)]);
  const project = envelope.active.project_id
    ? state.projects.find((candidate) => candidate.id === envelope.active.project_id) ?? null
    : null;
  return { envelope, project };
}

export async function getFloydProject(projectId: string, signal: AbortSignal): Promise<FloydProjectSummary | null> {
  const state = await floyd.state(signal);
  return state.projects.find((candidate) => candidate.id === projectId) ?? null;
}

export function updateFloydExperience(patch: ExperienceEnvelopePatch, signal: AbortSignal): Promise<ExperienceEnvelope> {
  return floyd.updateExperience('primary', patch, signal);
}

export function answerFloydQuestion(
  sessionId: string,
  runId: string,
  requestId: string,
  answers: string[][],
  signal: AbortSignal,
): Promise<unknown> {
  return floyd.answer(sessionId, requestId, answers, 'mobile-web-ide', signal, runId);
}

export function decideFloydPermission(
  sessionId: string,
  runId: string,
  requestId: string,
  reply: 'once' | 'always' | 'reject',
  signal: AbortSignal,
): Promise<unknown> {
  return floyd.permission(sessionId, requestId, reply, 'mobile-web-ide', signal, runId);
}

export async function publishFloydWorkspace(rootPath: string, expectedRevision: number, signal: AbortSignal): Promise<ExperienceEnvelope> {
  const current = await floyd.experience('primary', signal);
  if (current.revision !== expectedRevision) {
    throw new FloydApiError('PATCH', '/api/experience/primary', 409, {
      error: 'revision_conflict',
      expected_revision: expectedRevision,
      actual_revision: current.revision,
      envelope: current,
    });
  }
  const projectId = await resolveFloydProject(rootPath, signal);
  return updateFloydExperience({
    expected_revision: expectedRevision,
    active: { project_id: projectId, session_id: null, run_id: null },
    selected_artifact_id: null,
    selected_view: 'ide:files',
  }, signal);
}

export async function publishFloydRunContext(
  projectId: string,
  sessionId: string,
  runId: string,
  signal: AbortSignal,
): Promise<ExperienceEnvelope> {
  const current = await floyd.experience('primary', signal);
  return updateFloydExperience({
    expected_revision: current.revision,
    active: { project_id: projectId, session_id: sessionId, run_id: runId },
    selected_view: 'ide:ai',
  }, signal);
}

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
