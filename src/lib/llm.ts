// Multi-provider LLM client with agentic tool-use loop.
//
// Supports:
//   - OpenAI-compatible providers (OpenAI, Mistral, DeepSeek, Groq, Together, OpenRouter, Ollama)
//   - Anthropic (Claude)
//   - Custom / OpenAPI-compatible endpoints (OpenCode GO, ZEN, etc.)
//
// The client runs an agentic loop:
//   1. Send messages + tools to the LLM via the server SSE proxy
//   2. If the LLM responds with tool_calls, execute them locally against the virtual FS
//   3. Feed tool results back to the LLM
//   4. Repeat until the LLM produces a text-only response
//
// API keys are stored in the browser's KV store (IndexedDB), same as GitHub PATs.

import { kvGet, kvSet } from './kv';
import { readText, writeText, readdir, mkdirp, remove, rename, stat, walk, join, exists, dirname } from './fs';
import { findInFiles } from './search';

// ─── Types ───────────────────────────────────────────────────────────────

export type ProviderType = 'openai' | 'anthropic' | 'custom';

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Max tokens for the model response */
  maxTokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface StreamEvent {
  type: 'token' | 'tool_call' | 'done' | 'error';
  text?: string;
  tool_call?: ToolCall;
  error?: string;
}

export type StreamCallback = (event: StreamEvent) => void;

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ─── Built-in Providers ──────────────────────────────────────────────────

export const BUILTIN_PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o',
    maxTokens: 4096,
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    type: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKey: '',
    model: 'mistral-large-latest',
    maxTokens: 4096,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    maxTokens: 4096,
  },
  {
    id: 'groq',
    name: 'Groq',
    type: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: '',
    model: 'llama-3.3-70b-versatile',
    maxTokens: 4096,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'openai/gpt-4o',
    maxTokens: 4096,
  },
  {
    id: 'together',
    name: 'Together AI',
    type: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    apiKey: '',
    model: 'meta-llama/Llama-3-70b-chat-hf',
    maxTokens: 4096,
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    type: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    model: 'llama3',
    maxTokens: 4096,
  },
  {
    id: 'opencode',
    name: 'OpenCode GO',
    type: 'custom',
    baseUrl: '',
    apiKey: '',
    model: '',
    maxTokens: 4096,
  },
  {
    id: 'zen',
    name: 'ZEN API',
    type: 'custom',
    baseUrl: '',
    apiKey: '',
    model: '',
    maxTokens: 4096,
  },
];

// ─── Tool Definitions ────────────────────────────────────────────────────

export const IDE_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file in the project. Returns the file text.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from project root (e.g. "src/index.ts")' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates the file and any parent directories if they don\'t exist. Overwrites existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from project root' },
          content: { type: 'string', description: 'The file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and directories at a given path. Returns names with type indicators.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative directory path (default: project root)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for text patterns across all project files. Supports regex.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (substring or regex)' },
          regex: { type: 'boolean', description: 'Treat query as regex (default: false)' },
          caseSensitive: { type: 'boolean', description: 'Case-sensitive search (default: false)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Create a directory and all parent directories.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative directory path to create' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_path',
      description: 'Delete a file or directory (recursively).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to delete' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_path',
      description: 'Rename or move a file/directory.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Source relative path' },
          to: { type: 'string', description: 'Destination relative path' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_file_info',
      description: 'Get metadata about a file or directory (size, type, modification time).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path' },
        },
        required: ['path'],
      },
    },
  },
];

// ─── Tool Execution ──────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  content: string;
}

function resolvePath(projectDir: string, relPath: string): string {
  const clean = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  return join(projectDir, clean);
}

