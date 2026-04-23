// Project management: create, open, delete, and import projects.
// Also provides "Tasks" — a tiny per-project to-do list stored in kv.

import { useEffect, useState } from 'react';
import { kvGet, kvSet } from '../lib/kv';
import {
  ensureRoot,
  ROOT,
  join,
  mkdirp,
  readdir,
  remove,
  stat,
  writeText,
  exists,
} from '../lib/fs';

type Props = {
  projectDir: string;
  onOpen: (dir: string) => void;
};

type Task = { id: string; title: string; done: boolean };

export default function ProjectsPanel({ projectDir, onOpen }: Props) {
  const [projects, setProjects] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newProj, setNewProj] = useState('');
  const [newTask, setNewTask] = useState('');

  async function refresh() {
    await ensureRoot();
    const dirs = await readdir(ROOT);
    const withStat: string[] = [];
    for (const d of dirs) {
      try {
        const s = await stat(join(ROOT, d));
        if (s.type === 'dir') withStat.push(d);
      } catch {}
    }
    setProjects(withStat);
    const stored = await kvGet<Task[]>('tasks:' + projectDir);
    setTasks(stored || []);
  }

  useEffect(() => {
    refresh();
  }, [projectDir]);

  async function create() {
    if (!newProj) return;
    const dir = join(ROOT, newProj);
    if (await exists(dir)) {
      alert('Project already exists.');
      return;
    }
    await mkdirp(dir);
    await writeText(join(dir, 'README.md'), `# ${newProj}\n\nNew project.\n`);
    setNewProj('');
    await refresh();
    onOpen(dir);
  }

  async function remove_(name: string) {
    if (!confirm('Delete project ' + name + '?')) return;
    await remove(join(ROOT, name));
    await refresh();
  }

  async function addTask() {
    if (!newTask) return;
    const next: Task[] = [
      ...tasks,
      { id: String(Date.now()), title: newTask, done: false },
    ];
    setTasks(next);
    await kvSet('tasks:' + projectDir, next);
    setNewTask('');
  }

  async function toggleTask(id: string) {
    const next = tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
    setTasks(next);
    await kvSet('tasks:' + projectDir, next);
  }

  async function removeTask(id: string) {
    const next = tasks.filter((t) => t.id !== id);
    setTasks(next);
    await kvSet('tasks:' + projectDir, next);
  }

  return (
    <div className="panel projects-panel">
      <div className="panel-header">
        <div className="panel-title">Projects</div>
      </div>
      <div className="row">
        <input
          placeholder="New project name"
          value={newProj}
          onChange={(e) => setNewProj(e.target.value)}
        />
        <button onClick={create}>Create</button>
      </div>
      <div className="projects-list">
        {projects.map((p) => {
          const dir = join(ROOT, p);
          return (
            <div key={p} className={'project-row ' + (dir === projectDir ? 'active' : '')}>
              <button onClick={() => onOpen(dir)}>{p}</button>
              <button onClick={() => remove_(p)} className="icon-btn" title="Delete">✕</button>
            </div>
          );
        })}
        {projects.length === 0 && (
          <div className="muted">No projects. Create one above or clone a repo.</div>
        )}
      </div>

      <div className="panel-header">
        <div className="panel-title">Tasks</div>
      </div>
      <div className="row">
        <input
          placeholder="Add a task..."
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTask();
          }}
        />
        <button onClick={addTask}>+</button>
      </div>
      <div className="tasks">
        {tasks.map((t) => (
          <div key={t.id} className={'task-row ' + (t.done ? 'done' : '')}>
            <label>
              <input
                type="checkbox"
                checked={t.done}
                onChange={() => toggleTask(t.id)}
              />
              <span>{t.title}</span>
            </label>
            <button className="icon-btn" onClick={() => removeTask(t.id)}>
              ✕
            </button>
          </div>
        ))}
        {tasks.length === 0 && <div className="muted">No tasks yet.</div>}
      </div>
    </div>
  );
}
