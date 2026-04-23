// Git panel: clone, status, branch, commit, push/pull, log, diff, and
// GitHub integration (sign-in via PAT, repo list, create repo, open PR).

import { useEffect, useState } from 'react';
import * as git from '../lib/git';
import * as gh from '../lib/github';
import { ROOT, join, basename } from '../lib/fs';

type Props = {
  projectDir: string;
  onProjectChanged: (dir: string) => void;
  onRefresh: () => void;
  author: { name: string; email: string };
};

export default function GitPanel({
  projectDir,
  onProjectChanged,
  onRefresh,
  author,
}: Props) {
  const [status, setStatus] = useState<git.StatusEntry[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | undefined>();
  const [commits, setCommits] = useState<Array<{ oid: string; message: string; author: string }>>(
    [],
  );
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // GitHub state
  const [ghUser, setGhUser] = useState<gh.GithubUser | undefined>();
  const [token, setToken] = useState('');
  const [repos, setRepos] = useState<gh.GithubRepo[]>([]);

  async function refresh() {
    try {
      setStatus(await git.statusList(projectDir));
      setBranches(await git.listBranches(projectDir));
      setCurrent(await git.currentBranch(projectDir));
      const log = await git.log(projectDir, { depth: 20 });
      setCommits(
        log.map((c) => ({
          oid: c.oid,
          message: c.commit.message.split('\n')[0],
          author: c.commit.author.name,
        })),
      );
    } catch (e) {
      // not a git repo yet
      setStatus([]);
      setBranches([]);
      setCurrent(undefined);
      setCommits([]);
    }
  }

  useEffect(() => {
    refresh();
    gh.cachedUser().then(setGhUser);
  }, [projectDir]);

  async function initRepo() {
    setBusy(true);
    try {
      await git.init(projectDir);
      await git.stageAll(projectDir);
      await git.commit(projectDir, 'Initial commit', author);
      setMessage('Initialized repository.');
      onRefresh();
    } catch (e: any) {
      setMessage('Init failed: ' + e.message);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function handleClone() {
    if (!cloneUrl) return;
    const dir = join(ROOT, cloneName || basename(cloneUrl).replace(/\.git$/, ''));
    setBusy(true);
    setMessage('Cloning...');
    try {
      const token = await gh.getToken();
      await git.clone({
        dir,
        url: cloneUrl,
        auth: token ? { username: 'x-access-token', password: token } : undefined,
        onProgress: (phase, loaded, total) => {
          setMessage(`${phase} ${loaded ?? ''}${total ? '/' + total : ''}`);
        },
      });
      setMessage('Cloned.');
      onProjectChanged(dir);
      onRefresh();
    } catch (e: any) {
      setMessage('Clone failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function stageAll() {
    await git.stageAll(projectDir);
    await refresh();
  }

  async function commit() {
    if (!commitMsg) return;
    setBusy(true);
    try {
      await git.stageAll(projectDir);
      await git.commit(projectDir, commitMsg, author);
      setCommitMsg('');
      setMessage('Committed.');
      await refresh();
    } catch (e: any) {
      setMessage('Commit failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function push() {
    setBusy(true);
    try {
      const token = await gh.getToken();
      const res = await git.push(projectDir, {
        auth: token ? { username: 'x-access-token', password: token } : undefined,
        onProgress: (p) => setMessage('push: ' + p),
      });
      setMessage('Push complete: ' + (res.ok ? 'ok' : JSON.stringify(res)));
    } catch (e: any) {
      setMessage('Push failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pull() {
    setBusy(true);
    try {
      const token = await gh.getToken();
      await git.pull(projectDir, {
        auth: token ? { username: 'x-access-token', password: token } : undefined,
        author,
      });
      setMessage('Pulled.');
      await refresh();
      onRefresh();
    } catch (e: any) {
      setMessage('Pull failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createBranch() {
    const name = prompt('New branch name:');
    if (!name) return;
    await git.createBranch(projectDir, name, true);
    await refresh();
  }

  async function switchBranch(name: string) {
    await git.checkout(projectDir, name);
    await refresh();
    onRefresh();
  }

  async function signInGithub() {
    if (!token) return;
    await gh.setToken(token);
    const user = await gh.getCurrentUser();
    setGhUser(user);
    setToken('');
  }

  async function loadRepos() {
    try {
      setRepos(await gh.listRepos());
    } catch (e: any) {
      setMessage('GitHub error: ' + e.message);
    }
  }

  async function createRepoAndPush() {
    const name = prompt('Create GitHub repo named:');
    if (!name) return;
    setBusy(true);
    try {
      const repo = await gh.createRepo(name, { auto_init: false });
      await git.addRemote(projectDir, 'origin', repo.clone_url);
      const token = await gh.getToken();
      await git.push(projectDir, {
        auth: token ? { username: 'x-access-token', password: token } : undefined,
      });
      setMessage('Published to ' + repo.full_name);
    } catch (e: any) {
      setMessage('Publish failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel git-panel">
      <div className="panel-header">
        <div className="panel-title">Source Control</div>
      </div>

      <div className="git-section">
        <div className="git-section-title">Current project</div>
        <div className="muted">{projectDir}</div>
        <div className="muted">Branch: {current || '(none)'}</div>
        {commits.length === 0 && (
          <button disabled={busy} onClick={initRepo}>Init repo</button>
        )}
      </div>

      {branches.length > 0 && (
        <div className="git-section">
          <div className="git-section-title">Branches</div>
          <div className="branch-list">
            {branches.map((b) => (
              <button
                key={b}
                className={b === current ? 'branch-current' : ''}
                onClick={() => switchBranch(b)}
              >
                {b}
              </button>
            ))}
            <button onClick={createBranch}>+ new</button>
          </div>
        </div>
      )}

      <div className="git-section">
        <div className="git-section-title">Changes ({status.length})</div>
        <div className="status-list">
          {status.map((s) => (
            <div key={s.path} className="status-row">
              <span className={'status-label status-' + s.label}>{s.label}</span>
              <span className="status-path">{s.path}</span>
            </div>
          ))}
          {status.length === 0 && <div className="muted">Working tree clean.</div>}
        </div>
        <div className="row">
          <input
            placeholder="Commit message"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
          />
          <button disabled={busy || !commitMsg} onClick={commit}>Commit</button>
        </div>
        <div className="row">
          <button disabled={busy} onClick={stageAll}>Stage all</button>
          <button disabled={busy} onClick={push}>Push</button>
          <button disabled={busy} onClick={pull}>Pull</button>
        </div>
      </div>

      <div className="git-section">
        <div className="git-section-title">Clone from URL</div>
        <input
          placeholder="https://github.com/user/repo.git"
          value={cloneUrl}
          onChange={(e) => setCloneUrl(e.target.value)}
        />
        <input
          placeholder="Local folder name (optional)"
          value={cloneName}
          onChange={(e) => setCloneName(e.target.value)}
        />
        <button disabled={busy || !cloneUrl} onClick={handleClone}>Clone</button>
      </div>

      <div className="git-section">
        <div className="git-section-title">GitHub</div>
        {ghUser ? (
          <div className="row">
            <img src={ghUser.avatar_url} className="avatar" alt="" />
            <div>
              <div>{ghUser.login}</div>
              <div className="muted small">{ghUser.email || ''}</div>
            </div>
            <button onClick={() => gh.clearToken().then(() => setGhUser(undefined))}>
              Sign out
            </button>
          </div>
        ) : (
          <div className="row">
            <input
              type="password"
              placeholder="Personal Access Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button onClick={signInGithub}>Sign in</button>
          </div>
        )}
        <div className="row">
          <button onClick={loadRepos} disabled={!ghUser}>My repos</button>
          <button onClick={createRepoAndPush} disabled={!ghUser}>Publish to GitHub</button>
        </div>
        {repos.length > 0 && (
          <div className="repo-list">
            {repos.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setCloneUrl(r.clone_url);
                  setCloneName(r.name);
                }}
              >
                {r.full_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="git-section">
        <div className="git-section-title">Recent commits</div>
        <div className="commits">
          {commits.map((c) => (
            <div key={c.oid} className="commit-row">
              <code>{c.oid.slice(0, 7)}</code>
              <span>{c.message}</span>
              <span className="muted small">{c.author}</span>
            </div>
          ))}
        </div>
      </div>

      {message && <div className="panel-status">{message}</div>}
    </div>
  );
}
