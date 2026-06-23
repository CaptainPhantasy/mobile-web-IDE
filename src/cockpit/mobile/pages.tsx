import { useState } from 'react';
import type { ReactNode } from 'react';
import Terminal from '../../components/Terminal';
import {
  useConfigStatus,
  useRepos,
  useRepoDetail,
  useRepoStatus,
  usePulls,
  useIssues,
  useWorkflows,
  useAudit,
  useRunAction,
} from '../state';
import { useArmedAction } from '../confirm';
import { navigate } from '../router';
import { getToken, setToken } from '../api';
import { getOverride, setOverride } from '../device';
import type { VerticalChoice } from '../device';
import { relativeTime, shortSha } from '../format';
import { RepoCard, ActionButton, StatusBadge, AuditLogPanel } from './components';

function Loading() {
  return <div className="animate-pulse rounded-xl bg-slate-800/60 p-6 text-sm text-slate-500">Loading…</div>;
}
function ErrorNote({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-800 bg-red-950/50 p-4 text-sm text-red-200">
      <div>⚠ {msg}</div>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 min-h-[44px] rounded-lg bg-red-800 px-3 text-sm font-semibold text-white">Retry</button>
      )}
    </div>
  );
}
function Empty({ msg }: { msg: string }) {
  return <div className="rounded-xl bg-slate-800/60 p-6 text-center text-sm text-slate-500">{msg}</div>;
}
function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-700/60 py-2 last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className={good ? 'font-medium text-emerald-400' : 'font-medium text-slate-200'}>{value}</span>
    </div>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function RepoStatusSection({ repoId }: { repoId: string }) {
  const { data, error, loading } = useRepoStatus(repoId);
  if (loading) return <Loading />;
  if (error) return <ErrorNote msg={error} />;
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
      <StatusBadge status={data} />
      {data && data.changedFiles.length > 0 && (
        <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
          {data.changedFiles.map((f) => (
            <li key={f.path} className="flex gap-2 font-mono text-[11px]">
              <span className="w-6 shrink-0 text-amber-400">{f.status}</span>
              <span className="truncate text-slate-300">{f.path}</span>
            </li>
          ))}
        </ul>
      )}
      {data?.lastCommit && (
        <div className="mt-2 text-[11px] text-slate-400">
          <span className="font-mono text-slate-300">{shortSha(data.lastCommit.sha)}</span> {data.lastCommit.subject} · {relativeTime(data.lastCommit.date)}
        </div>
      )}
    </div>
  );
}

export function CockpitHome() {
  const cfg = useConfigStatus();
  const repos = useRepos();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-100">Operations Cockpit</h1>
      {cfg.loading ? (
        <Loading />
      ) : cfg.error ? (
        <ErrorNote msg={cfg.error} onRetry={cfg.reload} />
      ) : cfg.data ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 text-sm">
          <Row label="Config" value={cfg.data.valid ? '✓ valid' : '⚠ invalid'} good={cfg.data.valid} />
          <Row label="Auth token" value={cfg.data.authConfigured ? '✓ set' : cfg.data.authRequired ? '⚠ missing' : 'not required'} good={cfg.data.authConfigured || !cfg.data.authRequired} />
          <Row label="GitHub token" value={cfg.data.githubConfigured ? '✓ set' : '— not set'} good={cfg.data.githubConfigured} />
          <Row label="Repositories" value={String(cfg.data.repoCount)} good />
        </div>
      ) : null}
      <button onClick={() => navigate({ name: 'repos' })} className="min-h-[44px] w-full rounded-lg bg-sky-700 px-4 py-3 text-center font-semibold text-white active:bg-sky-600">
        Open repositories ({repos.data?.length ?? 0})
      </button>
    </div>
  );
}

export function RepoList() {
  const { data, error, loading, reload } = useRepos();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-100">Repositories</h2>
        <button onClick={reload} className="min-h-[44px] rounded-lg px-3 text-sm text-sky-400">Refresh</button>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNote msg={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Empty msg="No repositories configured. Copy mwide.repos.example.json to mwide.repos.json." />
      ) : (
        data.map((r) => <RepoCard key={r.id} repo={r} />)
      )}
    </div>
  );
}

