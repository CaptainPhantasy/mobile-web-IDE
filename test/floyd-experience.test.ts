import assert from 'node:assert/strict';
import test from 'node:test';
import { FloydClient } from '../vendor/floyd-sdk/index.js';
import {
  draftStateAfterPublish,
  effectiveWorkspaceRoot,
  FloydExperienceClient,
  FloydSurfaceError,
  maintainExperienceContinuity,
  normalizeFloydTranscript,
  type ExperienceEnvelope,
} from '../src/lib/floyd-experience.ts';

function envelope(revision = 4): ExperienceEnvelope {
  return {
    id: 'primary', schema_version: '1.0.0', revision,
    active: { project_id: 'project-one', session_id: 'session-one', run_id: 'run-one' },
    model_route: { provider: null, model: null, base_url: null, provider_profile_id: null, credential_ref: null },
    transcript_cursor: 0, transcript_epoch: null, last_event_id: null,
    pending_questions: [], pending_permissions: [], composer_draft: 'continue here',
    selected_artifact_id: null, selected_view: 'ide:ai', surfaces: {},
    updated_at: '2026-07-14T00:00:00.000Z', updated_by_device_id: null,
  };
}

test('restore negotiates before reading the authoritative snapshot', async () => {
  const calls: Array<{ method: string; path: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = String(input);
    calls.push({ method: init?.method || 'GET', path });
    if (path.endsWith('/negotiate')) return Response.json({ accepted: true, envelope_version: '1.0.0' });
    return Response.json({ envelope: envelope(), project: { id: 'project-one', name: 'one', root_path: '/tmp/one' } });
  };
  const client = new FloydExperienceClient(fetchImpl);
  const restored = await client.restore();
  assert.equal(restored.envelope.composer_draft, 'continue here');
  assert.equal(restored.project?.root_path, '/tmp/one');
  assert.deepEqual(calls, [
    { method: 'POST', path: '/api/floyd/experience/negotiate' },
    { method: 'GET', path: '/api/floyd/experience' },
  ]);
});

test('optimistic conflict preserves Core status and exact newer envelope', async () => {
  const newer = envelope(9);
  const client = new FloydExperienceClient(async () => Response.json({
    error: 'revision_conflict', actual_revision: 9, envelope: newer,
  }, { status: 409 }));
  await assert.rejects(
    client.update({ expected_revision: 4, composer_draft: 'stale' }),
    (error: unknown) => {
      assert.ok(error instanceof FloydSurfaceError);
      assert.equal(error.status, 409);
      assert.deepEqual((error.payload as { envelope: ExperienceEnvelope }).envelope, newer);
      return true;
    },
  );
});

test('typed conflict outcome keeps the current local draft dirty and records divergence', async () => {
  const newer = { ...envelope(9), composer_draft: 'remote draft' };
  const client = new FloydExperienceClient(async () => Response.json({
    error: 'revision_conflict', actual_revision: 9, envelope: newer,
  }, { status: 409 }));
  const outcome = await client.updateOutcome({ expected_revision: 4, composer_draft: 'published local' });
  assert.equal(outcome.status, 'conflict');
  assert.deepEqual(draftStateAfterPublish(outcome, 'published local', 'newer local edit'), {
    dirty: true,
    divergence: { local: 'newer local edit', remote: 'remote draft' },
  });
});

test('applied draft clears dirty state only when the local text still matches', () => {
  const outcome = { status: 'applied' as const, envelope: envelope(5) };
  assert.deepEqual(draftStateAfterPublish(outcome, 'same', 'same'), { dirty: false, divergence: null });
  assert.deepEqual(draftStateAfterPublish(outcome, 'published', 'edited again'), { dirty: true, divergence: null });
});

test('stream failure reconnects through a fresh restore before consuming events', async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  let restores = 0;
  await maintainExperienceContinuity({
    signal: controller.signal,
    retryDelaysMs: [1],
    sleep: async () => {},
    restore: async () => {
      restores += 1;
      calls.push(`restore:${restores}`);
      return { envelope: envelope(restores === 1 ? 4 : 8), project: null };
    },
    watch: async function* (lastEventId) {
      calls.push(`watch:${lastEventId}`);
      if (lastEventId === '4') throw new Error('stream dropped');
      yield { id: '9', type: 'experience', data: envelope(9) };
    },
    onSnapshot: (snapshot) => { calls.push(`snapshot:${snapshot.envelope.revision}`); },
    onEvent: (event) => {
      calls.push(`event:${event.id}`);
      controller.abort();
    },
  });
  assert.deepEqual(calls, [
    'restore:1', 'snapshot:4', 'watch:4',
    'restore:2', 'snapshot:8', 'watch:8', 'event:9',
  ]);
});