export async function executeTool(
  projectDir: string,
  name: string,
  argsJson: string,
): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return { success: false, content: `Invalid JSON arguments: ${argsJson}` };
  }

  try {
    switch (name) {
      case 'read_file': {
        const fullPath = resolvePath(projectDir, String(args.path || ''));
        if (!(await exists(fullPath))) {
          return { success: false, content: `File not found: ${args.path}` };
        }
        const content = await readText(fullPath);
        return { success: true, content };
      }

      case 'write_file': {
        const fullPath = resolvePath(projectDir, String(args.path || ''));
        await writeText(fullPath, String(args.content ?? ''));
        return { success: true, content: `Wrote ${String(args.content).length} bytes to ${args.path}` };
      }

      case 'list_directory': {
        const relDir = String(args.path || '');
        const fullPath = resolvePath(projectDir, relDir);
        if (!(await exists(fullPath))) {
          return { success: false, content: `Directory not found: ${relDir || '/'}` };
        }
        const entries = await readdir(fullPath);
        const details: string[] = [];
        for (const name of entries.sort()) {
          try {
            const st = await stat(join(fullPath, name));
            details.push(`${st.type === 'dir' ? '📁' : '📄'} ${name}${st.type === 'dir' ? '/' : ''} (${st.size} bytes)`);
          } catch {
            details.push(`❓ ${name}`);
          }
        }
        return {
          success: true,
          content: details.length > 0 ? details.join('\n') : '(empty directory)',
        };
      }

      case 'search_files': {
        const query = String(args.query || '');
        if (!query) return { success: false, content: 'Empty query' };
        const hits = await findInFiles(projectDir, query, {
          regex: Boolean(args.regex),
          caseSensitive: Boolean(args.caseSensitive),
          maxHits: 50,
        });
        if (hits.length === 0) {
          return { success: true, content: 'No matches found.' };
        }
        const lines = hits.map(
          (h) => `${h.path}:${h.line}:${h.col}: ${h.text.trim()}`,
        );
        return { success: true, content: lines.join('\n') };
      }

      case 'create_directory': {
        const fullPath = resolvePath(projectDir, String(args.path || ''));
        await mkdirp(fullPath);
        return { success: true, content: `Created directory: ${args.path}` };
      }

      case 'delete_path': {
        const fullPath = resolvePath(projectDir, String(args.path || ''));
        if (!(await exists(fullPath))) {
          return { success: false, content: `Path not found: ${args.path}` };
        }
        await remove(fullPath);
        return { success: true, content: `Deleted: ${args.path}` };
      }

      case 'rename_path': {
        const fromPath = resolvePath(projectDir, String(args.from || ''));
        const toPath = resolvePath(projectDir, String(args.to || ''));
        if (!(await exists(fromPath))) {
          return { success: false, content: `Source not found: ${args.from}` };
        }
        await rename(fromPath, toPath);
        return { success: true, content: `Renamed ${args.from} → ${args.to}` };
      }

      case 'get_file_info': {
        const fullPath = resolvePath(projectDir, String(args.path || ''));
        if (!(await exists(fullPath))) {
          return { success: false, content: `Path not found: ${args.path}` };
        }
        const st = await stat(fullPath);
        return {
          success: true,
          content: `Type: ${st.type}\nSize: ${st.size} bytes\nModified: ${new Date(st.mtimeMs).toISOString()}`,
        };
      }

      default:
        return { success: false, content: `Unknown tool: ${name}` };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, content: `Error: ${msg}` };
  }
}

// ─── Provider Config Persistence ─────────────────────────────────────────

const KV_KEY = 'llm.providers';
const KV_ACTIVE = 'llm.activeProvider';

export async function loadProviders(): Promise<Provider[]> {
  const saved = await kvGet<Provider[]>(KV_KEY);
  if (!saved) return [...BUILTIN_PROVIDERS];
  // Merge in any new built-in providers that weren't saved before.
  const ids = new Set(saved.map((p) => p.id));
  const merged = [...saved];
  for (const bp of BUILTIN_PROVIDERS) {
    if (!ids.has(bp.id)) merged.push({ ...bp });
  }
  return merged;
}

export async function saveProviders(providers: Provider[]): Promise<void> {
  await kvSet(KV_KEY, providers);
}

export async function getActiveProviderId(): Promise<string> {
  return (await kvGet<string>(KV_ACTIVE)) || 'openai';
}

export async function setActiveProviderId(id: string): Promise<void> {
  await kvSet(KV_ACTIVE, id);
}

// ─── Conversations Persistence ───────────────────────────────────────────

const KV_CONVERSATIONS = 'llm.conversations';

export async function loadConversations(): Promise<Conversation[]> {
  return (await kvGet<Conversation[]>(KV_CONVERSATIONS)) || [];
}

export async function saveConversations(convs: Conversation[]): Promise<void> {
  await kvSet(KV_CONVERSATIONS, convs);
}

// ─── System Prompt ───────────────────────────────────────────────────────

function buildSystemPrompt(projectDir: string, openFiles: string[]): string {
  const projName = projectDir.split('/').pop() || 'project';
  return `You are an AI coding assistant embedded in the Mobile Web IDE. You help the user write, refactor, debug, and understand code.

## Context
- Project: ${projName}
- Project root: ${projectDir}
- Open files: ${openFiles.length > 0 ? openFiles.join(', ') : 'none'}

## Tools
You have access to the following tools to read and modify the user's codebase:
- **read_file**: Read a file's contents (provide relative path)
- **write_file**: Create or overwrite a file (provide relative path + content)
- **list_directory**: List contents of a directory
- **search_files**: Search for text across all project files (supports regex)
- **create_directory**: Create a directory
- **delete_path**: Delete a file or directory
- **rename_path**: Rename/move a file or directory
- **get_file_info**: Get file/directory metadata

## Guidelines
1. Always read a file before modifying it so you understand the current state.
2. When writing files, write the COMPLETE file content — never partial or truncated.
3. Use relative paths from the project root (e.g., "src/index.ts", not absolute paths).
4. When the user asks you to create something, read relevant existing files first to match the project's style and conventions.
5. Explain what you're doing before making changes.
6. If you're unsure about something, ask the user for clarification.
7. Be concise but thorough. Show code, don't just describe it.`;
}

