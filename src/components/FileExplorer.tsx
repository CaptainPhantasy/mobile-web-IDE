// File tree viewer + actions (new file, new folder, rename, delete,
// import, download-as-zip). Works against lib/fs virtual FS.

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

type Props = {
  root: string;
  activePath?: string;
  onOpen: (path: string) => void;
  onChange: () => void;
  refreshKey: number;
};

export default function FileExplorer({
  root,
  activePath,
  onOpen,
  onChange,
  refreshKey,
}: Props) {
  const [tree, setTree] = useState<FsNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([root]),
  );
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    walk(root)
      .then((t) => {
        if (!cancelled) {
          setTree(t);
          setExpanded((prev) => new Set([...prev, root]));
        }
      })
      .catch((e) => setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, [root, refreshKey]);

  async function createFile() {
    const name = prompt('New file name (relative to current root):');
    if (!name) return;
    await writeText(join(root, name), '');
    onChange();
  }
  async function createFolder() {
    const name = prompt('New folder name:');
    if (!name) return;
    await mkdirp(join(root, name));
    onChange();
  }

  async function handleRename(path: string) {
    const next = prompt('Rename to:', basename(path));
    if (!next || next === basename(path)) return;
    const parent = path.slice(0, path.lastIndexOf('/'));
    await rename(path, join(parent, next));
    onChange();
  }

  async function handleDelete(path: string) {
    if (!confirm('Delete ' + path + '?')) return;
    await remove(path);
    onChange();
  }

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const rows = useMemo(() => {
    if (!tree) return [] as Array<{ node: FsNode; depth: number }>;
    const out: Array<{ node: FsNode; depth: number }> = [];
    function walkNode(node: FsNode, depth: number) {
      out.push({ node, depth });
      if (node.type === 'dir' && expanded.has(node.path) && node.children) {
        for (const c of node.children) walkNode(c, depth + 1);
      }
    }
    walkNode(tree, 0);
    return out;
  }, [tree, expanded]);

  return (
    <div className="panel file-explorer">
      <div className="panel-header">
        <div className="panel-title">Files</div>
        <div className="panel-actions">
          <button className="icon-btn" title="New file" onClick={createFile}>＋</button>
          <button className="icon-btn" title="New folder" onClick={createFolder}>📁</button>
        </div>
      </div>
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
