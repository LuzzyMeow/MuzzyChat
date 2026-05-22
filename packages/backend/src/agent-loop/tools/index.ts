import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Constants (per 03-安全与工具设计 §5.3) ──────────────────

/** Agent workspace root */
const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT ?? './workspace';

/** stdout/stderr truncation (03 §5.3) */
const STDOUT_LIMIT = 10 * 1024;  // 10 KB
const STDERR_LIMIT = 10 * 1024;  // 10 KB

/** Default execution timeout (03 §5.3) */
const DEFAULT_CODE_TIMEOUT = 30_000; // 30s
const DEFAULT_COMMAND_TIMEOUT = 30_000; // 30s

/** Create an AbortSignal that times out after ms (cross-runtime compatible) */
function makeTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error('Timeout')), ms);
  return controller.signal;
}

// ── Path security ─────────────────────────────────────────────

function resolveSafePath(inputPath: string): string {
  const normalized = path.resolve(WORKSPACE_ROOT, inputPath);
  if (!normalized.startsWith(path.resolve(WORKSPACE_ROOT))) {
    throw new Error(`Path traversal denied: ${inputPath}`);
  }
  return normalized;
}

// ── read_file (03 §5.2.1) ─────────────────────────────────────

export const readFileTool = tool(
  async ({ path: filePath, encoding, offset, limit }) => {
    const resolved = resolveSafePath(filePath);
    const enc = (encoding ?? 'utf-8') as BufferEncoding;
    let content = await fs.readFile(resolved, enc);

    // Apply offset/limit for line-based files (text only)
    if (enc === 'utf-8' || enc === 'ascii') {
      const lines = content.split('\n');
      const start = (offset ?? 1) - 1;
      const end = limit ? start + limit : lines.length;
      content = lines.slice(start, end).join('\n');
    }

    const truncated = content.length > 8000;
    const displayContent = content.slice(0, 8000);
    return `File: ${filePath}\n\`\`\`\n${displayContent}${truncated ? '\n[... truncated at 8000 chars]' : ''}\n\`\`\``;
  },
  {
    name: 'read_file',
    description: '读取指定文件的内容',
    schema: z.object({
      path: z.string().describe('要读取的文件路径'),
      encoding: z.enum(['utf-8', 'ascii', 'base64', 'hex']).optional().describe('文件编码，默认 utf-8'),
      offset: z.number().optional().describe('起始行号（从 1 开始），默认 1'),
      limit: z.number().optional().describe('最大读取行数，默认 2000'),
    }),
  },
);

// ── list_files (03 §5.2.3) ────────────────────────────────────

export const listFilesTool = tool(
  async ({ path: dirPath, recursive, pattern }) => {
    const resolved = resolveSafePath(dirPath ?? '.');
    const entries: string[] = [];

    async function walk(dir: string, depth: number) {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(resolved, fullPath);
        if (item.isDirectory()) {
          entries.push(`[DIR] ${relativePath}/`);
          if (recursive && depth < 10) {
            await walk(fullPath, depth + 1);
          }
        } else {
          entries.push(`[FILE] ${relativePath}`);
        }
      }
    }

    await walk(resolved, 0);

    // Apply glob pattern filter
    if (pattern) {
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      );
      return entries.filter((e) => regex.test(e.replace(/^.. /u, ''))).join('\n');
    }

    return entries.join('\n');
  },
  {
    name: 'list_files',
    description: '列出指定目录下的文件和子目录',
    schema: z.object({
      path: z.string().default('.').describe('要列出的目录路径'),
      recursive: z.boolean().optional().describe('是否递归列出子目录，默认 false'),
      pattern: z.string().optional().describe('文件名匹配模式（glob），如 *.ts'),
    }),
  },
);

// ── write_file (03 §5.2.2) ────────────────────────────────────