// ─── SSE Streaming via Server Proxy ──────────────────────────────────────

interface ProxyRequest {
  provider: Provider;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  debug?: boolean;
}

/**
 * Stream a chat completion from the server-side LLM proxy.
 * The server normalizes different provider APIs into a consistent SSE format.
 * Yields StreamEvent objects as they arrive.
 */
export async function* streamChat(
  provider: Provider,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  debug = false,
): AsyncGenerator<StreamEvent> {
  const body: ProxyRequest = { provider, messages, tools, debug };

  let response: Response;
  try {
    response = await fetch('/api/llm/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (fetchErr: unknown) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    yield { type: 'error', error: `Network error: Cannot reach server at /api/llm/stream — ${msg}. Is the dev server running?` };
    return;
  }

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch {}
    yield { type: 'error', error: `Server returned HTTP ${response.status}: ${detail.slice(0, 500)}` };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: 'error', error: 'No response body — server closed the stream without data.' };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }
          try {
            const event: StreamEvent = JSON.parse(data);
            yield event;
          } catch {
            // Skip malformed lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Test Provider Connection ────────────────────────────────────────────

export interface TestResult {
  ok: boolean;
  error?: string;
  model?: string;
  responseTime?: number;
  snippet?: string;
  httpStatus?: number;
  url?: string;
}

/**
 * Test connectivity to an LLM provider by sending a minimal completion request
 * through the server proxy. Returns structured result with timing and error detail.
 */
export async function testProvider(provider: Provider): Promise<TestResult> {
  if (!provider.apiKey) {
    return { ok: false, error: 'API key not configured' };
  }
  if (!provider.baseUrl) {
    return { ok: false, error: 'Base URL not configured' };
  }
  if (!provider.model) {
    return { ok: false, error: 'Model not configured' };
  }

  try {
    const response = await fetch('/api/llm/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    });

    if (!response.ok) {
      let detail = '';
      try { detail = await response.text(); } catch {}
      return { ok: false, error: `Server returned HTTP ${response.status}: ${detail.slice(0, 300)}` };
    }

    return await response.json();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot reach server — ${msg}. Is the dev server running?` };
  }
}

// ─── Agentic Loop ────────────────────────────────────────────────────────

export interface AgenticCallbacks {
  onToken: (text: string) => void;
  onToolCall: (call: ToolCall) => void;
  onToolResult: (callId: string, result: ToolResult) => void;
  onError: (error: string) => void;
  onComplete: (messages: ChatMessage[]) => void;
}

/**
 * Run the full agentic loop:
 * 1. Send messages to the LLM
 * 2. If tool_calls arrive, execute them
 * 3. Feed results back, repeat
 * 4. Up to MAX_ITERATIONS rounds
 */
export async function runAgenticLoop(
  provider: Provider,
  projectDir: string,
  messages: ChatMessage[],
  openFiles: string[],
  callbacks: AgenticCallbacks,
  debug = false,
): Promise<ChatMessage[]> {
  const MAX_ITERATIONS = 20;
  const allMessages = [...messages];

  // Inject or update system prompt
  const systemPrompt = buildSystemPrompt(projectDir, openFiles);
  if (allMessages.length > 0 && allMessages[0].role === 'system') {
    allMessages[0] = { ...allMessages[0], content: systemPrompt };
  } else {
    allMessages.unshift({ role: 'system', content: systemPrompt });
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let assistantContent = '';
    const toolCalls: ToolCall[] = [];

    for await (const event of streamChat(provider, allMessages, IDE_TOOLS, debug)) {
      if (event.type === 'token' && event.text) {
        assistantContent += event.text;
        callbacks.onToken(event.text);
      } else if (event.type === 'tool_call' && event.tool_call) {
        toolCalls.push(event.tool_call);
        callbacks.onToolCall(event.tool_call);
      } else if (event.type === 'error') {
        callbacks.onError(event.error || 'Unknown error');
        return allMessages;
      }
    }

    // Build assistant message
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: assistantContent,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
    allMessages.push(assistantMsg);

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      callbacks.onComplete(allMessages);
      return allMessages;
    }

    // Execute tool calls and feed results back
    for (const tc of toolCalls) {
      const result = await executeTool(
        projectDir,
        tc.function.name,
        tc.function.arguments,
      );
      callbacks.onToolResult(tc.id, result);

      allMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  callbacks.onError('Max iterations reached. The assistant may be stuck in a loop.');
  return allMessages;
}
