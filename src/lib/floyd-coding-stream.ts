export type FloydCodingStreamEvent = {
  id?: string;
  type: 'session' | 'token' | 'tool_call' | 'done' | 'error' | string;
  text?: string;
  error?: unknown;
  tool?: string;
  sessionId?: string;
  runId?: string;
  retryable?: boolean;
};

export type FloydCodingStreamCursor = {
  sessionId?: string;
  runId?: string;
  lastEventId?: string;
  resume: boolean;
};

export type FloydCodingStreamResult = {
  status: 'complete' | 'aborted';
  sessionId?: string;
  runId?: string;
  lastEventId?: string;
};

export class FloydCodingStreamError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly detail?: unknown) {
    super(message);
    this.name = 'FloydCodingStreamError';
  }
}

type MaintainOptions<TSnapshot> = {
  signal: AbortSignal;
  open: (cursor: FloydCodingStreamCursor, signal: AbortSignal) => Promise<Response>;
  restore: (sessionId: string, runId: string, signal: AbortSignal) => Promise<TSnapshot>;
  onRestore: (snapshot: TSnapshot) => void | Promise<void>;
  onSession: (sessionId: string, runId: string) => void | Promise<void>;
  onToken: (text: string, event: FloydCodingStreamEvent) => void | Promise<void>;
  onTool?: (tool: string, event: FloydCodingStreamEvent) => void | Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number, cursor: FloydCodingStreamCursor) => void;
  onDone: (event: FloydCodingStreamEvent) => void | Promise<void>;
  retryDelaysMs?: readonly number[];
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
};

async function responseFailure(response: Response): Promise<FloydCodingStreamError> {
  const text = await response.text();
  let payload: unknown = text;
  try { payload = JSON.parse(text); } catch { /* exact text remains visible */ }
  return new FloydCodingStreamError(
    `Floyd Core returned HTTP ${response.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`,
    response.status >= 500,
    payload,
  );
}

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

/** Parse split/multiline SSE frames and always cancel the reader on exit. */
export async function* parseFloydCodingSse(response: Response, signal?: AbortSignal): AsyncGenerator<FloydCodingStreamEvent> {
  if (!response.ok || !response.body) throw await responseFailure(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted) return;
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
        try { data = JSON.parse(raw); } catch { /* plain data stays exact */ }
        const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
        yield { ...(payload as FloydCodingStreamEvent), ...(id ? { id } : {}), type };
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * Maintain one semantic coding stream. Unexpected EOF/network errors resume
 * only after a fresh durable transcript restore. Event IDs are deduplicated so
 * an inclusive Core replay cannot render or save the same token twice.
 */
export async function maintainFloydCodingStream<TSnapshot>(options: MaintainOptions<TSnapshot>): Promise<FloydCodingStreamResult> {
  const delays = options.retryDelaysMs ?? [250, 500, 1_000, 2_000];
  const sleep = options.sleep ?? abortableDelay;
  let lastDeliveredEventId: bigint | null = null;
  let cursor: FloydCodingStreamCursor = { resume: false };
  let attempt = 0;

  while (!options.signal.aborted) {
    try {
      if (cursor.resume) {
        if (!cursor.sessionId || !cursor.runId) throw new FloydCodingStreamError('Cannot resume without session and run identity', false);
        const snapshot = await options.restore(cursor.sessionId, cursor.runId, options.signal);
        if (options.signal.aborted) return { status: 'aborted', ...cursor };
        await options.onRestore(snapshot);
      }
      const response = await options.open(cursor, options.signal);
      let explicitDone = false;
      for await (const event of parseFloydCodingSse(response, options.signal)) {
        if (options.signal.aborted) return { status: 'aborted', ...cursor };
        if (event.id) {
          if (!/^\d{1,20}$/.test(event.id)) {
            throw new FloydCodingStreamError('Floyd stream returned a non-numeric event cursor', false, event);
          }
          const numericId = BigInt(event.id);
          if (lastDeliveredEventId !== null && numericId <= lastDeliveredEventId) continue;
          lastDeliveredEventId = numericId;
          cursor.lastEventId = event.id;
          attempt = 0;
        }
        if (event.type === 'session') {
          const nextSession = event.sessionId;
          const nextRun = event.runId;
          if (!nextSession || !nextRun) throw new FloydCodingStreamError('Floyd stream omitted session or run identity', false, event);
          if ((cursor.sessionId && cursor.sessionId !== nextSession) || (cursor.runId && cursor.runId !== nextRun)) {
            throw new FloydCodingStreamError('Floyd stream changed session or run identity during resume', false, event);
          }
          cursor = { ...cursor, sessionId: nextSession, runId: nextRun };
          await options.onSession(nextSession, nextRun);
        } else if (event.type === 'token') {
          if (event.text) await options.onToken(event.text, event);
        } else if (event.type === 'tool_call') {
          await options.onTool?.(event.tool || 'unknown', event);
        } else if (event.type === 'error') {
          throw new FloydCodingStreamError(
            typeof event.error === 'string' ? event.error : JSON.stringify(event.error ?? event),
            event.retryable === true,
            event,
          );
        } else if (event.type === 'done') {
          explicitDone = true;
          await options.onDone(event);
          return { status: 'complete', ...cursor };
        }
      }
      if (!explicitDone && !options.signal.aborted) {
        throw new FloydCodingStreamError('Floyd coding stream ended before an explicit done event', true);
      }
    } catch (error) {
      if (options.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return { status: 'aborted', ...cursor };
      }
      const retryable = !(error instanceof FloydCodingStreamError) || error.retryable;
      if (!retryable || !cursor.sessionId || !cursor.runId || attempt >= delays.length) throw error;
      const delayMs = delays[attempt++]!;
      options.onRetry?.(error, attempt, delayMs, cursor);
      cursor = { ...cursor, resume: true };
      await sleep(delayMs, options.signal);
      if (options.signal.aborted) return { status: 'aborted', ...cursor };
    }
  }
  return { status: 'aborted', ...cursor };
}