export function RepoDetail({ repoId }: { repoId: string }) {
  const detail = useRepoDetail(repoId);
  const pulls = usePulls(repoId);
  const issues = useIssues(repoId);
  const workflows = useWorkflows(repoId);
  const audit = useAudit(repoId);
  return (
    <div className="space-y-4">
      <button onClick={() => navigate({ name: 'repos' })} className="text-sm text-sky-400">‹ Repositories</button>
      {detail.loading ? (
        <Loading />
      ) : detail.error ? (
        <ErrorNote msg={detail.error} onRetry={detail.reload} />
      ) : detail.data ? (
        <>
          <div>
            <h2 className="text-lg font-bold text-slate-100">{detail.data.label}</h2>
            <div className="text-xs text-slate-400">{detail.data.id} · {detail.data.github ?? 'no github'}</div>
            <div className="truncate font-mono text-[11px] text-slate-500">{detail.data.path}</div>
          </div>
          <RepoStatusSection repoId={repoId} />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => navigate({ name: 'repoActions', repoId })} className="min-h-[44px] rounded-lg bg-sky-700 font-semibold text-white">Actions</button>
            <button onClick={() => navigate({ name: 'repoTerminal', repoId })} className="min-h-[44px] rounded-lg bg-slate-700 font-semibold text-slate-100">Terminal</button>
          </div>
          <Section title={`Open PRs (${pulls.data?.length ?? 0})`}>
            {pulls.error ? <ErrorNote msg={pulls.error} /> : (pulls.data ?? []).slice(0, 8).map((p) => (
              <a key={p.number} href={p.htmlUrl} target="_blank" rel="noreferrer" className="block rounded-lg bg-slate-800/60 px-3 py-2 text-xs text-slate-200">#{p.number} {p.title}</a>
            ))}
            {!pulls.error && (pulls.data?.length ?? 0) === 0 && <Empty msg="No open PRs." />}
          </Section>
          <Section title={`Open issues (${issues.data?.length ?? 0})`}>
            {issues.error ? <ErrorNote msg={issues.error} /> : (issues.data ?? []).slice(0, 8).map((i) => (
              <a key={i.number} href={i.htmlUrl} target="_blank" rel="noreferrer" className="block rounded-lg bg-slate-800/60 px-3 py-2 text-xs text-slate-200">#{i.number} {i.title}</a>
            ))}
            {!issues.error && (issues.data?.length ?? 0) === 0 && <Empty msg="No open issues." />}
          </Section>
          <Section title={`Workflow runs (${workflows.data?.length ?? 0})`}>
            {workflows.error ? <ErrorNote msg={workflows.error} /> : (workflows.data ?? []).slice(0, 8).map((w) => (
              <a key={w.id} href={w.htmlUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2 text-xs">
                <span className="truncate text-slate-200">{w.name} · {w.branch}</span>
                <span className={w.conclusion === 'success' ? 'text-emerald-400' : w.conclusion ? 'text-red-400' : 'text-amber-400'}>{w.conclusion ?? w.status}</span>
              </a>
            ))}
            {!workflows.error && (workflows.data?.length ?? 0) === 0 && <Empty msg="No workflow runs." />}
          </Section>
          <Section title="Recent activity">
            <AuditLogPanel entries={audit.data ?? []} />
          </Section>
        </>
      ) : null}
    </div>
  );
}

