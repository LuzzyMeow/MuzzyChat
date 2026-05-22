import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** 安全路径前缀：Agent 工作目录 */
const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT ?? './workspace';

function resolveSafePath(inputPath: string): string {
  const normalized = path.resolve(WORKSPACE_ROOT, inputPath);
  if (!normalized.startsWith(path.resolve(WORKSPACE_ROOT))) {
    throw new Error(`Path traversal denied: ${inputPath}`);
  }
  return normalized;
}

// ── Low-risk tools (no approval) ──────────────────────────────

export const readFileTool = tool(
  async ({ filePath }) => {
    const resolved = resolveSafePath(filePath);
    const content = await fs.readFile(resolved, 'utf-8');
    const truncated = content.length > 8000;
    const displayContent = content.slice(0, 8000);
    return `File: ${filePath}\n\`\`\`\n${displayContent}${truncated ? '\n[... truncated at 8000 chars]' : ''}\n\`\`\``;
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file within the workspace.',
    schema: z.object({
      filePath: z.string().describe('Relative path to the file'),
    }),
  },
);

export const listFilesTool = tool(
  async ({ dirPath }) => {
    const resolved = resolveSafePath(dirPath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    return entries
      .map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
      .join('\n');
  },
  {
    name: 'list_files',
    description: 'List files and directories in a workspace path.',
    schema: z.object({
      dirPath: z.string().default('.').describe('Relative directory path'),
    }),
  },
);

// ── High-risk tools (require approval) ────────────────────────

export const writeFileTool = tool(
  async ({ filePath, content }) => {
    const resolved = resolveSafePath(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
    return `File written: ${filePath} (${content.length} bytes)`;
  },
  {
    name: 'write_file',
    description: 'Write content to a file. REQUIRES USER APPROVAL before execution.',
    schema: z.object({
      filePath: z.string().describe('Relative path to the file'),
      content: z.string().describe('Content to write'),
    }),
  },
);

export const executeCommandTool = tool(
  async ({ command, workdir }) => {
    const cwd = workdir ? resolveSafePath(workdir) : process.cwd();
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return `stdout:\n${stdout.slice(0, 4000)}\n${stderr ? `stderr:\n${stderr.slice(0, 2000)}` : ''}`;
  },
  {
    name: 'execute_command',
    description: 'Execute a shell command. REQUIRES USER APPROVAL before execution.',
    schema: z.object({
      command: z.string().describe('The command to execute'),
      workdir: z.string().optional().describe('Working directory for the command'),
    }),
  },
);

export const codeExecuteTool = tool(
  async ({ code, language }) => {
    // Write code to a temp file, execute via appropriate runtime, return output
    const extMap: Record<string, string> = { python: '.py', javascript: '.js', typescript: '.ts', bash: '.sh' };
    const ext = extMap[language ?? 'javascript'] ?? '.js';
    const tmpFile = path.join(WORKSPACE_ROOT, 'code-exec', `temp_${Date.now()}${ext}`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, code, 'utf-8');
    const runner = language === 'python' ? 'python' : 'node';
    try {
      const { stdout, stderr } = await execAsync(`${runner} "${tmpFile}"`, {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      await fs.unlink(tmpFile).catch(() => {});
      return `stdout:\n${stdout.slice(0, 4000)}\n${stderr ? `stderr:\n${stderr.slice(0, 2000)}` : ''}`;
    } catch (error) {
      await fs.unlink(tmpFile).catch(() => {});
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return `Code execution error: ${msg}`;
    }
  },
  {
    name: 'code_execute',
    description: 'Execute a code snippet. REQUIRES USER APPROVAL before execution.',
    schema: z.object({
      code: z.string().describe('The code to execute'),
      language: z.enum(['python', 'javascript', 'typescript', 'bash']).default('javascript').describe('Programming language'),
    }),
  },
);

// ── Low-risk network tools (no approval) ──────────────────────

export const webSearchTool = tool(
  async ({ query }) => {
    return `[WebSearch placeholder] Query: "${query}"\nResult: Web search capability will be integrated in Phase 4 (工具与安全).`;
  },
  {
    name: 'web_search',
    description: 'Search the web for information.',
    schema: z.object({
      query: z.string().describe('Search query string'),
    }),
  },
);

export const webFetchTool = tool(
  async ({ url }) => {
    return `[WebFetch placeholder] URL: "${url}"\nResult: Web fetch capability will be integrated in Phase 4 (工具与安全).`;
  },
  {
    name: 'web_fetch',
    description: 'Fetch and extract content from a web page.',
    schema: z.object({
      url: z.string().describe('Full URL to fetch'),
    }),
  },
);

// ── Tool registry ─────────────────────────────────────────────

/** Tools that require user approval (HITL breakpoint).
 *  Per project spec §3.4: code_execute shares the same approval level as execute_command. */
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