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
