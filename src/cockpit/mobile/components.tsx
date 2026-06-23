import { useRepoStatus } from '../state';
import { navigate } from '../router';
import { kindClasses, formatDuration } from '../format';
import type { RepoSummary, RepoStatus, ActionConfig, AuditEntry } from '../types';

export function StatusBadge({ status }: { status: RepoStatus | null }) {
  if (!status) {
    return <span className="inline-flex items-center rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-400">checking…</span>;
  }
  if (!status.exists) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-900 px-2 py-0.5 text-xs text-red-100">⚠ missing</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-700 px-2 py-0.5 text-slate-100">⎇ {status.branch ?? '—'}</span>
      {status.clean ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-800 px-2 py-0.5 text-emerald-50">✓ clean</span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-700 px-2 py-0.5 text-amber-50">● {status.changedFiles.length} changed</span>
      )}
      {(status.ahead > 0 || status.behind > 0) && (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-800 px-2 py-0.5 text-sky-50">↑{status.ahead} ↓{status.behind}</span>
      )}
    </span>
  );
}

export function RepoCard({ repo }: { repo: RepoSummary }) {
  const { data: status } = useRepoStatus(repo.id);
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <button onClick={() => navigate({ name: 'repoDetail', repoId: repo.id })} className="block w-full text-left">
        <div className="text-base font-semibold text-slate-100">{repo.label}</div>
        <div className="text-xs text-slate-400">{repo.id} · {repo.github ?? 'no github'}</div>
        <div className="mt-1 truncate font-mono text-[11px] text-slate-500">{repo.path}</div>
      </button>
      <div className="mt-2"><StatusBadge status={status} /></div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button onClick={() => navigate({ name: 'repoDetail', repoId: repo.id })} className="min-h-[44px] rounded-lg bg-slate-700 text-sm font-medium text-slate-100 active:bg-slate-600">Detail</button>
        <button onClick={() => navigate({ name: 'repoActions', repoId: repo.id })} className="min-h-[44px] rounded-lg bg-slate-700 text-sm font-medium text-slate-100 active:bg-slate-600">Actions</button>
        <button onClick={() => navigate({ name: 'repoTerminal', repoId: repo.id })} className="min-h-[44px] rounded-lg bg-slate-700 text-sm font-medium text-slate-100 active:bg-slate-600">Terminal</button>
      </div>
    </div>
  );
}

export function ActionButton({
  action,
  armed,
  onArm,
  onRun,
  running,
}: {
  action: ActionConfig;
  armed: boolean;
  onArm: () => void;
  onRun: () => void;
  running: boolean;
}) {
  const k = kindClasses(action.kind);
  const needsConfirm = action.confirm || action.kind === 'destructive';
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-100">{action.label}</div>
          <div className="truncate font-mono text-[11px] text-slate-400">{action.command} {action.args.join(' ')}</div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${k.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${k.dot}`} />
          {k.label}
        </span>
      </div>
      <button
        onClick={() => (needsConfirm ? (armed ? onRun() : onArm()) : onRun())}
        disabled={running}
        className={`mt-3 min-h-[44px] w-full rounded-lg text-sm font-semibold disabled:opacity-50 ${
          armed ? 'bg-red-600 text-white' : 'bg-sky-700 text-white active:bg-sky-600'
        }`}
      >
        {running ? 'Running…' : armed ? 'Tap again to confirm' : needsConfirm ? 'Run · confirm' : 'Run'}
      </button>
    </div>
  );
}

export function AuditLogPanel({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-xs text-slate-500">No audit entries yet.</div>;
  }
  return (
    <ul className="space-y-1">
      {entries.map((e, i) => (
        <li key={`${e.timestamp}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/60 px-3 py-2 text-xs">
          <span className="truncate font-mono text-slate-300">{e.actionId}</span>
          <span className={e.timedOut || e.exitCode !== 0 ? 'shrink-0 text-red-400' : 'shrink-0 text-emerald-400'}>
            {e.timedOut ? 'timeout' : `exit ${e.exitCode ?? '—'}`} · {formatDuration(e.durationMs)}
          </span>
        </li>
      ))}
    </ul>
  );
}