export const writeFileTool = tool(
  async ({ path: filePath, content, append, createDirs }) => {
    const resolved = resolveSafePath(filePath);
    if (createDirs) {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
    }
    if (append) {
      await fs.appendFile(resolved, content, 'utf-8');
    } else {
      await fs.writeFile(resolved, content, 'utf-8');
    }
    return `File ${append ? 'appended' : 'written'}: ${filePath} (${content.length} bytes)`;
  },
  {
    name: 'write_file',
    description: '创建或修改文件。需要用户审批才能执行。',
    schema: z.object({
      path: z.string().describe('要写入的文件路径'),
      content: z.string().describe('要写入的文件内容'),
      append: z.boolean().optional().describe('是否追加模式，默认 false（覆盖）'),
      createDirs: z.boolean().optional().describe('是否自动创建父目录，默认 false'),
    }),
  },
);

// ── execute_command (03 §5.2.4) ────────────────────────────────

export const executeCommandTool = tool(
  async ({ command, cwd, timeout, env }) => {
    const workDir = cwd ? resolveSafePath(cwd) : process.cwd();
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout: timeout ?? DEFAULT_COMMAND_TIMEOUT,
      maxBuffer: 1024 * 1024, // 1 MB buffer
      env: env ? { ...process.env, ...(env as Record<string, string>) } : process.env,
    });
    return `stdout:\n${stdout.slice(0, STDOUT_LIMIT)}${stdout.length > STDOUT_LIMIT ? '\n[truncated]' : ''}\n${stderr ? `stderr:\n${stderr.slice(0, STDERR_LIMIT)}${stderr.length > STDERR_LIMIT ? '\n[truncated]' : ''}` : ''}`;
  },
  {
    name: 'execute_command',
    description: '在宿主机上执行 Shell 命令。需要用户审批才能执行。',
    schema: z.object({
      command: z.string().describe('要执行的命令'),
      cwd: z.string().optional().describe('工作目录，默认为 Agent 工作目录'),
      timeout: z.number().optional().describe('超时时间（毫秒），默认 30000'),
      env: z.record(z.string(), z.string()).optional().describe('环境变量'),
    }),
  },
);

// ── code_execute (03 §5.2.7 + §5.3) ───────────────────────────

function getLanguageCommand(language: string): string {
  const commands: Record<string, string> = {
    python: 'python3',
    javascript: 'node',
    typescript: 'npx ts-node',
    bash: 'bash',
  };
  return commands[language] ?? 'bash';
}

function getLanguageArgs(language: string, code: string): string[] {
  switch (language) {
    case 'python': return ['-c', code];
    case 'javascript': return ['-e', code];
    case 'typescript': return ['-e', code];
    case 'bash': return ['-c', code];
    default: return ['-c', code];
  }
}