test('stream reconnect is bounded and fails after the configured attempts', async () => {
  let restores = 0;
  await assert.rejects(maintainExperienceContinuity({
    signal: new AbortController().signal,
    retryDelaysMs: [1, 2],
    sleep: async () => {},
    restore: async () => { restores += 1; return { envelope: envelope(restores), project: null }; },
    watch: async function* () { throw new Error('offline'); },
    onSnapshot: () => {},
    onEvent: () => {},
  }), /offline/);
  assert.equal(restores, 3);
});

test('experience watch parses SSE and cancels the browser reader on return', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`id: 6\nevent: experience\ndata: ${JSON.stringify(envelope(6))}\n\n`));
    },
    cancel() { cancelled = true; },
  });
  const client = new FloydExperienceClient(async () => new Response(stream, {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  }));
  const iterator = client.watch('4');
  const first = await iterator.next();
  assert.equal(first.value?.id, '6');
  assert.equal((first.value?.data as ExperienceEnvelope).revision, 6);
  await iterator.return(undefined);
  assert.equal(cancelled, true);
});

test('local folder is the effective workspace root', () => {
  assert.equal(effectiveWorkspaceRoot('/projects/sample', '/Volumes/Storage/work'), '/Volumes/Storage/work');
  assert.equal(effectiveWorkspaceRoot('/projects/sample', null), '/projects/sample');
});

test('run-scoped transcript snapshot is token-safe and normalizes durable messages', async () => {
  let requested = '';
  const rawMessages = [
    { info: { role: 'assistant', time: { created: 2 } }, parts: [{ text: 'second' }] },
    { role: 'user', time: { created: 1 }, content: 'first' },
    { role: 'tool', time: { created: 3 }, content: 'hidden tool payload' },
  ];
  const client = new FloydExperienceClient(async (input, init) => {
    requested = String(input);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return Response.json({ session_id: 'session/one', run_id: 'run/one', engine_session_id: 'engine-one', messages: rawMessages });
  });
  const snapshot = await client.transcript('session/one', 'run/one');
  assert.equal(requested, '/api/floyd/sessions/session%2Fone/transcript?run_id=run%2Fone');
  assert.deepEqual(normalizeFloydTranscript(snapshot.messages), [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'second' },
  ]);
});

test('transcript endpoint preserves server errors and caller abort', async () => {
  const failed = new FloydExperienceClient(async () => Response.json({ error: 'transcript_unavailable', detail: 'provider offline' }, { status: 502 }));
  await assert.rejects(failed.transcript('session', 'run'), (error: unknown) => {
    assert.ok(error instanceof FloydSurfaceError);
    assert.equal(error.status, 502);
    assert.deepEqual(error.payload, { error: 'transcript_unavailable', detail: 'provider offline' });
    return true;
  });

  let observedAbort = false;
  const hanging = new FloydExperienceClient((_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      observedAbort = true;
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  }));
  const controller = new AbortController();
  const pending = hanging.transcript('session', 'run', controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(observedAbort, true);
});

test('vendored SDK exposes negotiation, optimistic update, artifact and Last-Event-ID watch', async () => {
  const seen: Array<{ path: string; method: string; lastEventId: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({ path: url.pathname, method: init?.method || 'GET', lastEventId: headers.get('last-event-id') });
    if (url.pathname.endsWith('/stream')) {
      return new Response(`event: experience\ndata: ${JSON.stringify(envelope(7))}\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return Response.json(url.pathname.includes('negotiate') ? { accepted: true } : envelope());
  };
  const sdk = new FloydClient({ baseUrl: 'http://127.0.0.1:41414', token: 'server-only', fetch: fetchImpl });
  await sdk.negotiateExperience({ surface_id: 'ide', capabilities: ['drafts'] });
  await sdk.experience();
  await sdk.updateExperience('primary', { expected_revision: 4, composer_draft: 'next' });
  await sdk.artifactById('artifact/one');
  const iterator = sdk.watchExperience('primary', { lastEventId: '6' });
  assert.equal((await iterator.next()).value?.data.revision, 7);
  await iterator.return(undefined);
  assert.deepEqual(seen.map((item) => [item.method, item.path, item.lastEventId]), [
    ['POST', '/api/experience/negotiate', null],
    ['GET', '/api/experience/primary', null],
    ['PATCH', '/api/experience/primary', null],
    ['GET', '/api/artifacts/artifact%2Fone', null],
    ['GET', '/api/experience/primary/stream', '6'],
  ]);
});
