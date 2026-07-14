import type { ExperienceEnvelope, ExperienceEnvelopePatch } from '@floyd/sdk';

export type FloydProjectSummary = { id: string; name: string; root_path: string };
export type FloydExperienceSnapshot = { envelope: ExperienceEnvelope; project: FloydProjectSummary | null };
export type FloydExperienceEvent = { id?: string; type: string; data: ExperienceEnvelope | unknown };
export type FloydTranscriptMessage = { role: 'user' | 'assistant' | 'system'; content: string };
export type FloydTranscriptSnapshot = {
  session_id: string;
  run_id: string;
  engine_session_id: string | null;
  messages: unknown[];
};
export type FloydPublishOutcome =
  | { status: 'applied'; envelope: ExperienceEnvelope }
  | { status: 'conflict'; envelope: ExperienceEnvelope | null }
  | { status: 'failed'; error: unknown };
export type FloydDraftDivergence = { local: string; remote: string | null };
export type FloydPendingQuestion = {
  id: string;
  prompts: Array<{ prompt: string; options: string[]; multiple: boolean }>;
};
export type FloydPendingPermission = { id: string; action: string; resources: string[] };

export function draftStateAfterPublish(
  outcome: FloydPublishOutcome,
  publishedDraft: string,
  currentDraft: string,
): { dirty: boolean; divergence: FloydDraftDivergence | null } {
  if (outcome.status === 'applied' && currentDraft === publishedDraft) {
    return { dirty: false, divergence: null };
  }
  if (outcome.status === 'conflict') {
    return { dirty: true, divergence: { local: currentDraft, remote: outcome.envelope?.composer_draft ?? null } };
  }
  return { dirty: true, divergence: null };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function pendingData(value: unknown): Record<string, unknown> {
  const outer = recordValue(value);
  return Object.keys(recordValue(outer.data)).length ? recordValue(outer.data) : outer;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const option = recordValue(item);
    const display = option.label ?? option.value ?? option.name;
    if (display !== undefined) return String(display);
    return typeof item === 'string' ? item : JSON.stringify(item);
  }).filter(Boolean);
}

export function normalizePendingQuestions(values: unknown[]): FloydPendingQuestion[] {
  return values.map((value) => {
    const data = pendingData(value);
    const rawQuestions = Array.isArray(data.questions) ? data.questions : [data];
    const prompts = rawQuestions.map((raw, index) => {
      const question = recordValue(raw);
      return {
        prompt: String(question.question ?? question.prompt ?? question.text ?? question.header ?? `Question ${index + 1}`),
        options: stringList(question.options),
        multiple: question.multiple === true,
      };
    });
    return { id: String(data.id ?? data.request_id ?? ''), prompts };
  }).filter((request) => request.id && request.prompts.length);
}

export function normalizePendingPermissions(values: unknown[]): FloydPendingPermission[] {
  return values.map((value) => {
    const data = pendingData(value);
    return {
      id: String(data.id ?? data.request_id ?? ''),
      action: String(data.action ?? data.permission ?? data.kind ?? 'Requested operation'),
      resources: stringList(data.resources ?? data.paths ?? data.patterns),
    };
  }).filter((request) => request.id);
}

export function formatFloydArtifact(value: unknown): string {
  if (typeof value === 'string') return value || '(empty artifact)';
  if (value === null || value === undefined) return '(empty artifact)';
  return JSON.stringify(value, null, 2);
}

export function restoredIdeActivity(selectedView: string, selectedArtifactId: string | null): string | null {
  if (selectedArtifactId) return 'ai';
  if (!selectedView.startsWith('ide:')) return null;
  const requested = selectedView.slice(4);
  return requested === 'artifact' ? 'ai' : requested;
}

export function visibleModelRoute(route: ExperienceEnvelope['model_route']): { provider: string | null; model: string | null } {
  return { provider: route.provider, model: route.model };
}

type ExperienceContinuityOptions = {
  signal: AbortSignal;
  restore: (signal: AbortSignal) => Promise<FloydExperienceSnapshot>;
  watch: (lastEventId: string, signal: AbortSignal) => AsyncIterable<FloydExperienceEvent>;
  onSnapshot: (snapshot: FloydExperienceSnapshot) => Promise<void> | void;
  onEvent: (event: FloydExperienceEvent) => Promise<void> | void;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  retryDelaysMs?: readonly number[];
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
};

async function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, delayMs);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Reconnect at most four times; every attempt starts from a fresh restore. */
export async function maintainExperienceContinuity(options: ExperienceContinuityOptions): Promise<void> {
  const delays = options.retryDelaysMs ?? [250, 500, 1_000, 2_000];
  const sleep = options.sleep ?? abortableDelay;
  for (let attempt = 0; !options.signal.aborted; attempt += 1) {
    try {
      const snapshot = await options.restore(options.signal);
      await options.onSnapshot(snapshot);
      for await (const event of options.watch(String(snapshot.envelope.revision), options.signal)) {
        await options.onEvent(event);
      }
      if (options.signal.aborted) return;
      throw new Error('Floyd experience stream ended unexpectedly');
    } catch (error) {
      if (options.signal.aborted) return;
      if (attempt >= delays.length) throw error;
      const delayMs = delays[attempt]!;
      options.onRetry?.(error, attempt + 1, delayMs);
      await sleep(delayMs, options.signal);
    }
  }
}