/** Minimum env for code execution (03 §5.3) */
function getCodeEnv(agentId: string): Record<string, string> {
  return {
    HOME: path.resolve(WORKSPACE_ROOT, agentId),
    PATH: process.env.PATH ?? '',
    LANG: 'en_US.UTF-8',
    TZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export const codeExecuteTool = tool(
  async ({ code, language, timeout, agentId }) => {
    const startTime = Date.now();
    const agentWorkspace = path.resolve(WORKSPACE_ROOT, agentId ?? 'default');

    // Network access check (03 §5.3: keyword-based lightweight protection)
    const networkKeywords = ['fetch(', 'http.', 'https.', 'requests.', 'axios.', 'urllib', 'socket.', 'WebSocket', 'XMLHttpRequest'];
    if (networkKeywords.some((kw) => code.includes(kw))) {
      return `Code execution rejected: network access is disabled. Detected network-related keyword in code.`;
    }

    // Ensure workspace exists
    await fs.mkdir(agentWorkspace, { recursive: true });

    const langCmd = getLanguageCommand(language);
    const args = getLanguageArgs(language, code);
    const env = getCodeEnv(agentId ?? 'default');

    try {
      const { stdout, stderr } = await execAsync(`${langCmd} ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, {
        cwd: agentWorkspace,
        env,
        timeout: timeout ?? DEFAULT_CODE_TIMEOUT,
        maxBuffer: 1024 * 1024,
      });

      const execTime = Date.now() - startTime;
      return [
        `Language: ${language}`,
        `Exit code: 0`,
        `Time: ${execTime}ms`,
        stdout ? `stdout:\n${stdout.slice(0, STDOUT_LIMIT)}${stdout.length > STDOUT_LIMIT ? '\n[truncated]' : ''}` : '',
        stderr ? `stderr:\n${stderr.slice(0, STDERR_LIMIT)}${stderr.length > STDERR_LIMIT ? '\n[truncated]' : ''}` : '',
      ].filter(Boolean).join('\n');
    } catch (error) {
      const execTime = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : 'Unknown error';
      // Extract stdout/stderr from exec error if available
      const execError = error as { stdout?: string; stderr?: string };
      return [
        `Language: ${language}`,
        `Time: ${execTime}ms`,
        `Error: ${msg.slice(0, STDERR_LIMIT)}`,
        execError.stdout ? `stdout:\n${execError.stdout.slice(0, STDOUT_LIMIT)}` : '',
        execError.stderr ? `stderr:\n${execError.stderr.slice(0, STDERR_LIMIT)}` : '',
      ].filter(Boolean).join('\n');
    }
  },
  {
    name: 'code_execute',
    description: '在宿主机受约束环境中执行代码块（工作目录隔离、超时控制、网络禁止）。需要用户审批才能执行。',
    schema: z.object({
      code: z.string().describe('要执行的代码'),
      language: z.enum(['python', 'javascript', 'typescript', 'bash']).describe('编程语言'),
      timeout: z.number().optional().describe('超时时间（毫秒），默认 30000'),
      agentId: z.string().optional().describe('Agent ID（用于工作目录隔离）'),
    }),
  },
);

// ── web_search (03 §5.2.5) — Real DuckDuckGo implementation ───

export const webSearchTool = tool(
  async ({ query, maxResults }) => {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'MuzzyChat/1.0' },
        signal: makeTimeoutSignal(10_000),
      });

      if (!response.ok) {
        // Fallback: use DuckDuckGo HTML search
        const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const htmlResp = await fetch(htmlUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MuzzyChat/1.0)' },
          signal: makeTimeoutSignal(10_000),
        });
        const html = await htmlResp.text();

        // Simple extraction of result snippets from HTML
        const snippets: string[] = [];
        const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;

        let match;
        while ((match = linkRegex.exec(html)) && snippets.length < (maxResults ?? 5)) {
          snippets.push(`${snippets.length + 1}. ${match[2].trim()} - ${match[1]}`);
        }

        if (snippets.length === 0) {
          return `Web search for "${query}": No results found.`;
        }

        return `Web search results for "${query}":\n${snippets.join('\n')}`;
      }

      const data = await response.json() as {
        AbstractText?: string;
        AbstractURL?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
        Results?: Array<{ Text?: string; FirstURL?: string }>;
      };

      const results: string[] = [];

      // Abstract (direct answer)
      if (data.AbstractText) {
        results.push(`📌 ${data.AbstractText}${data.AbstractURL ? `\n   Source: ${data.AbstractURL}` : ''}`);
      }

      // Related topics
      const topics = data.RelatedTopics ?? [];
      const limit = maxResults ?? 5;
      for (let i = 0; i < Math.min(topics.length, limit); i++) {
        const topic = topics[i];
        if (topic?.Text) {
          results.push(`${i + 1}. ${topic.Text}${topic.FirstURL ? `\n   ${topic.FirstURL}` : ''}`);
        }
      }

      if (results.length === 0) {
        results.push('No results found.');
      }

      return `Web search results for "${query}":\n${results.join('\n')}`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return `Web search failed for "${query}": ${msg}. Please try a different query.`;
    }
  },
  {
    name: 'web_search',
    description: '联网搜索信息',
    schema: z.object({
      query: z.string().describe('搜索关键词'),
      maxResults: z.number().optional().describe('最大返回结果数，默认 5'),
    }),
  },
);

// ── web_fetch (03 §5.2.6) — Real fetch implementation ─────────

export const webFetchTool = tool(
  async ({ url, format }) => {
    try {
      // Validate URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return `Web fetch error: Invalid URL "${url}". Please provide a valid HTTP/HTTPS URL.`;
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return `Web fetch error: Only HTTP/HTTPS URLs are supported. Got: ${parsedUrl.protocol}`;
      }

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MuzzyChat/1.0)',
          'Accept': 'text/html,application/xhtml+xml,text/plain',
        },
        signal: makeTimeoutSignal(15_000),
      });

      if (!response.ok) {
        return `Web fetch error: HTTP ${response.status} ${response.statusText} for "${url}"`;
      }

      const contentType = response.headers.get('content-type') ?? '';
      const text = await response.text();

      const outputFormat = format ?? 'markdown';

      if (outputFormat === 'html') {
        return `URL: ${url}\nContent-Type: ${contentType}\n\n${text.slice(0, 20_000)}${text.length > 20_000 ? '\n\n[truncated at 20KB]' : ''}`;
      }

      if (outputFormat === 'text') {
        // Strip HTML tags for plain text
        const plainText = text
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ')
          .trim();
        return `URL: ${url}\n\n${plainText.slice(0, 10_000)}${plainText.length > 10_000 ? '\n\n[truncated at 10KB]' : ''}`;
      }

      // markdown format: return raw HTML content with basic metadata
      // For proper HTML→Markdown conversion, we'd need a library like turndown
      // This provides useful content that the LLM can parse
      const stripped = text
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      return `URL: ${url}\nContent-Type: ${contentType}\n\n${stripped.slice(0, 15_000)}${stripped.length > 15_000 ? '\n\n[truncated at 15KB]' : ''}`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('abort') || msg.includes('timeout')) {
        return `Web fetch timed out for "${url}". The server did not respond within 15 seconds.`;
      }
      return `Web fetch error for "${url}": ${msg}`;
    }
  },
  {
    name: 'web_fetch',
    description: '抓取指定 URL 的网页内容',
    schema: z.object({
      url: z.string().describe('要抓取的 URL'),
      format: z.enum(['markdown', 'text', 'html']).optional().describe('输出格式，默认 markdown'),
    }),
  },
);

// ── Tool registry ─────────────────────────────────────────────

/**
 * Tools that require user approval (HITL breakpoint).
 * Per project spec §3.4: code_execute shares the same approval level as execute_command.
 */
export const HIGH_RISK_TOOLS = new Set(['write_file', 'execute_command', 'code_execute']);

/** All available tools. */
export const ALL_TOOLS = [
  readFileTool,
  listFilesTool,
  writeFileTool,
  executeCommandTool,
  codeExecuteTool,
  webSearchTool,
  webFetchTool,
] as const;

/** Name → tool map for O(1) lookup during tool execution. */
export const TOOL_MAP: Map<string, StructuredToolInterface> = new Map(
  ALL_TOOLS.map((t) => [t.name, t]),
);

/** Filter tools by agent's configured tool names. */
export function filterTools(enabledToolNames: string[]) {
  const nameSet = new Set(enabledToolNames);
  return ALL_TOOLS.filter((t) => nameSet.has(t.name));
}

/**
 * Tool parameter name mapping for approval/whitelist access.
 * Maps tool name → the parameter name that holds the primary target.
 */
export const TOOL_TARGET_PARAM: Record<string, string> = {
  read_file: 'path',
  write_file: 'path',
  execute_command: 'command',
  code_execute: 'code',
  web_search: 'query',
  web_fetch: 'url',
  list_files: 'path',
};
