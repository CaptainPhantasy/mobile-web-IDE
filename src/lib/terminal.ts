// A shell-like terminal that executes commands against the virtual
// file system inside the browser. Supports a useful set of POSIX-ish
// commands (ls, cd, cat, mkdir, rm, touch, echo, mv, cp, pwd, clear,
// tree, grep, wc, head, tail), plus IDE-specific ones (git, run,
// fmt, find, help).

import {
  readText,
  writeText,
  readdir,
  stat,
  remove,
  rename,
  mkdirp,
  join,
  exists,
  walkFiles,
  basename,
} from './fs';
import { findInFiles } from './search';
import * as git from './git';

export type TerminalContext = {
  cwd: string;
  projectDir: string;
  author: { name: string; email: string };
  onRun?: (path: string) => void;
};

export async function runCommand(
  line: string,
  ctx: TerminalContext,
): Promise<{ output: string; cwd: string }> {
  const trimmed = line.trim();
  if (!trimmed) return { output: '', cwd: ctx.cwd };
  const parts = tokenize(trimmed);
  const cmd = parts[0];
  const args = parts.slice(1);
  try {
    switch (cmd) {
      case 'help':
        return ok(HELP, ctx.cwd);
      case 'pwd':
        return ok(ctx.cwd, ctx.cwd);
      case 'clear':
        return { output: '\x1bCLEAR', cwd: ctx.cwd };
      case 'cd':
        return cd(args[0] || ctx.projectDir, ctx);
      case 'ls':
        return ls(args, ctx);
      case 'tree':
        return tree(args[0] || ctx.cwd, ctx);
      case 'cat':
        return cat(args, ctx);
      case 'mkdir':
        for (const p of args) await mkdirp(resolve(p, ctx));
        return ok('', ctx.cwd);
      case 'touch':
        for (const p of args) {
          const full = resolve(p, ctx);
          if (!(await exists(full))) await writeText(full, '');
        }
        return ok('', ctx.cwd);
      case 'rm':
        for (const p of args) await remove(resolve(p, ctx));
        return ok('', ctx.cwd);
      case 'mv':
        await rename(resolve(args[0], ctx), resolve(args[1], ctx));
        return ok('', ctx.cwd);
      case 'cp': {
        const src = resolve(args[0], ctx);
        const dst = resolve(args[1], ctx);
        await writeText(dst, await readText(src));
        return ok('', ctx.cwd);
      }
      case 'echo': {
        const txt = args.join(' ');
        const redir = txt.match(/^(.*?)\s+>\s+(\S+)$/);
        if (redir) {
          await writeText(resolve(redir[2], ctx), redir[1].replace(/^"|"$/g, '') + '\n');
          return ok('', ctx.cwd);
        }
        return ok(txt, ctx.cwd);
      }
      case 'find':
        return find(args, ctx);
      case 'grep':
        return grep(args, ctx);
      case 'wc':
        return wc(args, ctx);
      case 'head':
        return headTail('head', args, ctx);
      case 'tail':
        return headTail('tail', args, ctx);
      case 'run': {
        const target = args[0] || '';
        const full = target ? resolve(target, ctx) : '';
        ctx.onRun?.(full);
        return ok(`[run] queued ${full || '(active file)'}`, ctx.cwd);
      }
      case 'git':
        return await gitCmd(args, ctx);
      default:
        return ok(`${cmd}: command not found. Type "help".`, ctx.cwd);
    }
  } catch (err: any) {
    return ok(`error: ${err?.message || err}`, ctx.cwd);
  }
}

function ok(output: string, cwd: string) {
  return { output, cwd };
}

