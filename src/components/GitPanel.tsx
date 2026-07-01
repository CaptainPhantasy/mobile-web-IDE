// GitPanel.tsx — competitive with the GitHub CLI (gh).
// Dashboard-first layout with bounded viewports, keyboard-friendly lists,
// and rich async status semantics patterned after cli-x-2026.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as git from '../lib/git';
import * as gh from '../lib/github';
import * as ext from '../lib/extensions';
import { ROOT, join, basename } from '../lib/fs';
import { localGitStatus, type LocalGitStatus } from '../lib/localfs';
import type { GlyphName } from '../lib/glyphs';
import { useDeviceClass } from '../cockpit/device';
import DiffView from './DiffView';
import { Glyph } from './Glyph';

type Props = {
  projectDir: string;
  onProjectChanged: (dir: string) => void;
  onRefresh: () => void;
  author: { name: string; email: string };
};

type Tab = 'status' | 'branches' | 'prs' | 'issues' | 'actions' | 'repo' | 'settings';

function tabLabel(t: Tab): string {
  switch (t) {
    case 'status': return 'Status';
    case 'branches': return 'Branches';
    case 'prs': return 'Pull Requests';
    case 'issues': return 'Issues';
    case 'actions': return 'Actions';
    case 'repo': return 'Repository';
    case 'settings': return 'Settings';
  }
}

function tabShortLabel(t: Tab): string {
  switch (t) {
    case 'status': return 'Status';
    case 'branches': return 'Branch';
    case 'prs': return 'PRs';
    case 'issues': return 'Issues';
    case 'actions': return 'CI';
    case 'repo': return 'Repo';
    case 'settings': return 'Config';
  }
}

function tabGlyph(t: Tab): GlyphName {
  switch (t) {
    case 'status': return 'diff_mod';
    case 'branches': return 'branch';
    case 'prs': return 'git';
    case 'issues': return 'warn';
    case 'actions': return 'rocket';
    case 'repo': return 'projects';
    case 'settings': return 'pencil';
  }
}

function hostStatusLabel(code: string): git.StatusEntry['label'] {
  if (code.includes('??') || code.includes('A')) return 'new';
  if (code.includes('D')) return 'deleted';
  if (code.length > 1 && code[0] !== ' ') return 'staged';
  if (code.length > 1 && code[1] !== ' ') return 'unstaged';
  return 'modified';
}

