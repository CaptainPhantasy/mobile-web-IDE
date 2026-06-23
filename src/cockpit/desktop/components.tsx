import { navigate } from '../router';
import { useRepoStatus } from '../state';
import { kindClasses, formatDuration } from '../format';
import type { RepoStatus, ActionConfig, AuditEntry } from '../types';

export function StatusBadge({ status }: { status: RepoStatus | null }) {
  if (!status) return <span className="text-xs text-slate-500">checking…</span>;
  if (!status.exists) return <span className="rounded-full bg-red-900 px-2 py-0.5 text-xs text-red-100">⚠ missing</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className="rounded-full bg-slate-700 px-2 py-0.5 text-slate-100">⎇ {status.branch ?? '—'}</span>
      {status.clean ? (
        <span className="rounded-full bg-emerald-800 px-2 py-0.5 text-emerald-50">✓ clean</span>
      ) : (
        <span className="rounded-full bg-amber-700 px-2 py-0.5 text-amber-50">● {status.changedFiles.length}</span>
      )}
      {(status.ahead > 0 || status.behind > 0) && (
        <span className="rounded-full bg-sky-800 px-2 py-0.5 text-sky-50">↑{status.ahead} ↓{status.behind}</span>
      )}
    </span>
  );
}

export function SidebarRepoRow({ id, label, active }: { id: string; label: string; active: boolean }) {
  const { data: status } = useRepoStatus(id);
  const dot = !status || !status.exists ? 'bg-slate-500' : status.clean ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <button
      onClick={() => navigate({ name: 'repoDetail', repoId: id })}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${active ? 'bg-sky-700 text-white' : 'text-slate-300 hover:bg-slate-700/70'}`}
      title={id}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function ActionRow({
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
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-2 hover:border-slate-500">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${k.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${k.dot}`} />
          {k.label}
        </span>
        <span className="text-sm font-medium text-slate-100">{action.label}</span>
        <span className="truncate font-mono text-[11px] text-slate-500">{action.command} {action.args.join(' ')}</span>
      </div>
      <button
        onClick={() => (needsConfirm ? (armed ? onRun() : onArm()) : onRun())}
        disabled={running}
        className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${armed ? 'bg-red-600 text-white' : 'bg-sky-700 text-white hover:bg-sky-600'}`}
        title={needsConfirm ? 'Requires confirmation (click twice)' : 'Run'}
      >
        {running ? 'Running…' : armed ? 'Confirm' : 'Run'}
      </button>
    </div>
  );
}

export function AuditLogPanel({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <div className="text-xs text-slate-500">No audit entries yet.</div>;
  return (
    <table className="w-full text-left text-xs">
      <tbody>
        {entries.slice(0, 30).map((e, i) => (
          <tr key={`${e.timestamp}-${i}`} className="border-b border-slate-800">
            <td className="py-1 font-mono text-slate-300">{e.actionId}</td>
            <td className={`py-1 text-right ${e.timedOut || e.exitCode !== 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {e.timedOut ? 'timeout' : `exit ${e.exitCode ?? '—'}`} · {formatDuration(e.durationMs)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
