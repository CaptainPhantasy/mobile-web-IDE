// Shared data hooks. Every vertical consumes these — business/data logic lives
// here once and is never duplicated across verticals (TVDS: fork presentation only).
import { useCallback, useEffect, useState } from 'react';
import { cockpitApi, ApiError } from './api';
import type {
  ConfigStatus,
  RepoSummary,
  RepoDetail,
  RepoStatus,
  CockpitPullRequest,
  CockpitIssue,
  CockpitWorkflowRun,
  AuditEntry,
  ActionRunResult,
} from './types';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

function useAsync<T>(fn: () => Promise<T>, deps: ReadonlyArray<unknown>): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => {
        if (active) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(e instanceof ApiError ? e.message : 'Request failed');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [...deps, nonce]);

  useEffect(() => {
    const onRefresh = (): void => setNonce((n) => n + 1);
    window.addEventListener('mwide:cockpit-refresh', onRefresh);
    return () => window.removeEventListener('mwide:cockpit-refresh', onRefresh);
  }, []);

  return { data, error, loading, reload };
}

export function refreshCockpit(): void {
  window.dispatchEvent(new Event('mwide:cockpit-refresh'));
}

export function useConfigStatus(): AsyncState<ConfigStatus> {
  return useAsync(() => cockpitApi.configStatus(), []);
}
export function useRepos(): AsyncState<RepoSummary[]> {
  return useAsync(() => cockpitApi.listRepos(), []);
}
export function useRepoDetail(id: string): AsyncState<RepoDetail> {
  return useAsync(() => cockpitApi.getRepo(id), [id]);
}
export function useRepoStatus(id: string): AsyncState<RepoStatus> {
  return useAsync(() => cockpitApi.repoStatus(id), [id]);
}
export function usePulls(id: string): AsyncState<CockpitPullRequest[]> {
  return useAsync(() => cockpitApi.pulls(id), [id]);
}
export function useIssues(id: string): AsyncState<CockpitIssue[]> {
  return useAsync(() => cockpitApi.issues(id), [id]);
}
export function useWorkflows(id: string): AsyncState<CockpitWorkflowRun[]> {
  return useAsync(() => cockpitApi.workflows(id), [id]);
}
export function useAudit(id: string): AsyncState<AuditEntry[]> {
  return useAsync(() => cockpitApi.audit(id), [id]);
}

export interface RunActionState {
  run: (actionId: string, confirm?: boolean) => Promise<void>;
  running: boolean;
  result: ActionRunResult | null;
  error: string | null;
  clear: () => void;
}

export function useRunAction(id: string): RunActionState {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ActionRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (actionId: string, confirm?: boolean): Promise<void> => {
      setRunning(true);
      setError(null);
      setResult(null);
      try {
        setResult(await cockpitApi.runAction(id, actionId, { confirm }));
      } catch (e: unknown) {
        setError(e instanceof ApiError ? e.message : 'Action failed');
      } finally {
        setRunning(false);
      }
    },
    [id],
  );
  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { run, running, result, error, clear };
}