export function RepoActions({ repoId }: { repoId: string }) {
  const detail = useRepoDetail(repoId);
  const { isArmed, arm, disarm } = useArmedAction();
  const runner = useRunAction(repoId);
  const [activeId, setActiveId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <button onClick={() => navigate({ name: 'repoDetail', repoId })} className="text-sm text-sky-400">‹ Detail</button>
      <h2 className="text-lg font-bold text-slate-100">Actions</h2>
      {detail.loading ? (
        <Loading />
      ) : detail.error ? (
        <ErrorNote msg={detail.error} onRetry={detail.reload} />
      ) : !detail.data || detail.data.actions.length === 0 ? (
        <Empty msg="No actions configured for this repo." />
      ) : (
        detail.data.actions.map((a) => (
          <ActionButton
            key={a.id}
            action={a}
            armed={isArmed(a.id)}
            running={runner.running && activeId === a.id}
            onArm={() => arm(a.id)}
            onRun={() => {
              disarm();
              setActiveId(a.id);
              void runner.run(a.id, true);
            }}
          />
        ))
      )}
      {(runner.result || runner.error) && (
        <>
          <button className="fixed inset-0 z-10 bg-black/40" onClick={runner.clear} aria-label="Dismiss results" />
          <div
            className="fixed inset-x-0 bottom-0 z-20 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-600" />
            {runner.error ? (
              <ErrorNote msg={runner.error} />
            ) : runner.result ? (
              <div className="space-y-2 text-xs">
                <div className={runner.result.exitCode === 0 && !runner.result.timedOut ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
                  {runner.result.timedOut ? 'Timed out' : `Exit ${runner.result.exitCode}`} · {runner.result.command} {runner.result.args.join(' ')}
                </div>
                {runner.result.stdout && <pre className="whitespace-pre-wrap rounded-lg bg-black/40 p-2 font-mono text-[11px] text-slate-200">{runner.result.stdout}</pre>}
                {runner.result.stderr && <pre className="whitespace-pre-wrap rounded-lg bg-red-950/40 p-2 font-mono text-[11px] text-red-200">{runner.result.stderr}</pre>}
              </div>
            ) : null}
            <button onClick={runner.clear} className="mt-3 min-h-[44px] w-full rounded-lg bg-slate-700 font-semibold text-slate-100">Close</button>
          </div>
        </>
      )}
    </div>
  );
}

export function RepoTerminal({ repoId }: { repoId: string }) {
  const detail = useRepoDetail(repoId);
  return (
    <div className="flex h-full flex-col">
      <button onClick={() => navigate({ name: 'repoDetail', repoId })} className="mb-2 text-sm text-sky-400">‹ Detail</button>
      {detail.loading ? (
        <Loading />
      ) : detail.error ? (
        <ErrorNote msg={detail.error} onRetry={detail.reload} />
      ) : detail.data ? (
        <div className="min-h-[60vh] flex-1 overflow-hidden rounded-xl border border-slate-700">
          <Terminal projectDir={detail.data.path} />
        </div>
      ) : null}
    </div>
  );
}

export function CockpitSettings() {
  const cfg = useConfigStatus();
  const [token, setTok] = useState('');
  const [saved, setSaved] = useState(false);
  const override = getOverride();
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-100">Settings</h2>
      {cfg.data && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 text-sm">
          <Row label="Config" value={cfg.data.valid ? '✓ valid' : '⚠ invalid'} good={cfg.data.valid} />
          <Row label="Auth required" value={cfg.data.authRequired ? 'yes' : 'no'} />
          <Row label="Auth token (server)" value={cfg.data.authConfigured ? '✓ configured' : '⚠ missing'} good={cfg.data.authConfigured} />
          <Row label="GitHub token (server)" value={cfg.data.githubConfigured ? '✓ configured' : '— not set'} good={cfg.data.githubConfigured} />
        </div>
      )}
      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
        <label className="text-sm font-semibold text-slate-200">Cockpit access token</label>
        <p className="mb-2 text-xs text-slate-400">Sent as a bearer token to authenticate cockpit requests. {getToken() ? 'A token is currently saved.' : 'No token saved.'}</p>
        <input
          type="password"
          value={token}
          onChange={(e) => { setTok(e.target.value); setSaved(false); }}
          placeholder="paste MWIDE_COCKPIT_TOKEN"
          className="min-h-[44px] w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm text-slate-100"
        />
        <button
          onClick={() => { if (token) { setToken(token); setSaved(true); } }}
          className="mt-3 min-h-[44px] w-full rounded-lg bg-sky-700 font-semibold text-white"
        >
          {saved ? 'Saved ✓' : 'Save token'}
        </button>
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
        <label className="text-sm font-semibold text-slate-200">Device layout</label>
        <p className="mb-2 text-xs text-slate-400">Override which vertical renders. Auto classifies by device capability.</p>
        <select
          value={override}
          onChange={(e) => setOverride(e.target.value as VerticalChoice)}
          className="min-h-[44px] w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm text-slate-100"
        >
          <option value="auto">Auto (recommended)</option>
          <option value="mobile">Mobile</option>
          <option value="tablet">Tablet</option>
          <option value="desktop">Desktop</option>
        </select>
      </div>
    </div>
  );
}
