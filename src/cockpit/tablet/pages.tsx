import { useState } from 'react';
import type { ReactNode } from 'react';
import Terminal from '../../components/Terminal';
import {
  useConfigStatus,
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
import { StatusBadge, ActionButton, AuditLogPanel } from './components';

function Loading() {
  return <div className="animate-pulse rounded-xl bg-slate-800/60 p-6 text-sm text-slate-500">Loading…</div>;
}
function ErrorNote({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-800 bg-red-950/50 p-4 text-sm text-red-200">
      <div>⚠ {msg}</div>
      {onRetry && <button onClick={onRetry} className="mt-2 rounded-lg bg-red-800 px-3 py-1.5 text-sm font-semibold text-white">Retry</button>}
    </div>
  );
}
function Empty({ msg }: { msg: string }) {
  return <div className="rounded-xl bg-slate-800/60 p-6 text-center text-sm text-slate-500">{msg}</div>;
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-300">{title}</h3>
      {children}
    </section>
  );
}

export function CockpitOverview() {
  const cfg = useConfigStatus();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-100">Operations Cockpit</h1>
      <p className="text-sm text-slate-400">Select a repository from the sidebar to inspect status, GitHub state, and run allowlisted actions.</p>
      {cfg.loading ? (
        <Loading />
      ) : cfg.error ? (
        <ErrorNote msg={cfg.error} onRetry={cfg.reload} />
      ) : cfg.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Config" value={cfg.data.valid ? 'valid' : 'invalid'} good={cfg.data.valid} />
          <Stat label="Auth" value={cfg.data.authConfigured ? 'set' : cfg.data.authRequired ? 'missing' : 'off'} good={cfg.data.authConfigured || !cfg.data.authRequired} />
          <Stat label="GitHub" value={cfg.data.githubConfigured ? 'set' : 'not set'} good={cfg.data.githubConfigured} />
          <Stat label="Repos" value={String(cfg.data.repoCount)} good />
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={good ? 'mt-1 text-lg font-bold text-emerald-400' : 'mt-1 text-lg font-bold text-slate-200'}>{value}</div>
    </div>
  );
}