function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = '';
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ' ' || c === '\t') {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function resolve(p: string, ctx: TerminalContext): string {
  if (!p) return ctx.cwd;
  if (p.startsWith('/')) return p;
  if (p === '~') return ctx.projectDir;
  return join(ctx.cwd, p);
}

async function cd(target: string, ctx: TerminalContext) {
  const abs = resolve(target, ctx);
  const s = await stat(abs);
  if (s.type !== 'dir') throw new Error(`not a directory: ${abs}`);
  return ok('', abs);
}

async function ls(args: string[], ctx: TerminalContext) {
  const target = resolve(args[0] || '.', ctx);
  const entries = await readdir(target);
  entries.sort();
  const rows: string[] = [];
  for (const e of entries) {
    const s = await stat(join(target, e));
    rows.push(`${s.type === 'dir' ? 'd' : '-'} ${String(s.size).padStart(8)}  ${e}`);
  }
  return ok(rows.join('\n'), ctx.cwd);
}

async function tree(root: string, ctx: TerminalContext): Promise<{ output: string; cwd: string }> {
  const abs = resolve(root, ctx);
  const s = await stat(abs);
  const lines: string[] = [basename(abs) || '/'];
  async function walk(dir: string, prefix: string) {
    const entries = (await readdir(dir)).sort();
    for (let i = 0; i < entries.length; i++) {
      const last = i === entries.length - 1;
      lines.push(prefix + (last ? '└─ ' : '├─ ') + entries[i]);
      const full = join(dir, entries[i]);
      const st = await stat(full);
      if (st.type === 'dir') {
        await walk(full, prefix + (last ? '   ' : '│  '));
      }
    }
  }
  if (s.type === 'dir') await walk(abs, '');
  return ok(lines.join('\n'), ctx.cwd);
}

async function cat(args: string[], ctx: TerminalContext) {
  const chunks: string[] = [];
  for (const p of args) {
    chunks.push(await readText(resolve(p, ctx)));
  }
  return ok(chunks.join('\n'), ctx.cwd);
}

async function find(args: string[], ctx: TerminalContext) {
  const pattern = args[0] || '';
  const out: string[] = [];
  for await (const f of walkFiles(ctx.projectDir)) {
    if (!pattern || f.includes(pattern)) out.push(f);
  }
  return ok(out.join('\n'), ctx.cwd);
}

async function grep(args: string[], ctx: TerminalContext) {
  const query = args[0];
  if (!query) return ok('grep: missing pattern', ctx.cwd);
  const hits = await findInFiles(ctx.projectDir, query, { regex: true });
  return ok(
    hits.map((h) => `${h.path}:${h.line}:${h.col} ${h.text.trim()}`).join('\n'),
    ctx.cwd,
  );
}

async function wc(args: string[], ctx: TerminalContext) {
  const rows: string[] = [];
  for (const p of args) {
    const t = await readText(resolve(p, ctx));
    const lines = t.split('\n').length;
    const words = t.split(/\s+/).filter(Boolean).length;
    const bytes = new TextEncoder().encode(t).length;
    rows.push(`${lines} ${words} ${bytes} ${p}`);
  }
  return ok(rows.join('\n'), ctx.cwd);
}

async function headTail(mode: 'head' | 'tail', args: string[], ctx: TerminalContext) {
  let n = 10;
  let path = args[0];
  if (args[0] === '-n') {
    n = Number(args[1]);
    path = args[2];
  }
  const text = await readText(resolve(path, ctx));
  const lines = text.split('\n');
  const slice = mode === 'head' ? lines.slice(0, n) : lines.slice(-n);
  return ok(slice.join('\n'), ctx.cwd);
}

async function gitCmd(args: string[], ctx: TerminalContext) {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case 'status': {
      const entries = await git.statusList(ctx.projectDir);
      if (entries.length === 0) return ok('Working tree clean.', ctx.cwd);
      return ok(entries.map((e) => `${e.label.padEnd(10)} ${e.path}`).join('\n'), ctx.cwd);
    }
    case 'log': {
      const commits = await git.log(ctx.projectDir, { depth: 20 });
      return ok(
        commits
          .map(
            (c) =>
              `${c.oid.slice(0, 7)} ${c.commit.author.name} ${c.commit.message.split('\n')[0]}`,
          )
          .join('\n'),
        ctx.cwd,
      );
    }
    case 'branch': {
      if (rest[0]) {
        await git.createBranch(ctx.projectDir, rest[0], true);
        return ok(`Switched to new branch '${rest[0]}'.`, ctx.cwd);
      }
      const bs = await git.listBranches(ctx.projectDir);
      const cur = await git.currentBranch(ctx.projectDir);
      return ok(bs.map((b) => (b === cur ? `* ${b}` : `  ${b}`)).join('\n'), ctx.cwd);
    }
    case 'checkout':
      await git.checkout(ctx.projectDir, rest[0]);
      return ok(`Switched to '${rest[0]}'.`, ctx.cwd);
    case 'add':
      await git.stageAll(ctx.projectDir);
      return ok('Staged all changes.', ctx.cwd);
    case 'commit': {
      const mIdx = rest.indexOf('-m');
      const msg = mIdx >= 0 ? rest[mIdx + 1] : 'wip';
      const oid = await git.commit(ctx.projectDir, msg, ctx.author);
      return ok(`[${(await git.currentBranch(ctx.projectDir)) || 'HEAD'} ${oid.slice(0, 7)}] ${msg}`, ctx.cwd);
    }
    case 'diff': {
      const path = rest[0];
      if (!path) return ok('usage: git diff <file>', ctx.cwd);
      const hunks = await git.diffFile(ctx.projectDir, path);
      return ok(
        hunks.map((h) => h.kind + ' ' + h.text).join('\n'),
        ctx.cwd,
      );
    }
    default:
      return ok(`git: unknown subcommand "${sub}". Try: status log branch checkout add commit diff`, ctx.cwd);
  }
}

const HELP = `Web IDE shell — available commands:
  File system:  ls, cd, pwd, cat, mkdir, touch, rm, mv, cp, echo, tree
  Search:       find <substr>, grep <pattern>
  Analysis:     wc, head [-n N], tail [-n N]
  Run:          run [file]        -> executes file in debugger iframe
  Git:          git status|log|branch [name]|checkout <ref>|add|commit -m "msg"|diff <file>
  Misc:         help, clear`;
