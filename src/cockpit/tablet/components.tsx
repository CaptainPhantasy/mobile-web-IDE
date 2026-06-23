import { useState } from 'react';
import { navigate } from '../router';
import { kindClasses, formatDuration } from '../format';
import type { RepoStatus, ActionConfig, AuditEntry } from '../types';

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
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-700 px-2 py-0.5 text-amber-50">● {status.changedFiles.length}</span>
      )}
      {(status.ahead > 0 || status.behind > 0) && (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-800 px-2 py-0.5 text-sky-50">↑{status.ahead} ↓{status.behind}</span>
      )}
    </span>
  );
}

export function SidebarRepoRow({
  id,
  label,
  active,
}: {
  id: string;
  label: string;
  active: boolean;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <div className="group relative">
      <button
        onClick={() => navigate({ name: 'repoDetail', repoId: id })}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm ${
          active ? 'bg-sky-700 text-white' : 'text-slate-200 hover:bg-slate-700/70'
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="ml-2 hidden gap-1 group-hover:flex">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); navigate({ name: 'repoActions', repoId: id }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); navigate({ name: 'repoActions', repoId: id }); } }}
            className="rounded px-1 text-xs text-slate-300 hover:text-white"
            title="Actions"
          >
            ⚙
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); navigate({ name: 'repoTerminal', repoId: id }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); navigate({ name: 'repoTerminal', repoId: id }); } }}
            className="rounded px-1 text-xs text-slate-300 hover:text-white"
            title="Terminal"
          >
            ⌨
          </span>
        </span>
      </button>
      {menu && (
        <>
          <button className="fixed inset-0 z-30" onClick={() => setMenu(null)} aria-label="Close menu" />
          <div className="fixed z-40 w-44 rounded-lg border border-slate-700 bg-slate-800 py-1 text-sm shadow-xl" style={{ left: menu.x, top: menu.y }}>
            <MenuItem label="Open detail" onClick={() => { setMenu(null); navigate({ name: 'repoDetail', repoId: id }); }} />
            <MenuItem label="Actions" onClick={() => { setMenu(null); navigate({ name: 'repoActions', repoId: id }); }} />
            <MenuItem label="Terminal" onClick={() => { setMenu(null); navigate({ name: 'repoTerminal', repoId: id }); }} />
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="block w-full px-3 py-2 text-left text-slate-200 hover:bg-slate-700">
      {label}
    </button>
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3 transition-colors hover:border-slate-500">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100">{action.label}</span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${k.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${k.dot}`} />
            {k.label}
          </span>
        </div>
        <div className="truncate font-mono text-[11px] text-slate-400">{action.command} {action.args.join(' ')}</div>
      </div>
      <button
        onClick={() => (needsConfirm ? (armed ? onRun() : onArm()) : onRun())}
        disabled={running}
        className={`min-h-[40px] shrink-0 rounded-lg px-4 text-sm font-semibold disabled:opacity-50 ${
          armed ? 'bg-red-600 text-white' : 'bg-sky-700 text-white hover:bg-sky-600'
        }`}
      >
        {running ? 'Running…' : armed ? 'Confirm' : needsConfirm ? 'Run · confirm' : 'Run'}
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
