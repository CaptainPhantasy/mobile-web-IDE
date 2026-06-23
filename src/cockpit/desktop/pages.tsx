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
import type { RepoSummary } from '../types';
import { StatusBadge, ActionRow, AuditLogPanel } from './components';

function Loading() {
  return <div className="animate-pulse rounded-lg bg-slate-800/60 p-6 text-sm text-slate-500">Loading…</div>;
}
function ErrorNote({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">
      ⚠ {msg}
      {onRetry && <button onClick={onRetry} className="ml-2 rounded bg-red-800 px-2 py-1 text-xs font-semibold text-white">Retry</button>}
    </div>
  );
}
function Empty({ msg }: { msg: string }) {
  return <div className="rounded-lg bg-slate-800/40 p-4 text-center text-xs text-slate-500">{msg}</div>;
}
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-300">{title}</h3>
      {children}
    </section>
  );
}

function OverviewCard({ repo }: { repo: RepoSummary }) {
  const { data: status } = useRepoStatus(repo.id);
  return (
    <button
      onClick={() => navigate({ name: 'repoDetail', repoId: repo.id })}
      className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-left hover:border-sky-600"
    >
      <div className="font-semibold text-slate-100">{repo.label}</div>
      <div className="text-xs text-slate-400">{repo.github ?? 'no github'} · {repo.actionCount} actions</div>
      <div className="mt-2"><StatusBadge status={status} /></div>
    </button>
  );
}

export function Overview() {
  const cfg = useConfigStatus();
  const repos = useRepos();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Operations Cockpit</h1>
        <p className="text-sm text-slate-400">Press <kbd className="rounded border border-slate-600 px-1">⌘K</kbd> for the command palette.</p>
      </div>
      {cfg.data && (
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Config" value={cfg.data.valid ? 'valid' : 'invalid'} good={cfg.data.valid} />
          <Stat label="Auth token" value={cfg.data.authConfigured ? 'set' : cfg.data.authRequired ? 'missing' : 'off'} good={cfg.data.authConfigured || !cfg.data.authRequired} />
          <Stat label="GitHub token" value={cfg.data.githubConfigured ? 'set' : 'not set'} good={cfg.data.githubConfigured} />
          <Stat label="Repositories" value={String(cfg.data.repoCount)} good />
        </div>
      )}
      {repos.loading ? (
        <Loading />
      ) : repos.error ? (
        <ErrorNote msg={repos.error} onRetry={repos.reload} />
      ) : (repos.data ?? []).length === 0 ? (
        <Empty msg="No repositories configured. Copy mwide.repos.example.json to mwide.repos.json." />
      ) : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {(repos.data ?? []).map((r) => <OverviewCard key={r.id} repo={r} />)}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={good ? 'text-lg font-bold text-emerald-400' : 'text-lg font-bold text-slate-200'}>{value}</div>
    </div>
  );
}