export function RepoDetail({ repoId }: { repoId: string }) {
  const detail = useRepoDetail(repoId);
  const status = useRepoStatus(repoId);
  const pulls = usePulls(repoId);
  const issues = useIssues(repoId);
  const workflows = useWorkflows(repoId);
  const audit = useAudit(repoId);
  if (detail.loading) return <Loading />;
  if (detail.error) return <ErrorNote msg={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100">{detail.data.label}</h2>
          <div className="text-xs text-slate-400">{detail.data.id} · {detail.data.github ?? 'no github'}</div>
          <div className="font-mono text-[11px] text-slate-500">{detail.data.path}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate({ name: 'repoActions', repoId })} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600">Actions</button>
          <button onClick={() => navigate({ name: 'repoTerminal', repoId })} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-600">Terminal</button>
        </div>
      </div>
      <Panel title="Status">
        {status.loading ? <Loading /> : status.error ? <ErrorNote msg={status.error} /> : (
          <>
            <StatusBadge status={status.data} />
            {status.data && status.data.changedFiles.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
                {status.data.changedFiles.map((f) => (
                  <li key={f.path} className="flex gap-2 font-mono text-[11px]"><span className="w-6 shrink-0 text-amber-400">{f.status}</span><span className="truncate text-slate-300">{f.path}</span></li>
                ))}
              </ul>
            )}
            {status.data?.lastCommit && (
              <div className="mt-2 text-[11px] text-slate-400"><span className="font-mono text-slate-300">{shortSha(status.data.lastCommit.sha)}</span> {status.data.lastCommit.subject} · {relativeTime(status.data.lastCommit.date)}</div>
            )}
          </>
        )}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Open PRs (${pulls.data?.length ?? 0})`}>
          {pulls.error ? <ErrorNote msg={pulls.error} /> : (pulls.data ?? []).length === 0 ? <Empty msg="No open PRs." /> : (
            <ul className="space-y-1">{(pulls.data ?? []).slice(0, 10).map((p) => <li key={p.number}><a href={p.htmlUrl} target="_blank" rel="noreferrer" className="block truncate rounded-lg px-2 py-1 text-xs text-slate-200 hover:bg-slate-700/60">#{p.number} {p.title}</a></li>)}</ul>
          )}
        </Panel>
        <Panel title={`Open issues (${issues.data?.length ?? 0})`}>
          {issues.error ? <ErrorNote msg={issues.error} /> : (issues.data ?? []).length === 0 ? <Empty msg="No open issues." /> : (
            <ul className="space-y-1">{(issues.data ?? []).slice(0, 10).map((i) => <li key={i.number}><a href={i.htmlUrl} target="_blank" rel="noreferrer" className="block truncate rounded-lg px-2 py-1 text-xs text-slate-200 hover:bg-slate-700/60">#{i.number} {i.title}</a></li>)}</ul>
          )}
        </Panel>
        <Panel title={`Workflow runs (${workflows.data?.length ?? 0})`}>
          {workflows.error ? <ErrorNote msg={workflows.error} /> : (workflows.data ?? []).length === 0 ? <Empty msg="No workflow runs." /> : (
            <ul className="space-y-1">{(workflows.data ?? []).slice(0, 10).map((w) => <li key={w.id}><a href={w.htmlUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs hover:bg-slate-700/60"><span className="truncate text-slate-200">{w.name} · {w.branch}</span><span className={w.conclusion === 'success' ? 'text-emerald-400' : w.conclusion ? 'text-red-400' : 'text-amber-400'}>{w.conclusion ?? w.status}</span></a></li>)}</ul>
          )}
        </Panel>
        <Panel title="Recent activity"><AuditLogPanel entries={audit.data ?? []} /></Panel>
      </div>
    </div>
  );
}

export function RepoActions({ repoId }: { repoId: string }) {
  const detail = useRepoDetail(repoId);
  const { isArmed, arm, disarm } = useArmedAction();
  const runner = useRunAction(repoId);
  const [activeId, setActiveId] = useState<string | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <h2 className="text-xl font-bold text-slate-100">Actions</h2>
        {detail.loading ? <Loading /> : detail.error ? <ErrorNote msg={detail.error} onRetry={detail.reload} /> : !detail.data || detail.data.actions.length === 0 ? <Empty msg="No actions configured." /> : (
          detail.data.actions.map((a) => (
            <ActionButton key={a.id} action={a} armed={isArmed(a.id)} running={runner.running && activeId === a.id} onArm={() => arm(a.id)} onRun={() => { disarm(); setActiveId(a.id); void runner.run(a.id, true); }} />
          ))
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-300">Result</h3>
        {runner.error ? <ErrorNote msg={runner.error} /> : runner.result ? (
          <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-xs">
            <div className={runner.result.exitCode === 0 && !runner.result.timedOut ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>{runner.result.timedOut ? 'Timed out' : `Exit ${runner.result.exitCode}`} · {runner.result.command} {runner.result.args.join(' ')}</div>
            {runner.result.stdout && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 font-mono text-[11px] text-slate-200">{runner.result.stdout}</pre>}
            {runner.result.stderr && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-red-950/40 p-2 font-mono text-[11px] text-red-200">{runner.result.stderr}</pre>}
          </div>
        ) : <Empty msg="Run an action to see output." />}
      </div>
    </div>
  );
}

export function RepoTerminal({ repoId }: { repoId: string }) {
  const detail = useRepoDetail(repoId);
  if (detail.loading) return <Loading />;
  if (detail.error) return <ErrorNote msg={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return null;
  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-2 text-lg font-bold text-slate-100">Terminal · {detail.data.label}</h2>
      <div className="min-h-[60vh] flex-1 overflow-hidden rounded-xl border border-slate-700">
        <Terminal projectDir={detail.data.path} />
      </div>
    </div>
  );
}

export function CockpitSettings() {
  const cfg = useConfigStatus();
  const [token, setTok] = useState('');
  const [saved, setSaved] = useState(false);
  const override = getOverride();
  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-xl font-bold text-slate-100">Settings</h2>
      {cfg.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Config" value={cfg.data.valid ? 'valid' : 'invalid'} good={cfg.data.valid} />
          <Stat label="Auth" value={cfg.data.authConfigured ? 'set' : 'missing'} good={cfg.data.authConfigured} />
          <Stat label="GitHub" value={cfg.data.githubConfigured ? 'set' : 'not set'} good={cfg.data.githubConfigured} />
          <Stat label="Repos" value={String(cfg.data.repoCount)} good />
        </div>
      )}
      <Panel title="Cockpit access token">
        <p className="mb-2 text-xs text-slate-400">{getToken() ? 'A token is currently saved.' : 'No token saved.'} Sent as a bearer token for cockpit requests.</p>
        <div className="flex gap-2">
          <input type="password" value={token} onChange={(e) => { setTok(e.target.value); setSaved(false); }} placeholder="paste MWIDE_COCKPIT_TOKEN" className="min-h-[40px] flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm text-slate-100" />
          <button onClick={() => { if (token) { setToken(token); setSaved(true); } }} className="rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-600">{saved ? 'Saved ✓' : 'Save'}</button>
        </div>
      </Panel>
      <Panel title="Device layout">
        <p className="mb-2 text-xs text-slate-400">Override which vertical renders. Auto classifies by device capability.</p>
        <select value={override} onChange={(e) => setOverride(e.target.value as VerticalChoice)} className="min-h-[40px] w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm text-slate-100">
          <option value="auto">Auto (recommended)</option>
          <option value="mobile">Mobile</option>
          <option value="tablet">Tablet</option>
          <option value="desktop">Desktop</option>
        </select>
      </Panel>
    </div>
  );
}