function parseGitHubFullName(url?: string): string | undefined {
  if (!url) return undefined;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

export default function GitPanel({ projectDir, onProjectChanged, onRefresh, author }: Props) {
  const vertical = useDeviceClass();
  const isBrowserWorkspace = projectDir.startsWith('browserfs:');
  const isHostWorkspace = !isBrowserWorkspace && projectDir.startsWith('/') && !projectDir.startsWith(ROOT + '/');
  const [tab, setTab] = useState<Tab>('status');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Git
  const [status, setStatus] = useState<git.StatusEntry[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | undefined>();
  const [commits, setCommits] = useState<Array<{ oid: string; message: string; author: string; date: string }>>([]);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [commitMsg, setCommitMsg] = useState('');
  const [commitType, setCommitType] = useState('feat');
  const [commitScope, setCommitScope] = useState('');
  const [isRepo, setIsRepo] = useState(false);

  // GitHub
  const [ghUser, setGhUser] = useState<gh.GithubUser | undefined>();
  const [token, setToken] = useState('');
  const [repoFullName, setRepoFullName] = useState<string | undefined>();
  const [remotes, setRemotes] = useState<Array<{ remote: string; url: string }>>([]);

  // PRs
  const [prs, setPrs] = useState<gh.PullRequest[]>([]);
  const [prDetail, setPrDetail] = useState<gh.PullRequest | null>(null);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [prHead, setPrHead] = useState('');
  const [prBase, setPrBase] = useState('');
  const [prComment, setPrComment] = useState('');

  // Issues
  const [issues, setIssues] = useState<gh.Issue[]>([]);
  const [issueDetail, setIssueDetail] = useState<gh.Issue | null>(null);
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');
  const [issueComment, setIssueComment] = useState('');

  // Actions
  const [runs, setRuns] = useState<gh.WorkflowRun[]>([]);
  const [workflows, setWorkflows] = useState<gh.Workflow[]>([]);

  // Repo
  const [repos, setRepos] = useState<gh.GithubRepo[]>([]);
  const [repoInfo, setRepoInfo] = useState<gh.GithubRepo | null>(null);
  const [notifications, setNotifications] = useState<gh.Notification[]>([]);
  const [releases, setReleases] = useState<gh.Release[]>([]);
  const [releaseTag, setReleaseTag] = useState('');
  const [releaseName, setReleaseName] = useState('');
  const [releaseBody, setReleaseBody] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ issues: gh.Issue[]; repos: gh.GithubRepo[] }>({ issues: [], repos: [] });
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneName, setCloneName] = useState('');

  // Settings / stash / config
  const [configList, setConfigList] = useState<Array<{ path: string; value: string }>>([]);
  const [configKey, setConfigKey] = useState('');
  const [configValue, setConfigValue] = useState('');
  const [stashList, setStashList] = useState<string>('');
  const [hostStatus, setHostStatus] = useState<LocalGitStatus | null>(null);
  const [hostStatusError, setHostStatusError] = useState<string | null>(null);

  function showMessage(text: string, type: 'info' | 'error' | 'success' = 'info') {
    setNotice({ text, type });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setNotice(null), 6000);
  }

  const refreshStatus = useCallback(async () => {
    if (isBrowserWorkspace) {
      setHostStatus(null);
      setHostStatusError(null);
      setStatus([]);
      setCurrent(undefined);
      setBranches([]);
      setRemotes([]);
      setTags([]);
      setIsRepo(false);
      setRepoFullName(undefined);
      return;
    }
    if (isHostWorkspace) {
      try {
        const s = await localGitStatus(projectDir);
        setHostStatus(s);
        setHostStatusError(null);
        setStatus([]);
        setCurrent(s.branch || undefined);
        setBranches([]);
        setRemotes([]);
        setTags([]);
        setIsRepo(Boolean(s.exists && s.branch));
        setRepoFullName(undefined);
      } catch (e: any) {
        setHostStatus(null);
        setHostStatusError(e.message || 'Host git status failed.');
        setStatus([]);
        setCurrent(undefined);
        setBranches([]);
        setRemotes([]);
        setTags([]);
        setIsRepo(false);
        setRepoFullName(undefined);
      }
      return;
    }
    try {
      setHostStatus(null);
      setHostStatusError(null);
      const s = await git.statusList(projectDir);
      const c = await git.currentBranch(projectDir);
      const b = await git.listBranches(projectDir);
      const r = await git.listRemotes(projectDir);
      const t = await git.listTags(projectDir).catch(() => [] as string[]);
      setStatus(s);
      setCurrent(c);
      setBranches(b);
      setRemotes(r);
      setTags(t);
      setIsRepo(true);

      const origin = r.find((x) => x.remote === 'origin') || r[0];
      setRepoFullName(parseGitHubFullName(origin?.url));
    } catch {
      setStatus([]);
      setCurrent(undefined);
      setBranches([]);
      setTags([]);
      setIsRepo(false);
      setRepoFullName(undefined);
    }
  }, [isBrowserWorkspace, isHostWorkspace, projectDir]);

  const refreshHistory = useCallback(async () => {
    if (isHostWorkspace || isBrowserWorkspace) {
      setCommits([]);
      return;
    }
    try {
      const log = await git.log(projectDir, { depth: 40 });
      setCommits(
        log.map((c) => ({
          oid: c.oid,
          message: c.commit.message.split('\n')[0],
          author: c.commit.author.name,
          date: new Date(c.commit.author.timestamp * 1000).toLocaleDateString(),
        })),
      );
    } catch {
      setCommits([]);
    }
  }, [isBrowserWorkspace, isHostWorkspace, projectDir]);

  const refreshRemoteBranches = useCallback(async () => {
    if (isHostWorkspace || isBrowserWorkspace) {
      setRemoteBranches([]);
      return;
    }
    try {
      setRemoteBranches(await git.listRemoteBranches(projectDir));
    } catch {
      setRemoteBranches([]);
    }
  }, [isBrowserWorkspace, isHostWorkspace, projectDir]);

  const refreshConfig = useCallback(async () => {
    if (isHostWorkspace || isBrowserWorkspace) {
      setConfigList([]);
      return;
    }
    try {
      const cfg = await git.getConfigAll(projectDir);
      setConfigList((cfg || []).map((c: any) => ({ path: c.path || c.key, value: String(c.value) })));
    } catch {
      setConfigList([]);
    }
  }, [isBrowserWorkspace, isHostWorkspace, projectDir]);

  const refreshStash = useCallback(async () => {
    if (isHostWorkspace || isBrowserWorkspace) {
      setStashList(isBrowserWorkspace ? 'Browser folder workspaces do not expose Git operations yet.' : 'Host workspaces use read-only Git status in this panel.');
      return;
    }
    try {
      const res = await git.stash(projectDir, 'list');
      setStashList(typeof res === 'string' ? res : 'No stashes');
    } catch {
      setStashList('No stashes');
    }
  }, [isBrowserWorkspace, isHostWorkspace, projectDir]);

  const refreshPRs = useCallback(async () => {
    if (!repoFullName) return;
    try {
      setPrs(await gh.listPullRequests(repoFullName, { state: 'open' }));
    } catch (e: any) {
      showMessage('PR list failed: ' + e.message, 'error');
    }
  }, [repoFullName]);

  const refreshIssues = useCallback(async () => {
    if (!repoFullName) return;
    try {
      setIssues(await gh.listIssues(repoFullName, { state: 'open' }));
    } catch (e: any) {
      showMessage('Issue list failed: ' + e.message, 'error');
    }
  }, [repoFullName]);

  const refreshActions = useCallback(async () => {
    if (!repoFullName) return;
    try {
      const r = await gh.listWorkflowRuns(repoFullName);
      setRuns(r.workflow_runs ?? []);
    } catch (e: any) {
      showMessage('Actions list failed: ' + e.message, 'error');
    }
  }, [repoFullName]);

  const refreshRepoTab = useCallback(async () => {
    if (!repoFullName) return;
    try {
      setRepoInfo(await gh.getRepo(repoFullName));
    } catch (e: any) {
      showMessage('Repo info failed: ' + e.message, 'error');
    }
    if (!ghUser) return;
    try {
      const n = await gh.listNotifications({ participating: false });
      setNotifications(n.slice(0, 20));
    } catch {
      setNotifications([]);
    }
  }, [repoFullName, ghUser]);

  const refreshWorkflows = useCallback(async () => {
    if (!repoFullName) return;
    try {
      const w = await gh.listWorkflows(repoFullName);
      setWorkflows(w.workflows || []);
    } catch {}
  }, [repoFullName]);

  const refreshReleases = useCallback(async () => {
    if (!repoFullName) return;
    try {
      setReleases(await gh.listReleases(repoFullName));
    } catch (e: any) { showMessage('Releases failed: ' + e.message, 'error'); }
  }, [repoFullName]);

  useEffect(() => {
    refreshStatus();
    refreshHistory();
    gh.cachedUser().then(setGhUser);
  }, [projectDir, refreshStatus, refreshHistory]);

  useEffect(() => {
    if (isBrowserWorkspace && tab !== 'status') setTab('status');
  }, [isBrowserWorkspace, tab]);

  useEffect(() => {
    if (tab === 'prs') refreshPRs();
    if (tab === 'issues') refreshIssues();
    if (tab === 'actions') { refreshActions(); refreshWorkflows(); }
    if (tab === 'repo') { refreshRepoTab(); refreshReleases(); }
    if (tab === 'settings') { refreshConfig(); refreshStash(); refreshRemoteBranches(); }
  }, [tab, refreshPRs, refreshIssues, refreshActions, refreshRepoTab, refreshConfig, refreshStash, refreshRemoteBranches, refreshWorkflows, refreshReleases]);

  // palette commands
  useEffect(() => {
    const wrap = (fn: () => void | Promise<void>) => async () => {
      try { await fn(); } catch (e: any) { showMessage(e.message, 'error'); }
    };
    const cmds = [
      { id: 'git.stage', title: 'Git: Stage selected files', category: 'git', run: wrap(handleStageSelected) },
      { id: 'git.commit', title: 'Git: Commit', category: 'git', run: wrap(commit) },
      { id: 'git.push', title: 'Git: Push', category: 'git', run: wrap(push) },
      { id: 'git.pull', title: 'Git: Pull', category: 'git', run: wrap(pull) },
      { id: 'git.fetch', title: 'Git: Fetch', category: 'git', run: wrap(doFetch) },
      { id: 'git.sync', title: 'Git: Sync (pull then push)', category: 'git', run: wrap(sync) },
      { id: 'git.create-pr', title: 'Git: Create Pull Request', category: 'git', run: () => { if (!isBrowserWorkspace) setTab('prs'); } },
      { id: 'git.create-issue', title: 'Git: Create Issue', category: 'git', run: () => { if (!isBrowserWorkspace) setTab('issues'); } },
      { id: 'git.view-actions', title: 'Git: View Actions', category: 'git', run: () => { if (!isBrowserWorkspace) setTab('actions'); } },
    ];
    cmds.forEach((c) => ext.host.registerCommand(c));
    return () => cmds.forEach((c) => ext.host.unregisterCommand(c.id));
  }, [projectDir, commitMsg, selectedFiles, current, author, repoFullName, isBrowserWorkspace]);

  async function initRepo() {
    setBusy(true);
    try {
      await git.init(projectDir);
      await git.addAll(projectDir);
      await git.commit(projectDir, 'Initial commit', author);
      showMessage('Initialized repository.', 'success');
      onRefresh();
      refreshStatus();
      refreshHistory();
    } catch (e: any) {
      showMessage('Init failed: ' + e.message, 'error');
    } finally { setBusy(false); }
  }

  async function handleStageSelected() {
    if (selectedFiles.size === 0) return;
    setBusy(true);
    try {
      for (const path of Array.from(selectedFiles)) {
        const entry = status.find((s) => s.path === path);
        if (!entry) continue;
        if (entry.workdir === 0) await git.remove(projectDir, path);
        else await git.add(projectDir, path);
      }
      showMessage(`Staged ${selectedFiles.size} file(s).`, 'success');
      setSelectedFiles(new Set());
      await refreshStatus();
    } catch (e: any) {
      showMessage(e.message, 'error');
    } finally { setBusy(false); }
  }

  async function stageAll() {
    setBusy(true);
    try {
      await git.stageAll(projectDir);
      showMessage('Staged all changes.', 'success');
      await refreshStatus();
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function commit() {
    if (!commitMsg) return;
    const fullMsg = commitScope ? `${commitType}(${commitScope}): ${commitMsg}` : `${commitType}: ${commitMsg}`;
    setBusy(true);
    try {
      await git.commit(projectDir, fullMsg, author);
      setCommitMsg('');
      setCommitScope('');
      showMessage('Committed.', 'success');
      await refreshStatus();
      await refreshHistory();
    } catch (e: any) { showMessage('Commit failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function push() {
    setBusy(true);
    try {
      const token = await gh.getToken();
      const res = await git.push(projectDir, {
        auth: token ? { username: 'x-access-token', password: token } : undefined,
        onProgress: (phase) => showMessage('push: ' + phase),
      });
      showMessage('Push complete: ' + (res.ok ? 'ok' : JSON.stringify(res)), 'success');
      await refreshStatus();
    } catch (e: any) { showMessage('Push failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function pull() {
    setBusy(true);
    try {
      const token = await gh.getToken();
      await git.pull(projectDir, {
        auth: token ? { username: 'x-access-token', password: token } : undefined,
        author,
      });
      showMessage('Pulled.', 'success');
      await refreshStatus();
      await refreshHistory();
      onRefresh();
    } catch (e: any) { showMessage('Pull failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function doFetch() {
    setBusy(true);
    try {
      const token = await gh.getToken();
      await git.fetch(projectDir, {
        auth: token ? { username: 'x-access-token', password: token } : undefined,
      });
      showMessage('Fetched.', 'success');
      await refreshRemoteBranches();
    } catch (e: any) { showMessage('Fetch failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function sync() {
    setBusy(true);
    try {
      const token = await gh.getToken();
      await git.pull(projectDir, { auth: token ? { username: 'x-access-token', password: token } : undefined, author });
      await git.push(projectDir, { auth: token ? { username: 'x-access-token', password: token } : undefined });
      showMessage('Synced (pulled & pushed).', 'success');
      await refreshStatus();
      await refreshHistory();
      onRefresh();
    } catch (e: any) { showMessage('Sync failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function discardFile(path: string) {
    if (!confirm(`Discard changes to ${path}?`)) return;
    setBusy(true);
    try {
      await git.restore(projectDir, path);
      showMessage(`Discarded ${path}`, 'info');
      await refreshStatus();
    } catch (e: any) { showMessage('Discard failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function createBranch() {
    const name = prompt('New branch name:');
    if (!name) return;
    setBusy(true);
    try {
      await git.createBranch(projectDir, name, true);
      showMessage(`Created and switched to ${name}`, 'success');
      await refreshStatus();
      await refreshHistory();
      onRefresh();
    } catch (e: any) { showMessage('Branch failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function renameBranch() {
    if (!current) return;
    const name = prompt(`Rename branch "${current}" to:`);
    if (!name) return;
    setBusy(true);
    try {
      await git.renameBranch(projectDir, current, name);
      showMessage(`Renamed to ${name}`, 'success');
      await refreshStatus();
      await refreshHistory();
    } catch (e: any) { showMessage('Rename failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function deleteBranch(name: string) {
    if (!confirm(`Delete branch "${name}"?`)) return;
    setBusy(true);
    try {
      await git.deleteBranch(projectDir, name);
      showMessage(`Deleted ${name}`, 'success');
      await refreshStatus();
    } catch (e: any) { showMessage('Delete failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function switchBranch(name: string) {
    setBusy(true);
    try {
      await git.checkout(projectDir, name);
      showMessage(`Switched to ${name}`, 'success');
      await refreshStatus();
      await refreshHistory();
      onRefresh();
    } catch (e: any) { showMessage('Checkout failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function mergeBranch(name: string) {
    if (!current) return;
    if (!confirm(`Merge "${name}" into "${current}"?`)) return;
    setBusy(true);
    try {
      await git.merge(projectDir, current, name, author);
      showMessage(`Merged ${name}`, 'success');
      await refreshStatus();
      await refreshHistory();
    } catch (e: any) { showMessage('Merge failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function createTagAction() {
    const name = prompt('Tag name:');
    if (!name) return;
    const msg = prompt('Tag message (optional, for annotated tag):');
    setBusy(true);
    try {
      if (msg) {
        await git.createTag(projectDir, name, { message: msg, tagger: author });
      } else {
        await git.createTag(projectDir, name);
      }
      showMessage(`Created tag ${name}`, 'success');
      await refreshStatus();
    } catch (e: any) { showMessage('Tag failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function deleteTagAction(ref: string) {
    if (!confirm(`Delete tag ${ref}?`)) return;
    setBusy(true);
    try {
      await git.deleteTag(projectDir, ref);
      showMessage('Deleted tag.', 'success');
      await refreshStatus();
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function createPR() {
    if (!repoFullName) { showMessage('No GitHub remote detected.', 'error'); return; }
    if (!prTitle) return;
    setBusy(true);
    try {
      const pr = await gh.createPullRequest(repoFullName, {
        title: prTitle,
        body: prBody || undefined,
        head: prHead || current || 'main',
        base: prBase || 'main',
      });
      showMessage(`Created PR #${pr.number}`, 'success');
      setPrTitle(''); setPrBody(''); setPrHead(''); setPrBase('');
      await refreshPRs();
      setPrDetail(pr);
    } catch (e: any) { showMessage('Create PR failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function mergePR(number: number, method: 'merge' | 'squash' | 'rebase' = 'merge') {
    setBusy(true);
    try {
      await gh.mergePullRequest(repoFullName!, number, { merge_method: method });
      showMessage(`Merged PR #${number}`, 'success');
      await refreshPRs();
      setPrDetail(null);
    } catch (e: any) { showMessage('Merge failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function reviewPR(number: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT') {
    setBusy(true);
    try {
      await gh.createPullRequestReview(repoFullName!, number, { body: prComment || undefined, event });
      showMessage('Review submitted.', 'success');
      setPrComment('');
      if (prDetail) setPrDetail(await gh.getPullRequest(repoFullName!, prDetail.number));
      await refreshPRs();
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function closePR(number: number) {
    setBusy(true);
    try {
      await gh.updatePullRequest(repoFullName!, number, { state: 'closed' });
      showMessage('Closed PR.', 'success');
      await refreshPRs();
      setPrDetail(null);
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function checkoutPRBranch(number: number) {
    setBusy(true);
    try {
      await git.fetch(projectDir, { remote: 'origin', ref: `refs/pull/${number}/head` });
      await git.createBranch(projectDir, `pr-${number}`, true, `refs/pull/${number}/head`);
      showMessage(`Checked out PR #${number} as pr-${number}`, 'success');
      await refreshStatus();
      await refreshHistory();
      onRefresh();
    } catch (e: any) { showMessage('PR checkout failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function createIssueAction() {
    if (!repoFullName) { showMessage('No GitHub remote.', 'error'); return; }
    if (!issueTitle) return;
    setBusy(true);
    try {
      const issue = await gh.createIssue(repoFullName, { title: issueTitle, body: issueBody || undefined });
      showMessage(`Created issue #${issue.number}`, 'success');
      setIssueTitle(''); setIssueBody('');
      await refreshIssues();
      setIssueDetail(issue);
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function closeIssue(number: number) {
    setBusy(true);
    try {
      await gh.updateIssue(repoFullName!, number, { state: 'closed' });
      showMessage('Closed issue.', 'success');
      await refreshIssues();
      setIssueDetail(null);
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function commentOnIssue(number: number) {
    if (!issueComment.trim()) return;
    setBusy(true);
    try {
      await gh.createIssueComment(repoFullName!, number, issueComment);
      showMessage('Commented.', 'success');
      setIssueComment('');
      if (issueDetail) {
        const updated = await gh.getIssue(repoFullName!, issueDetail.number);
        setIssueDetail(updated);
      }
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function rerunRun(runId: number) {
    if (!repoFullName) return;
    setBusy(true);
    try {
      await gh.rerunWorkflowRun(repoFullName, runId);
      showMessage('Rerun queued.', 'success');
      await refreshActions();
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function cancelRun(runId: number) {
    if (!repoFullName) return;
    setBusy(true);
    try {
      await gh.cancelWorkflowRun(repoFullName, runId);
      showMessage('Run cancelled.', 'success');
      await refreshActions();
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function forkCurrentRepo() {
    if (!repoFullName || !repoInfo) { showMessage('No GitHub repo detected.', 'error'); return; }
    setBusy(true);
    try {
      const fork = await gh.forkRepo(repoFullName, { default_branch_only: false });
      showMessage(`Forked to ${fork.full_name}`, 'success');
      setRepoInfo(fork);
    } catch (e: any) { showMessage('Fork failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function handleClone() {
    if (!cloneUrl) return;
    const dir = join(ROOT, cloneName || basename(cloneUrl).replace(/\.git$/, ''));
    setBusy(true);
    showMessage('Cloning...');
    try {
      const t = await gh.getToken();
      await git.clone({
        dir,
        url: cloneUrl,
        auth: t ? { username: 'x-access-token', password: t } : undefined,
        onProgress: (phase, loaded, total) => {
          showMessage(`${phase} ${loaded ?? ''}${total ? '/' + total : ''}`);
        },
      });
      showMessage('Cloned.', 'success');
      onProjectChanged(dir);
      onRefresh();
    } catch (e: any) { showMessage('Clone failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function signInGithub() {
    if (!token) return;
    await gh.setToken(token);
    const user = await gh.getCurrentUser();
    setGhUser(user);
    setToken('');
    if (user) showMessage(`Signed in as ${user.login}`, 'success');
  }

  async function loadRepos() {
    try { setRepos(await gh.listRepos()); }
    catch (e: any) { showMessage('GitHub error: ' + e.message, 'error'); }
  }

  async function createRepoAndPush() {
    const name = prompt('Create GitHub repo named:');
    if (!name) return;
    setBusy(true);
    try {
      const repo = await gh.createRepo(name, { auto_init: false });
      await git.addRemote(projectDir, 'origin', repo.clone_url);
      const t = await gh.getToken();
      await git.push(projectDir, { auth: t ? { username: 'x-access-token', password: t } : undefined });
      showMessage(`Published to ${repo.full_name}`, 'success');
      await refreshStatus();
    } catch (e: any) { showMessage('Publish failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function addRemoteAction() {
    const name = prompt('Remote name:');
    const url = prompt('Remote URL:');
    if (!name || !url) return;
    setBusy(true);
    try {
      await git.addRemote(projectDir, name, url);
      showMessage(`Added remote ${name}`, 'success');
      await refreshStatus();
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function removeRemoteAction(name: string) {
    if (!confirm(`Remove remote "${name}"?`)) return;
    setBusy(true);
    try {
      await git.deleteRemote(projectDir, name);
      showMessage(`Removed ${name}`, 'success');
      await refreshStatus();
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function saveConfig() {
    if (!configKey.trim()) return;
    setBusy(true);
    try {
      await git.setConfig(projectDir, configKey, configValue);
      showMessage('Config saved.', 'success');
      setConfigKey(''); setConfigValue('');
      await refreshConfig();
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function stashPush() {
    const msg = prompt('Stash message (optional):');
    setBusy(true);
    try {
      await git.stash(projectDir, 'push', { message: msg || undefined });
      showMessage('Stashed.', 'success');
      await refreshStash();
      await refreshStatus();
    } catch (e: any) { showMessage('Stash failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function stashPop() {
    setBusy(true);
    try {
      await git.stash(projectDir, 'pop');
      showMessage('Stash popped.', 'success');
      await refreshStash();
      await refreshStatus();
    } catch (e: any) { showMessage('Pop failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function stashDrop() {
    setBusy(true);
    try {
      await git.stash(projectDir, 'drop');
      showMessage('Dropped stash.', 'success');
      await refreshStash();
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function markNotifRead(id: string) {
    try { await gh.markNotificationRead(id); setNotifications((n) => n.filter((x) => x.id !== id)); }
    catch (e: any) { showMessage(e.message, 'error'); }
  }

  async function createReleaseAction() {
    if (!repoFullName) { showMessage('No GitHub remote.', 'error'); return; }
    if (!releaseTag) return;
    setBusy(true);
    try {
      await gh.createRelease(repoFullName, { tag_name: releaseTag, name: releaseName || undefined, body: releaseBody || undefined });
      showMessage(`Created release ${releaseTag}`, 'success');
      setReleaseTag(''); setReleaseName(''); setReleaseBody('');
      await refreshReleases();
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function runSearch() {
    if (!searchQuery.trim()) return;
    setBusy(true);
    try {
      const [issuesRes, reposRes] = await Promise.all([
        gh.searchIssues(`repo:${repoFullName} ${searchQuery}`).catch(() => ({ items: [] as gh.Issue[] })),
        gh.searchRepos(searchQuery).catch(() => ({ items: [] as gh.GithubRepo[] })),
      ]);
      setSearchResults({ issues: issuesRes.items.slice(0, 10), repos: reposRes.items.slice(0, 10) });
    } catch (e: any) { showMessage(e.message, 'error'); }
    finally { setBusy(false); }
  }

  // ---- render helpers ----

  const toggleFile = (path: string) => {
    const next = new Set(selectedFiles);
    if (next.has(path)) next.delete(path); else next.add(path);
    setSelectedFiles(next);
  };

  const isAllSelected = status.length > 0 && status.every((s) => selectedFiles.has(s.path));
  const selectAllToggle = () => {
    if (isAllSelected) setSelectedFiles(new Set());
    else setSelectedFiles(new Set(status.map((s) => s.path)));
  };
  const tabs: Tab[] = ['status', 'branches', 'prs', 'issues', 'actions', 'repo', 'settings'];
  const dirtyCount = isHostWorkspace ? (hostStatus?.changedFiles.length ?? 0) : status.length;
  const stagedCount = status.filter((s) => s.label === 'staged').length;
  const remoteLabel = isBrowserWorkspace
    ? 'browser folder'
    : isHostWorkspace
    ? hostStatus ? `${hostStatus.clean ? 'clean' : 'dirty'} · ↑${hostStatus.ahead} ↓${hostStatus.behind}` : 'host status'
    : repoFullName || remotes.find((r) => r.remote === 'origin')?.url || 'no GitHub remote';

  return (
    <div className="panel git-panel" data-vertical={vertical}>
      <div className="panel-header git-panel-header">
        <div className="git-title-row">
          <div className="panel-title"><Glyph name="git" /> Source Control</div>
          <div className="git-vertical-mark" aria-label={`${vertical} git vertical`}>
            <span>{vertical}</span>
          </div>
        </div>
        <div className="git-command-strip" aria-label="Repository summary">
          <span><Glyph name="branch" /> {current || '(none)'}</span>
          <span><Glyph name="diff_mod" /> {dirtyCount} changed</span>
          <span><Glyph name="commit" /> {stagedCount} staged</span>
          <span title={remoteLabel}><Glyph name="projects" /> {remoteLabel}</span>
        </div>
        <div className="git-tabs">
          {tabs.map((t) => (
            <button
              key={t}
              className={tab === t ? 'active' : ''}
              disabled={isBrowserWorkspace && t !== 'status'}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              title={isBrowserWorkspace && t !== 'status' ? 'Unavailable for browser-folder workspaces' : tabLabel(t)}
            >
              <Glyph name={tabGlyph(t)} />
              <span className="git-tab-full">{tabLabel(t)}</span>
              <span className="git-tab-short">{tabShortLabel(t)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="git-body">
        {tab === 'status' && (
          <div className="git-tab">
            <div className="git-meta-row">
              <span className="git-meta-branch"><Glyph name="branch" /> {current || '(none)'}</span>
              <span className="git-meta-dir" title={projectDir}>{projectDir.replace(ROOT + '/', '~/')}</span>
            </div>
            {isHostWorkspace && (
              <div className="git-section host-git-section">
                <div className="git-section-title row-between">
                  <span>Host repository</span>
                  {hostStatus && (
                    <span className="muted small">
                      {hostStatus.clean ? 'clean' : `${hostStatus.changedFiles.length} changed`} · ↑{hostStatus.ahead} ↓{hostStatus.behind}
                    </span>
                  )}
                </div>
                {hostStatusError && <div className="panel-error">{hostStatusError}</div>}
                {hostStatus && !hostStatus.branch && (
                  <div className="muted">No host Git repository was found at this path.</div>
                )}
                {hostStatus?.branch && (
                  <>
                    {hostStatus.lastCommit && (
                      <div className="host-git-commit">
                        <code>{hostStatus.lastCommit.sha.slice(0, 7)}</code>
                        <span title={hostStatus.lastCommit.subject}>{hostStatus.lastCommit.subject}</span>
                        <span className="muted small">{hostStatus.lastCommit.author}</span>
                      </div>
                    )}
                    <div className="status-list">
                      {hostStatus.changedFiles.length === 0 && <div className="muted">Working tree clean.</div>}
                      {hostStatus.changedFiles.map((f) => {
                        const label = hostStatusLabel(f.status);
                        return (
                          <div key={f.status + f.path} className="status-row-wrap">
                            <div className="status-row host-status-row">
                              <span className={'status-label status-' + label}>{f.status || label}</span>
                              <span className="status-path" title={f.path}>{f.path}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="muted small">Host workspaces show read-only Git status here; browser Git write actions remain available for virtual/cloned projects.</div>
                  </>
                )}
              </div>
            )}
            {isBrowserWorkspace && (
              <div className="git-section">
                <div className="git-section-title">Browser folder workspace</div>
                <div className="muted">Git operations are not available for browser-selected folders yet. Open the same repository through a host path for Git status and terminal workflows.</div>
              </div>
            )}
            {!isBrowserWorkspace && !isHostWorkspace && !isRepo && (
              <div className="git-section">
                <div className="git-section-title">Not a git repository</div>
                <button disabled={busy} onClick={initRepo}>Initialize repository</button>
              </div>
            )}
            {!isBrowserWorkspace && !isHostWorkspace && isRepo && (
              <>
                <div className="git-section">
                  <div className="git-section-title row-between">
                    <span>Changes ({status.length})</span>
                    <span className="muted small">{selectedFiles.size} selected</span>
                  </div>
                  <div className="row">
                    <button className="small" onClick={selectAllToggle}>
                      {isAllSelected ? 'Deselect all' : 'Select all'}
                    </button>
                    <button className="small" disabled={busy || selectedFiles.size === 0} onClick={handleStageSelected}>
                      Stage selected
                    </button>
                    <button className="small" disabled={busy} onClick={stageAll}>Stage all</button>
                  </div>
                  <div className="status-list">
                    {status.length === 0 && <div className="muted">Working tree clean.</div>}
                    {status.map((s) => {
                      const canDiff = s.label === 'modified' || s.label === 'new' || s.label === 'deleted';
                      const isSel = selectedFiles.has(s.path);
                      return (
                        <div key={s.path} className="status-row-wrap">
                          <label className="status-row" title={canDiff ? 'View diff' : ''}>
                            <input type="checkbox" checked={isSel} onChange={() => toggleFile(s.path)} />
                            <span className={'status-label status-' + s.label}>{s.label}</span>
                            <span className="status-path">{s.path}</span>
                            {canDiff && (
                              <button className="icon-btn" onClick={(e) => { e.preventDefault(); setDiffPath(diffPath === s.path ? null : s.path); }}>
                                <Glyph name={diffPath === s.path ? 'chevron_dn' : 'chevron_rt'} />
                              </button>
                            )}
                            <button className="icon-btn" title="Discard" onClick={(e) => { e.preventDefault(); discardFile(s.path); }}>
                              <Glyph name="trash" />
                            </button>
                          </label>
                          {diffPath === s.path && canDiff && (
                            <DiffView projectDir={projectDir} path={s.path} onClose={() => setDiffPath(null)} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="git-section">
                  <div className="git-section-title">Commit</div>
                  <div className="row">
                    <select value={commitType} onChange={(e) => setCommitType(e.target.value)} aria-label="Commit type">
                      <option value="feat">feat</option>
                      <option value="fix">fix</option>
                      <option value="docs">docs</option>
                      <option value="style">style</option>
                      <option value="refactor">refactor</option>
                      <option value="test">test</option>
                      <option value="chore">chore</option>
                    </select>
                    <input
                      placeholder="scope (optional)"
                      value={commitScope}
                      onChange={(e) => setCommitScope(e.target.value)}
                      style={{ flex: 1 }}
                    />
                  </div>
                  <input
                    placeholder="Commit message"
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); } }}
                  />
                  <div className="row">
                    <button disabled={busy || !commitMsg} onClick={commit}>Commit</button>
                    <button disabled={busy || !commitMsg} onClick={() => git.commit(projectDir, commitMsg, author, { amend: true }).then(() => { showMessage('Amended.', 'success'); refreshHistory(); refreshStatus(); }).catch((e: any) => showMessage(e.message, 'error'))}>Amend</button>
                    <button disabled={busy} onClick={doFetch}>Fetch</button>
                    <button disabled={busy} onClick={pull}>Pull</button>
                    <button disabled={busy} onClick={push}>Push</button>
                    <button disabled={busy} onClick={sync}>Sync</button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'branches' && (
          <div className="git-tab">
            <div className="git-section">
              <div className="git-section-title">Local branches</div>
              <div className="branch-list">
                {branches.map((b) => (
                  <div key={b} className="branch-chip">
                    <button className={b === current ? 'branch-current' : ''} onClick={() => switchBranch(b)}>{b}</button>
                    {b !== current && (
                      <>
                        <button className="small icon-btn" title="Merge" onClick={() => mergeBranch(b)}><Glyph name="branch" /></button>
                        <button className="small icon-btn" title="Delete" onClick={() => deleteBranch(b)}><Glyph name="trash" /></button>
                      </>
                    )}
                  </div>
                ))}
                <button onClick={createBranch} className="branch-new"><Glyph name="plus" /> new</button>
                <button onClick={renameBranch} className="branch-new"><Glyph name="pencil" /> rename</button>
              </div>
            </div>

            <div className="git-section">
              <div className="git-section-title">Remote branches</div>
              <div className="remote-branch-list">
                {remoteBranches.length === 0 && <div className="muted">Run Fetch to populate remote branches.</div>}
                {remoteBranches.map((b) => (
                  <button key={b} onClick={() => switchBranch(b)}>{b}</button>
                ))}
              </div>
            </div>

            <div className="git-section">
              <div className="git-section-title">Tags</div>
              <div className="tag-list">
                {tags.map((t) => (
                  <span key={t} className="tag-chip">
                    <code>{t}</code>
                    <button className="icon-btn" onClick={() => deleteTagAction(t)}><Glyph name="trash" /></button>
                  </span>
                ))}
                <button onClick={createTagAction}><Glyph name="plus" /> new tag</button>
              </div>
            </div>

            <div className="git-section">
              <div className="git-section-title">Recent commits</div>
              <div className="commits">
                {commits.map((c) => (
                  <div key={c.oid} className="commit-row">
                    <code>{c.oid.slice(0, 7)}</code>
                    <span className="commit-msg" title={c.message}>{c.message}</span>
                    <span className="muted small">{c.author} · {c.date}</span>
                  </div>
                ))}
                {commits.length === 0 && <div className="muted">No commits.</div>}
              </div>
            </div>
          </div>
        )}

        {tab === 'prs' && (
          <div className="git-tab">
            {!repoFullName && <div className="muted">No GitHub remote detected. Add an origin remote first.</div>}
            {repoFullName && (
              <>
                <div className="git-section">
                  <div className="git-section-title">Create Pull Request</div>
                  <input placeholder="PR title" value={prTitle} onChange={(e) => setPrTitle(e.target.value)} />
                  <textarea placeholder="PR body (markdown)" rows={3} value={prBody} onChange={(e) => setPrBody(e.target.value)} />
                  <div className="row">
                    <input placeholder="head branch" value={prHead} onChange={(e) => setPrHead(e.target.value)} style={{ flex:1 }} />
                    <span className="muted">→</span>
                    <input placeholder="base branch" value={prBase} onChange={(e) => setPrBase(e.target.value)} style={{ flex:1 }} />
                  </div>
                  <button disabled={busy || !prTitle} onClick={createPR}>Create PR</button>
                </div>
                <div className="git-section">
                  <div className="git-section-title">Pull Requests ({prs.length})</div>
                  <div className="gh-list">
                    {prs.map((pr) => (
                      <button
                        key={pr.number}
                        className={'gh-list-item ' + (prDetail?.number === pr.number ? 'active' : '')}
                        onClick={() => setPrDetail(pr)}
                      >
                        <span className="gh-number">#{pr.number}</span>
                        <span className="gh-title">{pr.title}</span>
                        <span className={'gh-badge ' + (pr.state === 'open' ? 'open' : 'closed')}>{pr.state}</span>
                        {pr.draft && <span className="gh-badge draft">draft</span>}
                        <span className="muted small">{pr.user?.login}</span>
                      </button>
                    ))}
                    {prs.length === 0 && <div className="muted">No open PRs.</div>}
                  </div>
                </div>
                {prDetail && (
                  <div className="git-section pr-detail">
                    <div className="row-between">
                      <div><b>#{prDetail.number}</b> {prDetail.title}</div>
                      <button className="icon-btn" onClick={() => setPrDetail(null)}><Glyph name="close" /></button>
                    </div>
                    <div className="muted small">{prDetail.head.ref} → {prDetail.base.ref} · {prDetail.state} · {prDetail.user?.login}</div>
                    <div className="pr-body">{prDetail.body || <em className="muted">No description.</em>}</div>
                    <div className="row">
                      <button disabled={busy} onClick={() => checkoutPRBranch(prDetail.number)}>Checkout PR</button>
                      <button disabled={busy} onClick={() => mergePR(prDetail.number, 'merge')}>Merge</button>
                      <button disabled={busy} onClick={() => mergePR(prDetail.number, 'squash')}>Squash</button>
                      <button disabled={busy} onClick={() => mergePR(prDetail.number, 'rebase')}>Rebase</button>
                      <button disabled={busy} onClick={() => closePR(prDetail.number)}>Close</button>
                    </div>
                    <div className="row">
                      <input placeholder="Review comment" value={prComment} onChange={(e) => setPrComment(e.target.value)} style={{ flex: 1 }} />
                      <button disabled={busy} onClick={() => reviewPR(prDetail.number, 'COMMENT')}>Comment</button>
                      <button disabled={busy} onClick={() => reviewPR(prDetail.number, 'APPROVE')}>Approve</button>
                      <button disabled={busy} onClick={() => reviewPR(prDetail.number, 'REQUEST_CHANGES')}>Request changes</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'issues' && (
          <div className="git-tab">
            {!repoFullName && <div className="muted">No GitHub remote detected.</div>}
            {repoFullName && (
              <>
                <div className="git-section">
                  <div className="git-section-title">Create Issue</div>
                  <input placeholder="Issue title" value={issueTitle} onChange={(e) => setIssueTitle(e.target.value)} />
                  <textarea placeholder="Issue body (markdown)" rows={3} value={issueBody} onChange={(e) => setIssueBody(e.target.value)} />
                  <button disabled={busy || !issueTitle} onClick={createIssueAction}>Create issue</button>
                </div>
                <div className="git-section">
                  <div className="git-section-title">Issues ({issues.length})</div>
                  <div className="gh-list">
                    {issues.map((issue) => (
                      <button
                        key={issue.number}
                        className={'gh-list-item ' + (issueDetail?.number === issue.number ? 'active' : '')}
                        onClick={() => setIssueDetail(issue)}
                      >
                        <span className="gh-number">#{issue.number}</span>
                        <span className="gh-title">{issue.title}</span>
                        <span className={'gh-badge ' + (issue.state === 'open' ? 'open' : 'closed')}>{issue.state}</span>
                        <span className="muted small">{issue.user?.login} · {issue.comments} comments</span>
                      </button>
                    ))}
                    {issues.length === 0 && <div className="muted">No open issues.</div>}
                  </div>
                </div>
                {issueDetail && (
                  <div className="git-section">
                    <div className="row-between">
                      <div><b>#{issueDetail.number}</b> {issueDetail.title}</div>
                      <button className="icon-btn" onClick={() => setIssueDetail(null)}><Glyph name="close" /></button>
                    </div>
                    <div className="muted small">{issueDetail.state} · {issueDetail.user?.login}</div>
                    <div className="pr-body">{issueDetail.body || <em className="muted">No description.</em>}</div>
                    <div className="row">
                      <button disabled={busy} onClick={() => closeIssue(issueDetail.number)}>Close issue</button>
                    </div>
                    <div className="row">
                      <input placeholder="Comment" value={issueComment} onChange={(e) => setIssueComment(e.target.value)} style={{ flex: 1 }} />
                      <button disabled={busy} onClick={() => commentOnIssue(issueDetail.number)}>Comment</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'actions' && (
          <div className="git-tab">
            {!repoFullName && <div className="muted">No GitHub remote detected.</div>}
            {repoFullName && (
              <>
                <div className="git-section">
                  <div className="git-section-title">Workflows</div>
                  <div className="gh-list">
                    {workflows.map((w) => (
                      <div key={w.id} className="gh-list-item">
                        <span className="gh-title">{w.name}</span>
                        <span className="muted small">{w.path}</span>
                        <span className={'gh-badge ' + (w.state === 'active' ? 'open' : 'closed')}>{w.state}</span>
                      </div>
                    ))}
                    {workflows.length === 0 && <div className="muted">No workflows.</div>}
                  </div>
                </div>
                <div className="git-section">
                  <div className="git-section-title">Recent runs</div>
                  <div className="gh-list">
                    {runs.map((run) => (
                      <div key={run.id} className="gh-list-item">
                        <span className="gh-number">{run.run_number}</span>
                        <span className="gh-title">{run.name}</span>
                        <span className={'gh-badge ' + (run.conclusion || run.status || '')}>{run.conclusion || run.status || 'unknown'}</span>
                        <span className="muted small">{run.head_branch} · {run.event}</span>
                        <div className="row">
                          <a href={run.html_url} target="_blank" rel="noreferrer">View</a>
                          <button disabled={busy} onClick={() => rerunRun(run.id)}>Rerun</button>
                          <button disabled={busy} onClick={() => cancelRun(run.id)}>Cancel</button>
                        </div>
                      </div>
                    ))}
                    {runs.length === 0 && <div className="muted">No runs.</div>}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'repo' && (
          <div className="git-tab">
            <div className="git-section">
              <div className="git-section-title">Current project</div>
              <div className="muted">{projectDir}</div>
              {repoFullName && <div className="muted">GitHub: {repoFullName}</div>}
              {repoInfo && (
                <div className="repo-info">
                  <div className="repo-info-header">
                    <b>{repoInfo.full_name}</b>
                    <span className="gh-badge">{repoInfo.private ? 'private' : 'public'}</span>
                  </div>
                  <div className="repo-stats row">
                    <span>★ {repoInfo.stargazers_count ?? 0}</span>
                    <span>⑂ {repoInfo.forks_count ?? 0}</span>
                    <span>! {repoInfo.open_issues_count ?? 0}</span>
                  </div>
                  <div className="muted small">Updated {repoInfo.pushed_at ? new Date(repoInfo.pushed_at).toLocaleDateString() : '—'}</div>
                </div>
              )}
              <div className="row">
                <button disabled={busy} onClick={forkCurrentRepo}><Glyph name="branch" /> Fork</button>
                <button disabled={busy} onClick={createRepoAndPush}><Glyph name="rocket" /> Publish to GitHub</button>
              </div>
            </div>

            <div className="git-section">
              <div className="git-section-title">Clone from URL</div>
              <input placeholder="https://github.com/user/repo.git" value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)} />
              <input placeholder="Local folder name (optional)" value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
              <button disabled={busy || !cloneUrl} onClick={handleClone}>Clone</button>
            </div>

            <div className="git-section">
              <div className="git-section-title">GitHub</div>
              {ghUser ? (
                <div className="gh-user-row">
                  <img src={ghUser.avatar_url} className="avatar" alt="" />
                  <div>
                    <div>{ghUser.login}</div>
                    <div className="muted small">{ghUser.email || ''}</div>
                  </div>
                  <button onClick={() => { gh.clearToken().then(() => setGhUser(undefined)); }}>Sign out</button>
                </div>
              ) : (
                <div className="row">
                  <input type="password" placeholder="Personal Access Token" value={token} onChange={(e) => setToken(e.target.value)} />
                  <button onClick={signInGithub}>Sign in</button>
                </div>
              )}
              <div className="row">
                <button onClick={loadRepos} disabled={!ghUser}>My repos</button>
              </div>
              {repos.length > 0 && (
                <div className="repo-list">
                  {repos.map((r) => (
                    <button key={r.id} onClick={() => { setCloneUrl(r.clone_url); setCloneName(r.name); }}>
                      {r.full_name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="git-section">
              <div className="git-section-title">Search</div>
              <div className="row">
                <input placeholder="Search issues and repos..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }} style={{ flex: 1 }} />
                <button disabled={busy} onClick={runSearch}>Search</button>
              </div>
              {searchResults.issues.length > 0 && (
                <div className="gh-list">
                  <div className="git-section-title">Issues</div>
                  {searchResults.issues.map((issue) => (
                    <a key={issue.number} href={issue.html_url} target="_blank" rel="noreferrer" className="gh-list-item">
                      <span className="gh-number">#{issue.number}</span>
                      <span className="gh-title">{issue.title}</span>
                    </a>
                  ))}
                </div>
              )}
              {searchResults.repos.length > 0 && (
                <div className="gh-list">
                  <div className="git-section-title">Repos</div>
                  {searchResults.repos.map((r) => (
                    <button key={r.id} className="gh-list-item" onClick={() => { setCloneUrl(r.clone_url); setCloneName(r.name); }}>
                      <span className="gh-title">{r.full_name}</span>
                      <span className="muted small">★ {r.stargazers_count ?? 0}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="git-section">
              <div className="git-section-title">Releases</div>
              <div className="gh-list">
                {releases.length === 0 && <div className="muted">No releases.</div>}
                {releases.slice(0, 10).map((rel) => (
                  <a key={rel.id} href={rel.html_url} target="_blank" rel="noreferrer" className="gh-list-item">
                    <span className="gh-title">{rel.name || rel.tag_name}</span>
                    <span className={'gh-badge ' + (rel.draft ? 'draft' : rel.prerelease ? 'closed' : 'open')}>{rel.draft ? 'draft' : rel.prerelease ? 'pre' : 'release'}</span>
                    <span className="muted small">{rel.tag_name}</span>
                  </a>
                ))}
              </div>
              <div className="git-section-title">Create Release</div>
              <input placeholder="Tag name (e.g. v1.0.0)" value={releaseTag} onChange={(e) => setReleaseTag(e.target.value)} />
              <input placeholder="Release name" value={releaseName} onChange={(e) => setReleaseName(e.target.value)} />
              <textarea placeholder="Release notes (markdown)" rows={2} value={releaseBody} onChange={(e) => setReleaseBody(e.target.value)} />
              <button disabled={busy || !releaseTag} onClick={createReleaseAction}>Create release</button>
            </div>

            <div className="git-section">
              <div className="git-section-title">Notifications</div>
              <div className="gh-list">
                {notifications.length === 0 && <div className="muted">No unread notifications.</div>}
                {notifications.map((n) => (
                  <div key={n.id} className="gh-list-item">
                    <span className="gh-title">{n.subject?.title || 'Notification'}</span>
                    <span className="muted small">{n.repository?.full_name} · {n.reason}</span>
                    <button className="small" onClick={() => markNotifRead(n.id)}>Mark read</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="git-tab">
            <div className="git-section">
              <div className="git-section-title">Remotes</div>
              <div className="remote-list">
                {remotes.map((r) => (
                  <div key={r.remote} className="remote-row">
                    <span className="mono">{r.remote}</span>
                    <span className="muted small" style={{ flex: 1 }}>{r.url}</span>
                    <button className="icon-btn" onClick={() => removeRemoteAction(r.remote)}><Glyph name="trash" /></button>
                  </div>
                ))}
                {remotes.length === 0 && <div className="muted">No remotes.</div>}
              </div>
              <button onClick={addRemoteAction}><Glyph name="plus" /> Add remote</button>
            </div>

            <div className="git-section">
              <div className="git-section-title">Configuration</div>
              <div className="config-list">
                {configList.slice(0, 30).map((c) => (
                  <div key={c.path} className="config-row">
                    <code>{c.path}</code>
                    <span>{c.value}</span>
                  </div>
                ))}
                {configList.length === 0 && <div className="muted">No config loaded.</div>}
              </div>
              <div className="row">
                <input placeholder="key (e.g. user.name)" value={configKey} onChange={(e) => setConfigKey(e.target.value)} />
                <input placeholder="value" value={configValue} onChange={(e) => setConfigValue(e.target.value)} />
                <button disabled={busy || !configKey} onClick={saveConfig}>Set</button>
              </div>
            </div>

            <div className="git-section">
              <div className="git-section-title">Stash</div>
              <pre className="stash-pre">{stashList}</pre>
              <div className="row">
                <button disabled={busy} onClick={stashPush}><Glyph name="plus" /> Push stash</button>
                <button disabled={busy} onClick={stashPop}>Pop</button>
                <button disabled={busy} onClick={stashDrop}>Drop</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {notice && (
        <div className={`panel-status panel-status-${notice.type}`}>
          <Glyph name={notice.type === 'error' ? 'err' : notice.type === 'success' ? 'ok' : 'info'} />
          <span className="panel-status-text">{notice.text}</span>
          <button className="icon-btn" onClick={() => setNotice(null)}><Glyph name="close" /></button>
        </div>
      )}
    </div>
  );
}
