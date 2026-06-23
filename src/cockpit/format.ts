// Shared presentation-neutral formatters + action-kind color tokens. Consumed
// by all three verticals so colors/labels stay consistent (TVDS: shared tokens).
import type { ActionKind } from './types';

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

export function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export interface KindClasses {
  badge: string;
  dot: string;
  label: string;
}

export function kindClasses(kind: ActionKind): KindClasses {
  switch (kind) {
    case 'read':
      return { badge: 'bg-slate-700 text-slate-100', dot: 'bg-slate-400', label: 'Read' };
    case 'write':
      return { badge: 'bg-amber-700 text-amber-50', dot: 'bg-amber-400', label: 'Write' };
    case 'verify':
      return { badge: 'bg-sky-700 text-sky-50', dot: 'bg-sky-400', label: 'Verify' };
    case 'deploy':
      return { badge: 'bg-violet-700 text-violet-50', dot: 'bg-violet-400', label: 'Deploy' };
    case 'destructive':
      return { badge: 'bg-red-700 text-red-50', dot: 'bg-red-400', label: 'Destructive' };
  }
}