export function RepoDetail({ repoId }: { repoId: string }) {
  const detail = useRepoDetail(repoId);
  const status = useRepoStatus(repoId);
  if (detail.loading) return <Loading />;
  if (detail.error) return <ErrorNote msg={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">{detail.data.label}</h2>
          <div className="font-mono text-[11px] text-slate-500">{detail.data.path}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate({ name: 'repoActions', repoId })} className="rounded-md bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-600">Actions</button>
          <button onClick={() => navigate({ name: 'repoTerminal', repoId })} className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-100 hover:bg-slate-600">Terminal</button>
        </div>
      </div>
      <Card title="Working tree">
        {status.loading ? <Loading /> : status.error ? <ErrorNote msg={status.error} /> : (
          <>
            <StatusBadge status={status.data} />
            {status.data && status.data.changedFiles.length > 0 ? (
              <table className="mt-2 w-full text-left text-xs">
                <thead><tr className="text-slate-500"><th className="w-12 font-medium">St</th><th className="font-medium">Path</th></tr></thead>
                <tbody>
                  {status.data.changedFiles.map((f) => (
                    <tr key={f.path} className="border-t border-slate-800"><td className="py-1 font-mono text-amber-400">{f.status}</td><td className="py-1 font-mono text-slate-300">{f.path}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : status.data ? <div className="mt-2 text-xs text-slate-500">Working tree clean.</div> : null}
            {status.data?.lastCommit && (
              <div className="mt-2 text-[11px] text-slate-400"><span className="font-mono text-slate-300">{shortSha(status.data.lastCommit.sha)}</span> {status.data.lastCommit.subject} · {status.data.lastCommit.author} · {relativeTime(status.data.lastCommit.date)}</div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

export function RepoActions({ repoId }: { repoId: string }) {
  const detail = useRepoDetail(repoId);
  const { isArmed, arm, disarm } = useArmedAction();
  const runner = useRunAction(repoId);
  const [activeId, setActiveId] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-slate-100">Actions</h2>
      <div className="space-y-2">
        {detail.loading ? <Loading /> : detail.error ? <ErrorNote msg={detail.error} onRetry={detail.reload} /> : !detail.data || detail.data.actions.length === 0 ? <Empty msg="No actions configured." /> : (
          detail.data.actions.map((a) => (
            <ActionRow key={a.id} action={a} armed={isArmed(a.id)} running={runner.running && activeId === a.id} onArm={() => arm(a.id)} onRun={() => { disarm(); setActiveId(a.id); void runner.run(a.id, true); }} />
          ))
        )}
      </div>
      <Card title="Output console">
        {runner.error ? <ErrorNote msg={runner.error} /> : runner.result ? (
          <div className="space-y-2 text-xs">
            <div className={runner.result.exitCode === 0 && !runner.result.timedOut ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>{runner.result.timedOut ? 'Timed out' : `Exit ${runner.result.exitCode}`} · {runner.result.command} {runner.result.args.join(' ')}</div>
            {runner.result.stdout && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-black/50 p-2 font-mono text-[11px] text-slate-200">{runner.result.stdout}</pre>}
            {runner.result.stderr && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-red-950/40 p-2 font-mono text-[11px] text-red-200">{runner.result.stderr}</pre>}
          </div>
        ) : <Empty msg="Run an action to see output." />}
      </Card>
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
      <div className="min-h-[60vh] flex-1 overflow-hidden rounded-lg border border-slate-700">
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
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Config" value={cfg.data.valid ? 'valid' : 'invalid'} good={cfg.data.valid} />
          <Stat label="Auth" value={cfg.data.authConfigured ? 'set' : 'missing'} good={cfg.data.authConfigured} />
          <Stat label="GitHub" value={cfg.data.githubConfigured ? 'set' : 'not set'} good={cfg.data.githubConfigured} />
          <Stat label="Repos" value={String(cfg.data.repoCount)} good />
        </div>
      )}
      <Card title="Cockpit access token">
        <p className="mb-2 text-xs text-slate-400">{getToken() ? 'A token is currently saved.' : 'No token saved.'} Sent as a bearer token for cockpit requests.</p>
        <div className="flex gap-2">
          <input type="password" value={token} onChange={(e) => { setTok(e.target.value); setSaved(false); }} placeholder="paste MWIDE_COCKPIT_TOKEN" className="min-h-[36px] flex-1 rounded-md border border-slate-600 bg-slate-900 px-3 text-sm text-slate-100" />
          <button onClick={() => { if (token) { setToken(token); setSaved(true); } }} className="rounded-md bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-600">{saved ? 'Saved ✓' : 'Save'}</button>
        </div>
      </Card>
      <Card title="Device layout">
        <p className="mb-2 text-xs text-slate-400">Override which vertical renders. Auto classifies by device capability.</p>
        <select value={override} onChange={(e) => setOverride(e.target.value as VerticalChoice)} className="min-h-[36px] w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-sm text-slate-100">
          <option value="auto">Auto (recommended)</option>
          <option value="mobile">Mobile</option>
          <option value="tablet">Tablet</option>
          <option value="desktop">Desktop</option>
        </select>
      </Card>
    </div>
  );
}

export function InfoPanel({ repoId }: { repoId: string }) {
  const pulls = usePulls(repoId);
  const issues = useIssues(repoId);
  const workflows = useWorkflows(repoId);
  const audit = useAudit(repoId);
  return (
    <div className="space-y-4">
      <Card title={`Open PRs (${pulls.data?.length ?? 0})`}>
        {pulls.error ? <ErrorNote msg={pulls.error} /> : (pulls.data ?? []).length === 0 ? <Empty msg="None" /> : (
          <ul className="space-y-1">{(pulls.data ?? []).slice(0, 12).map((p) => <li key={p.number}><a href={p.htmlUrl} target="_blank" rel="noreferrer" className="block truncate rounded px-1 py-0.5 text-xs text-slate-200 hover:bg-slate-700/60">#{p.number} {p.title}</a></li>)}</ul>
        )}
      </Card>
      <Card title={`Open issues (${issues.data?.length ?? 0})`}>
        {issues.error ? <ErrorNote msg={issues.error} /> : (issues.data ?? []).length === 0 ? <Empty msg="None" /> : (
          <ul className="space-y-1">{(issues.data ?? []).slice(0, 12).map((i) => <li key={i.number}><a href={i.htmlUrl} target="_blank" rel="noreferrer" className="block truncate rounded px-1 py-0.5 text-xs text-slate-200 hover:bg-slate-700/60">#{i.number} {i.title}</a></li>)}</ul>
        )}
      </Card>
      <Card title={`Workflows (${workflows.data?.length ?? 0})`}>
        {workflows.error ? <ErrorNote msg={workflows.error} /> : (workflows.data ?? []).length === 0 ? <Empty msg="None" /> : (
          <ul className="space-y-1">{(workflows.data ?? []).slice(0, 12).map((w) => <li key={w.id}><a href={w.htmlUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-slate-700/60"><span className="truncate text-slate-200">{w.name}</span><span className={w.conclusion === 'success' ? 'text-emerald-400' : w.conclusion ? 'text-red-400' : 'text-amber-400'}>{w.conclusion ?? w.status}</span></a></li>)}</ul>
        )}
      </Card>
      <Card title="Recent activity"><AuditLogPanel entries={audit.data ?? []} /></Card>
    </div>
  );
}
