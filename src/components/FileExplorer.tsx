// File tree viewer + actions (new file, new folder, rename, delete,
// open local folder). Supports both the virtual FS and the real local
// filesystem via the server bridge.

import { useEffect, useMemo, useState } from 'react';
import {
  FsNode,
  walk,
  writeText,
  remove,
  rename,
  mkdirp,
  join,
  basename,
} from '../lib/fs';
import {
  LocalFsNode,
  localList,
  localWrite,
  localMkdir,
  localRename,
  localRemove,
} from '../lib/localfs';

type Props = {
  root: string;
  activePath?: string;
  onOpen: (path: string) => void;
  onChange: () => void;
  refreshKey: number;
  /** If set, browsing is backed by the real local FS via the server bridge */
  localRoot?: string | null;
  onLocalRootChange?: (path: string | null) => void;
};

type TreeNode = {
  name: string;
  path: string;
  type: 'file' | 'dir';
};

export default function FileExplorer({
  root,
  activePath,
  onOpen,
  onChange,
  refreshKey,
  localRoot,
  onLocalRootChange,
}: Props) {
  const [tree, setTree] = useState<FsNode | null>(null);
  const [localItems, setLocalItems] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root]));
  const [err, setErr] = useState<string | null>(null);

  const isLocal = !!localRoot;
  const effectiveRoot = localRoot || root;

  // ── Load virtual FS tree ──
  useEffect(() => {
    if (isLocal) return;
    let cancelled = false;
    walk(root)
      .then((t) => {
        if (!cancelled) {
          setTree(t);
          setExpanded((prev) => new Set([...prev, root]));
        }
      })
      .catch((e) => setErr(e.message));
    return () => { cancelled = true; };
  }, [root, refreshKey, isLocal]);

  // ── Load local FS listing ──
  useEffect(() => {
    if (!isLocal || !localRoot) return;
    let cancelled = false;
    localList(localRoot)
      .then((result) => {
        if (!cancelled) {
          setLocalItems(result.items);
          setExpanded((prev) => new Set([...prev, localRoot]));
        }
      })
      .catch((e) => setErr(e.message));
    return () => { cancelled = true; };
  }, [localRoot, refreshKey, isLocal]);

  // ── Load expanded local dirs ──
  const [localDirCache, setLocalDirCache] = useState<Record<string, TreeNode[]>>({});

  useEffect(() => {
    if (!isLocal) return;
    const dirsToLoad = [...expanded].filter(
      (p) => p !== effectiveRoot && !localDirCache[p],
    );
    if (dirsToLoad.length === 0) return;
    let cancelled = false;
    Promise.all(
      dirsToLoad.map((d) =>
        localList(d)
          .then((r) => ({ path: d, items: r.items }))
          .catch(() => ({ path: d, items: [] as TreeNode[] })),
      ),
    ).then((results) => {
      if (cancelled) return;
      setLocalDirCache((prev) => {
        const next = { ...prev };
        for (const r of results) next[r.path] = r.items;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [expanded, isLocal, effectiveRoot, localDirCache]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  // ── Build flat row list for rendering ──
  const rows = useMemo(() => {
    const out: Array<{ node: TreeNode; depth: number }> = [];

    if (isLocal) {
      function walkLocal(dirPath: string, depth: number) {
        const items =
          dirPath === effectiveRoot
            ? localItems
            : localDirCache[dirPath] || [];
        for (const item of items) {
          out.push({ node: item, depth });
          if (item.type === 'dir' && expanded.has(item.path)) {
            walkLocal(item.path, depth + 1);
          }
        }
      }
      walkLocal(effectiveRoot, 0);
    } else if (tree) {
      function walkNode(node: FsNode, depth: number) {
        out.push({ node, depth });
        if (node.type === 'dir' && expanded.has(node.path) && node.children) {
          for (const c of node.children) walkNode(c, depth + 1);
        }
      }
      walkNode(tree, 0);
    }

    return out;
  }, [tree, localItems, localDirCache, expanded, isLocal, effectiveRoot]);

  // ── Actions ──
  async function createFile() {
    const name = prompt('New file name:');
    if (!name) return;
    const fullPath = join(effectiveRoot, name);
    if (isLocal) {
      await localWrite(fullPath, '');
    } else {
      await writeText(fullPath, '');
    }
    onChange();
  }

  async function createFolder() {
    const name = prompt('New folder name:');
    if (!name) return;
    const fullPath = join(effectiveRoot, name);
    if (isLocal) {
      await localMkdir(fullPath);
    } else {
      await mkdirp(fullPath);
    }
    onChange();
  }

  async function handleRename(path: string) {
    const next = prompt('Rename to:', basename(path));
    if (!next || next === basename(path)) return;
    const parent = path.slice(0, path.lastIndexOf('/'));
    const dest = join(parent, next);
    if (isLocal) {
      await localRename(path, dest);
    } else {
      await rename(path, dest);
    }
    onChange();
  }

  async function handleDelete(path: string) {
    if (!confirm('Delete ' + path + '?')) return;
    if (isLocal) {
      await localRemove(path);
    } else {
      await remove(path);
    }
    onChange();
  }

  function handleOpenLocalFolder() {
    const p = prompt('Enter local folder path:', localRoot || '/Users/douglastalley');
    if (!p) return;
    if (onLocalRootChange) onLocalRootChange(p);
  }

  function handleBackToVirtual() {
    if (onLocalRootChange) onLocalRootChange(null);
  }

  return (
    <div className="panel file-explorer">
      <div className="panel-header">
        <div className="panel-title">
          {isLocal ? '📁 Local' : 'Files'}
        </div>
        <div className="panel-actions">
          <button className="icon-btn" title="New file" onClick={createFile}>
            ＋
          </button>
          <button className="icon-btn" title="New folder" onClick={createFolder}>
            📁
          </button>
          {isLocal ? (
            <button
              className="icon-btn"
              title="Back to virtual FS"
              onClick={handleBackToVirtual}
            >
              ←
            </button>
          ) : (
            <button
              className="icon-btn"
              title="Open local folder"
              onClick={handleOpenLocalFolder}
            >
              📂
            </button>
          )}
        </div>
      </div>

      {/* Local root path display */}
      {isLocal && (
        <div
          className="local-root-bar"
          onClick={handleOpenLocalFolder}
          title="Click to change folder"
        >
          <span className="local-root-path">{localRoot}</span>
        </div>
      )}

      {err && <div className="panel-error">{err}</div>}
      <div className="tree">
        {rows.map(({ node, depth }) => {
          const isActive = node.path === activePath;
          return (
            <div
              key={node.path}
              className={'tree-row ' + (isActive ? 'active' : '')}
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              <button
                className="tree-label"
                onClick={() => {
                  if (node.type === 'dir') toggle(node.path);
                  else onOpen(node.path);
                }}
              >
                <span className="tree-icon">
                  {node.type === 'dir'
                    ? expanded.has(node.path)
                      ? '▾'
                      : '▸'
                    : '·'}
                </span>
                <span className="tree-name">{node.name}</span>
              </button>
              <span className="tree-actions">
                <button
                  className="icon-btn"
                  title="Rename"
                  onClick={() => handleRename(node.path)}
                >
                  ✎
                </button>
                <button
                  className="icon-btn"
                  title="Delete"
                  onClick={() => handleDelete(node.path)}
                >
                  ✕
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
