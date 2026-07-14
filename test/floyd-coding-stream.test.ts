import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FloydCodingStreamError,
  maintainFloydCodingStream,
  parseFloydCodingSse,
  type FloydCodingStreamCursor,
} from '../src/lib/floyd-coding-stream.ts';
import { provisionalAfterTranscriptRestore } from '../src/components/AIChatPanel.tsx';

function chunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test('split SSE frames preserve IDs, event type, and multiline JSON data', async () => {
  const response = chunkedResponse([
    'id: 10\r\nevent: token\r\nda',
    'ta: {"text":"hel',
    'lo"}\r\n\r\nid: 11\nevent: done\ndata: {"sessionId":"session-1",',
    '\ndata: "runId":"run-1"}\n\n',
  ]);
  const events = [];
  for await (const event of parseFloydCodingSse(response)) events.push(event);
  assert.deepEqual(events, [
    { id: '10', type: 'token', text: 'hello' },
    { id: '11', type: 'done', sessionId: 'session-1', runId: 'run-1' },
  ]);
});

test('network drop (unexpected EOF) restores, resumes by run/session/cursor, and deduplicates inclusive replay', async () => {
  const opened: FloydCodingStreamCursor[] = [];
  const tokens: string[] = [];
  const restored: string[] = [];
  let opens = 0;
  let done = 0;
  const result = await maintainFloydCodingStream({
    signal: new AbortController().signal,
    open: async (cursor) => {
      opened.push({ ...cursor });
      opens += 1;
      return opens === 1
        ? chunkedResponse([
          'event: session\ndata: {"sessionId":"session-1","runId":"run-1"}\n\n',
          'id: 10\nevent: token\ndata: {"text":"A"}\n\n',
        ])
        : chunkedResponse([
          'event: session\ndata: {"sessionId":"session-1","runId":"run-1"}\n\n',
          'id: 10\nevent: token\ndata: {"text":"A"}\n\n',
          'id: 11\nevent: token\ndata: {"text":"B"}\n\n',
          'id: 12\nevent: done\ndata: {"sessionId":"session-1","runId":"run-1"}\n\n',
        ]);
    },
    restore: async (sessionId, runId) => `${sessionId}/${runId}/fresh`,
    onRestore: (snapshot) => { restored.push(snapshot); },
    onSession: () => {},
    onToken: (text) => { tokens.push(text); },
    onDone: () => { done += 1; },
    retryDelaysMs: [0],
    sleep: async () => {},
  });
  assert.deepEqual(opened, [
    { resume: false },
    { resume: true, sessionId: 'session-1', runId: 'run-1', lastEventId: '10' },
  ]);
  assert.deepEqual(restored, ['session-1/run-1/fresh']);
  assert.deepEqual(tokens, ['A', 'B']);
  assert.equal(done, 1);
  assert.deepEqual(result, {
    status: 'complete', resume: true, sessionId: 'session-1', runId: 'run-1', lastEventId: '12',
  });
});

test('context switch abort during a dropped stream suppresses retry, restoration, token delivery, and completion', async () => {
  const controller = new AbortController();
  let restored = 0;
  let retried = 0;
  let tokens = 0;
  let done = 0;
  const pending = maintainFloydCodingStream({
    signal: controller.signal,
    open: async (_cursor, signal) => {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(encoder.encode('event: session\ndata: {"sessionId":"old-session","runId":"old-run"}\n\n'));
          signal.addEventListener('abort', () => stream.error(new DOMException('aborted', 'AbortError')), { once: true });
        },
      }));
    },
    restore: async () => { restored += 1; return null; },
    onRestore: () => {},
    onSession: () => { controller.abort(); },
    onToken: () => { tokens += 1; },
    onRetry: () => { retried += 1; },
    onDone: () => { done += 1; },
    retryDelaysMs: [0],
  });
  assert.deepEqual(await pending, {
    status: 'aborted', resume: false, sessionId: 'old-session', runId: 'old-run',
  });
  assert.equal(restored, 0);
  assert.equal(retried, 0);
  assert.equal(tokens, 0);
  assert.equal(done, 0);
});

test('exhausted reconnect budget rejects partial EOF and never calls completion', async () => {
  const tokens: string[] = [];
  let done = 0;
  await assert.rejects(maintainFloydCodingStream({
    signal: new AbortController().signal,
    open: async () => chunkedResponse([
      'event: session\ndata: {"sessionId":"session-1","runId":"run-1"}\n\n',
      'id: 1\nevent: token\ndata: {"text":"partial"}\n\n',
    ]),
    restore: async () => null,
    onRestore: () => {},
    onSession: () => {},
    onToken: (text) => { tokens.push(text); },
    onDone: () => { done += 1; },
    retryDelaysMs: [],
  }), (error: unknown) => {
    assert.ok(error instanceof FloydCodingStreamError);
    assert.equal(error.retryable, true);
    assert.match(error.message, /before an explicit done/);
    return true;
  });
  assert.deepEqual(tokens, ['partial']);
  assert.equal(done, 0);
});

test('fresh transcript reconciliation keeps only uncommitted provisional suffix', () => {
  assert.equal(provisionalAfterTranscriptRestore([{ role: 'assistant', content: 'hello' }], 'hello world'), ' world');
  assert.equal(provisionalAfterTranscriptRestore([{ role: 'assistant', content: 'hello world' }], 'world'), '');
  assert.equal(provisionalAfterTranscriptRestore([{ role: 'user', content: 'question' }], 'answer'), 'answer');
});
