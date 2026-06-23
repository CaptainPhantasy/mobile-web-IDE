// Append-only JSONL audit log for cockpit action runs.
import path from 'path';
import fsp from 'fs/promises';
import type { AuditEntry } from './types';

export function defaultAuditPath(): string {
  return path.resolve(process.cwd(), 'mwide.audit.log');
}

export async function appendAudit(entry: AuditEntry, opts?: { auditPath?: string }): Promise<void> {
  const p = opts?.auditPath ?? defaultAuditPath();
  await fsp.appendFile(p, JSON.stringify(entry) + '\n', 'utf-8');
}

export async function readAudit(
  repoId: string,
  opts?: { auditPath?: string; limit?: number },
): Promise<AuditEntry[]> {
  const p = opts?.auditPath ?? defaultAuditPath();
  const limit = opts?.limit ?? 100;
  let content: string;
  try {
    content = await fsp.readFile(p, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const entries: AuditEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as AuditEntry;
      if (parsed && parsed.repoId === repoId) entries.push(parsed);
    } catch {
      // skip malformed line
    }
  }
  // newest first
  return entries.reverse().slice(0, limit);
}