export class FloydSurfaceError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Floyd surface request failed with HTTP ${status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
    this.name = 'FloydSurfaceError';
  }
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return text; }
}

export function effectiveWorkspaceRoot(virtualRoot: string, localRoot: string | null): string {
  return localRoot || virtualRoot;
}

function transcriptText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(transcriptText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (record.content !== undefined) return transcriptText(record.content);
  if (record.parts !== undefined) return transcriptText(record.parts);
  return '';
}

export function normalizeFloydTranscript(messages: unknown[]): FloydTranscriptMessage[] {
  return [...messages]
    .sort((left, right) => {
      const time = (value: unknown): number => {
        if (!value || typeof value !== 'object') return 0;
        const record = value as Record<string, any>;
        return Number(record.time?.created ?? record.info?.time?.created ?? 0);
      };
      return time(left) - time(right);
    })
    .map((value): FloydTranscriptMessage | null => {
      if (!value || typeof value !== 'object') return null;
      const record = value as Record<string, any>;
      const role = record.role ?? record.type ?? record.info?.role ?? record.info?.type;
      const content = transcriptText(record.content ?? record.parts ?? record.data);
      return content && ['user', 'assistant', 'system'].includes(role)
        ? { role, content } as FloydTranscriptMessage
        : null;
    })
    .filter((value): value is FloydTranscriptMessage => value !== null);
}

/** Browser coordinator for the same-origin IDE adapter. Core credentials stay server-side. */
export class FloydExperienceClient {
  constructor(private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)) {}

  private async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchImpl(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw new FloydSurfaceError(response.status, payload);
    return payload as T;
  }

  negotiate(signal?: AbortSignal): Promise<{ accepted: boolean; envelope_version: string | null }> {
    return this.request('POST', '/api/floyd/experience/negotiate', {}, signal);
  }

  snapshot(signal?: AbortSignal): Promise<FloydExperienceSnapshot> {
    return this.request('GET', '/api/floyd/experience', undefined, signal);
  }

  async restore(signal?: AbortSignal): Promise<FloydExperienceSnapshot> {
    await this.negotiate(signal);
    return this.snapshot(signal);
  }

  update(patch: ExperienceEnvelopePatch, signal?: AbortSignal): Promise<ExperienceEnvelope> {
    return this.request('PATCH', '/api/floyd/experience', patch, signal);
  }

  async updateOutcome(patch: ExperienceEnvelopePatch, signal?: AbortSignal): Promise<FloydPublishOutcome> {
    try {
      return { status: 'applied', envelope: await this.update(patch, signal) };
    } catch (error) {
      if (error instanceof FloydSurfaceError && error.status === 409) {
        const payload = error.payload as { envelope?: ExperienceEnvelope } | null;
        return { status: 'conflict', envelope: payload?.envelope ?? null };
      }
      return { status: 'failed', error };
    }
  }

  publishWorkspace(rootPath: string, expectedRevision: number, signal?: AbortSignal): Promise<ExperienceEnvelope> {
    return this.request('POST', '/api/floyd/workspace', {
      root_path: rootPath,
      expected_revision: expectedRevision,
    }, signal);
  }

  project(projectId: string, signal?: AbortSignal): Promise<FloydProjectSummary> {
    return this.request('GET', `/api/floyd/projects/${encodeURIComponent(projectId)}`, undefined, signal);
  }

  artifact(artifactId: string, signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', `/api/floyd/artifacts/${encodeURIComponent(artifactId)}`, undefined, signal);
  }

  transcript(sessionId: string, runId: string, signal?: AbortSignal): Promise<FloydTranscriptSnapshot> {
    return this.request(
      'GET',
      `/api/floyd/sessions/${encodeURIComponent(sessionId)}/transcript?run_id=${encodeURIComponent(runId)}`,
      undefined,
      signal,
    );
  }

  answerQuestion(sessionId: string, runId: string, requestId: string, answers: string[][], signal?: AbortSignal): Promise<unknown> {
    return this.request(
      'POST',
      `/api/floyd/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(requestId)}/answer`,
      { run_id: runId, answers },
      signal,
    );
  }

  decidePermission(
    sessionId: string,
    runId: string,
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.request(
      'POST',
      `/api/floyd/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}`,
      { run_id: runId, reply },
      signal,
    );
  }

  async *watch(lastEventId?: string, signal?: AbortSignal): AsyncGenerator<FloydExperienceEvent> {
    const response = await this.fetchImpl('/api/floyd/experience/stream', {
      headers: {
        accept: 'text/event-stream',
        ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
      },
      signal,
    });
    if (!response.ok || !response.body) throw new FloydSurfaceError(response.status, await responsePayload(response));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          let id: string | undefined;
          let type = 'message';
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('id:')) id = line.slice(3).trim();
            else if (line.startsWith('event:')) type = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
          }
          if (!dataLines.length) continue;
          const raw = dataLines.join('\n');
          let data: unknown = raw;
          try { data = JSON.parse(raw); } catch { /* plain SSE data remains text */ }
          yield { ...(id ? { id } : {}), type, data };
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

export type { ExperienceEnvelope, ExperienceEnvelopePatch };
