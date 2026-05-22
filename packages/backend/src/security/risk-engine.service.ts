import { Injectable, Logger } from '@nestjs/common';

// ── Types (03-安全与工具设计 §1.1) ────────────────────────────

export interface RiskRule {
  id: string;
  type: 'path_read' | 'path_write' | 'command';
  pattern: string;
  os: 'linux' | 'mac' | 'windows' | 'all';
  riskLevel: RiskLevel;
  reason: string;
  isBuiltin: boolean;
}

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

export interface RiskMatchResult {
  requiresApproval: boolean;
  riskLevel?: RiskLevel;
  matchedRule?: string;
  reason?: string;
  indirectCall?: {
    isIndirect: boolean;
    depth: number;
    innerCommands: string[];
    matchedRules: string[];
  };
}

export interface IndirectCallResult {
  isIndirect: boolean;
  depth: number;
  innerCommands: string[];
  riskLevel: RiskLevel;
  matchedRules: string[];
}

// ── Builtin risk rules (03 §1.2–1.4) ──────────────────────────

const BUILTIN_PATH_READ_RULES: Omit<RiskRule, 'id' | 'isBuiltin'>[] = [
  { type: 'path_read', pattern: '/etc/passwd', os: 'linux', riskLevel: 'critical', reason: '系统用户凭据，含用户名、UID、Home 目录等敏感信息' },
  { type: 'path_read', pattern: '/etc/shadow', os: 'linux', riskLevel: 'critical', reason: '系统密码哈希，直接暴露将导致凭据破解' },
  { type: 'path_read', pattern: '/etc/ssh/sshd_config', os: 'linux', riskLevel: 'high', reason: 'SSH 服务端配置，暴露端口、认证方式等安全参数' },
  { type: 'path_read', pattern: 'C:\\Windows\\System32\\config\\SAM', os: 'windows', riskLevel: 'critical', reason: 'Windows 安全账户管理器数据库' },
  { type: 'path_read', pattern: '%APPDATA%\\Microsoft\\Credentials\\*', os: 'windows', riskLevel: 'critical', reason: 'Windows 凭据管理器存储的通用凭据' },
  { type: 'path_read', pattern: '~/.ssh/id_rsa', os: 'all', riskLevel: 'critical', reason: 'SSH 私钥，泄露等同于身份窃取' },
  { type: 'path_read', pattern: '~/.ssh/id_ed25519', os: 'all', riskLevel: 'critical', reason: 'Ed25519 SSH 私钥' },
  { type: 'path_read', pattern: '/etc/hosts', os: 'linux', riskLevel: 'medium', reason: '系统域名解析配置' },
];

const BUILTIN_PATH_WRITE_RULES: Omit<RiskRule, 'id' | 'isBuiltin'>[] = [
  { type: 'path_write', pattern: '~/.bashrc', os: 'linux', riskLevel: 'high', reason: 'Shell 启动脚本，写入可植入持久化后门' },
  { type: 'path_write', pattern: '~/.zshrc', os: 'linux', riskLevel: 'high', reason: 'Zsh 启动脚本' },
  { type: 'path_write', pattern: '~/.profile', os: 'linux', riskLevel: 'high', reason: '登录 Shell 初始化脚本' },
  { type: 'path_write', pattern: '~/.bash_profile', os: 'linux', riskLevel: 'high', reason: 'Bash 登录脚本' },
  { type: 'path_write', pattern: '~/.ssh/authorized_keys', os: 'all', riskLevel: 'critical', reason: 'SSH 公钥授权文件，写入可实现 SSH 持久化后门' },
  { type: 'path_write', pattern: '~/.ssh/config', os: 'all', riskLevel: 'critical', reason: 'SSH 客户端配置，可劫持 SSH 连接至恶意主机' },
  { type: 'path_write', pattern: '~/.gitconfig', os: 'all', riskLevel: 'medium', reason: 'Git 全局配置，可注入恶意凭据辅助或 Hook' },
  { type: 'path_write', pattern: 'C:\\Users\\{user}\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\*', os: 'windows', riskLevel: 'high', reason: 'Windows 启动目录' },
  { type: 'path_write', pattern: '/etc/crontab', os: 'linux', riskLevel: 'high', reason: '系统级定时任务' },
  { type: 'path_write', pattern: '~/.config/autostart/*', os: 'linux', riskLevel: 'high', reason: 'Linux 桌面自启动目录' },
  { type: 'path_write', pattern: '/etc/sudoers', os: 'linux', riskLevel: 'critical', reason: 'sudo 权限配置' },
  { type: 'path_write', pattern: '/etc/systemd/system/*', os: 'linux', riskLevel: 'high', reason: 'systemd 服务单元' },
];

const BUILTIN_COMMAND_RULES: Omit<RiskRule, 'id' | 'isBuiltin'>[] = [
  { type: 'command', pattern: 'rm -rf /', os: 'all', riskLevel: 'critical', reason: '递归删除根目录' },
  { type: 'command', pattern: 'rm -rf ~', os: 'all', riskLevel: 'critical', reason: '递归删除用户 Home 目录' },
  { type: 'command', pattern: 'rm -rf /*', os: 'all', riskLevel: 'critical', reason: '同 rm -rf / 的变体' },
  { type: 'command', pattern: 'shutdown', os: 'all', riskLevel: 'high', reason: '关闭系统' },
  { type: 'command', pattern: 'reboot', os: 'all', riskLevel: 'high', reason: '重启系统' },
  { type: 'command', pattern: 'halt', os: 'all', riskLevel: 'high', reason: '停止系统' },
  { type: 'command', pattern: 'poweroff', os: 'all', riskLevel: 'high', reason: '关闭电源' },
  { type: 'command', pattern: 'mkfs.', os: 'all', riskLevel: 'critical', reason: '格式化文件系统' },
  { type: 'command', pattern: 'dd if=', os: 'all', riskLevel: 'critical', reason: '直接写块设备' },
  { type: 'command', pattern: 'chmod 777 /', os: 'all', riskLevel: 'high', reason: '递归开放根目录权限' },
  { type: 'command', pattern: 'chown -R', os: 'all', riskLevel: 'high', reason: '递归修改文件所有权' },
  { type: 'command', pattern: 'curl ', os: 'all', riskLevel: 'high', reason: '远程代码执行（检测管道 + bash/sh/zsh 模式）' },
  { type: 'command', pattern: 'wget ', os: 'all', riskLevel: 'high', reason: '远程代码执行（检测管道 + bash/sh/zsh 模式）' },
  { type: 'command', pattern: 'crontab -r', os: 'all', riskLevel: 'medium', reason: '删除所有定时任务' },
  { type: 'command', pattern: 'systemctl disable', os: 'linux', riskLevel: 'medium', reason: '禁用服务（含防火墙）' },
  { type: 'command', pattern: 'systemctl stop', os: 'linux', riskLevel: 'medium', reason: '停止服务（含防火墙）' },
  { type: 'command', pattern: 'ufw disable', os: 'linux', riskLevel: 'medium', reason: '禁用 UFW 防火墙' },
  { type: 'command', pattern: 'iptables -F', os: 'linux', riskLevel: 'medium', reason: '清空所有防火墙规则' },
  { type: 'command', pattern: 'format C:', os: 'windows', riskLevel: 'critical', reason: 'Windows 格式化 C 盘' },
  { type: 'command', pattern: 'del /s /q', os: 'windows', riskLevel: 'critical', reason: '递归删除文件' },
  { type: 'command', pattern: ':(){ :|:& };:', os: 'all', riskLevel: 'critical', reason: 'Fork 炸弹，耗尽系统资源' },
];

function toFullRules(rules: Omit<RiskRule, 'id' | 'isBuiltin'>[]): RiskRule[] {
  return rules.map((r, i) => ({
    ...r,
    id: `builtin:${r.type}:${i}`,
    isBuiltin: true,
  }));
}

// ── Indirect call patterns (03 §1.5.1) ─────────────────────────

interface IndirectCallPattern {
  regex: RegExp;
  extract: (match: RegExpMatchArray) => string;
  languageCheck?: 'python' | 'javascript';
}

const MAX_RECURSION_DEPTH = 3;

const INDIRECT_PATTERNS: IndirectCallPattern[] = [
  {
    regex: /^(?:bash|sh|zsh)\s+-c\s+["'](.+?)["']\s*$/i,
    extract: (m) => m[1],
  },
  {
    regex: /^cmd\s+\/c\s+["'](.+?)["']\s*$/i,
    extract: (m) => m[1],
  },
  {
    regex: /^powershell\s+-Command\s+["'](.+?)["']\s*$/i,
    extract: (m) => m[1],
  },
  {
    regex: /^powershell\s+-EncodedCommand\s+(\S+)\s*$/i,
    extract: (m) => {
      try {
        return Buffer.from(m[1], 'base64').toString('utf-16le');
      } catch {
        return m[1];
      }
    },
  },
  {
    regex: /^python[3]?\s+-c\s+["'](.+?)["']\s*$/i,
    extract: (m) => m[1],
    languageCheck: 'python',
  },
  {
    regex: /^node\s+-e\s+["'](.+?)["']\s*$/i,
    extract: (m) => m[1],
    languageCheck: 'javascript',
  },
  {
    regex: /^eval\s+["'](.+?)["']\s*$/i,
    extract: (m) => m[1],
  },
];

// ── Service ────────────────────────────────────────────────────

@Injectable()
export class RiskEngineService {
  private readonly logger = new Logger(RiskEngineService.name);

  private readonly readPathRules: RiskRule[];
  private readonly writePathRules: RiskRule[];
  private readonly commandRules: RiskRule[];

  constructor() {
    this.readPathRules = toFullRules(BUILTIN_PATH_READ_RULES);
    this.writePathRules = toFullRules(BUILTIN_PATH_WRITE_RULES);
    this.commandRules = toFullRules(BUILTIN_COMMAND_RULES);
  }

  /**
   * Match a file path against read risk rules (03 §1.2).
   */
  matchReadPath(filePath: string): RiskRule | null {
    return this.matchPath(filePath, this.readPathRules);
  }

  /**
   * Match a file path against write risk rules (03 §1.3).
   */
  matchWritePath(filePath: string): RiskRule | null {
    return this.matchPath(filePath, this.writePathRules);
  }

  /**
   * Match a command against command risk rules (03 §1.4).
   */
  matchCommand(command: string): RiskRule | null {
    const normalized = command.trim();
    for (const rule of this.commandRules) {
      if (normalized.includes(rule.pattern)) {
        return rule;
      }
    }
    return null;
  }

  /**
   * Detect and analyze indirect calls in a command (03 §1.5).
   */
  detectIndirectCall(command: string, depth = 0): IndirectCallResult {
    if (depth > MAX_RECURSION_DEPTH) {
      return {
        isIndirect: true,
        depth,
        innerCommands: [command],
        riskLevel: 'high',
        matchedRules: ['RECURSION_DEPTH_EXCEEDED'],
      };
    }

    const trimmed = command.trim();

    // Check sudo/privileged shell patterns
    if (/^(sudo\s+(?:bash|sh|zsh)|env\s+.*\s+(?:bash|sh|zsh))\s*$/i.test(trimmed)) {
      return {
        isIndirect: true,
        depth: depth + 1,
        innerCommands: [trimmed],
        riskLevel: 'high',
        matchedRules: ['PRIVILEGED_SHELL'],
      };
    }

    for (const pattern of INDIRECT_PATTERNS) {
      const match = trimmed.match(pattern.regex);
      if (!match) continue;

      const innerCommand = pattern.extract(match);

      // Language-specific dangerous call check
      if (pattern.languageCheck) {
        const dangerousCalls = this.checkLanguageSpecificCalls(
          innerCommand,
          pattern.languageCheck,
        );
        if (dangerousCalls.length > 0) {
          return {
            isIndirect: true,
            depth: depth + 1,
            innerCommands: [innerCommand],
            riskLevel: 'high',
            matchedRules: dangerousCalls,
          };
        }
      }

      // Recursive check
      const recursiveResult = this.detectIndirectCall(innerCommand, depth + 1);
      if (recursiveResult.isIndirect || recursiveResult.matchedRules.length > 0) {
        return {
          isIndirect: true,
          depth: recursiveResult.depth,
          innerCommands: [innerCommand, ...recursiveResult.innerCommands],
          riskLevel: recursiveResult.riskLevel,
          matchedRules: recursiveResult.matchedRules,
        };
      }

      // Direct command match on inner command
      const directMatch = this.matchCommand(innerCommand);
      if (directMatch) {
        return {
          isIndirect: true,
          depth: depth + 1,
          innerCommands: [innerCommand],
          riskLevel: directMatch.riskLevel,
          matchedRules: [directMatch.id],
        };
      }
    }

    return {
      isIndirect: false,
      depth,
      innerCommands: [],
      riskLevel: 'low',
      matchedRules: [],
    };
  }

  /**
   * Check Python/JavaScript code for dangerous system calls (03 §1.5.1).
   */
  private checkLanguageSpecificCalls(
    code: string,
    language: 'python' | 'javascript',
  ): string[] {
    const rules: string[] = [];

    if (language === 'python') {
      const pythonDangerous = [
        { regex: /os\.system\s*\(/, name: 'PYTHON_OS_SYSTEM' },
        { regex: /subprocess\.(call|run|Popen|check_output|check_call)\s*\(/, name: 'PYTHON_SUBPROCESS' },
        { regex: /os\.exec[lpe]*\s*\(/, name: 'PYTHON_OS_EXEC' },
        { regex: /os\.popen\s*\(/, name: 'PYTHON_OS_POPEN' },
        { regex: /pty\.spawn\s*\(/, name: 'PYTHON_PTY_SPAWN' },
      ];
      for (const { regex, name } of pythonDangerous) {
        if (regex.test(code)) rules.push(name);
      }
    }

    if (language === 'javascript') {
      const jsDangerous = [
        { regex: /child_process\.(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/, name: 'JS_CHILD_PROCESS' },
        { regex: /require\s*\(\s*["']child_process["']\s*\)/, name: 'JS_REQUIRE_CHILD_PROCESS' },
      ];
      for (const { regex, name } of jsDangerous) {
        if (regex.test(code)) rules.push(name);
      }
    }

    return rules;
  }

  /**
   * Full risk assessment for a tool call (03 §6.2).
   */
  assessToolRisk(
    toolName: string,
    args: Record<string, unknown>,
  ): RiskMatchResult {
    switch (toolName) {
      case 'read_file':
        return this.assessReadFile(args.path as string ?? '');
      case 'write_file':
        return this.assessWriteFile(args.path as string ?? '');
      case 'execute_command':
        return this.assessExecuteCommand(args.command as string ?? '');
      case 'code_execute':
        return this.assessCodeExecute(
          args.code as string ?? '',
          args.language as string ?? 'javascript',
        );
      default:
        return { requiresApproval: false };
    }
  }

  private assessReadFile(filePath: string): RiskMatchResult {
    const rule = this.matchReadPath(filePath);
    if (rule) {
      return {
        requiresApproval: true,
        riskLevel: rule.riskLevel,
        matchedRule: rule.id,
        reason: `读取受保护路径：${rule.reason}`,
      };
    }
    return { requiresApproval: false };
  }

  private assessWriteFile(filePath: string): RiskMatchResult {
    const rule = this.matchWritePath(filePath);
    if (rule) {
      return {
        requiresApproval: true,
        riskLevel: rule.riskLevel,
        matchedRule: rule.id,
        reason: `写入受保护路径：${rule.reason}`,
      };
    }
    return { requiresApproval: false };
  }

  private assessExecuteCommand(command: string): RiskMatchResult {
    // Direct command match
    const directMatch = this.matchCommand(command);
    if (directMatch) {
      return {
        requiresApproval: true,
        riskLevel: directMatch.riskLevel,
        matchedRule: directMatch.id,
        reason: `高风险命令：${directMatch.reason}`,
      };
    }

    // Check for pipe-based remote execution patterns (curl ... | bash)
    if (/\|\s*(?:bash|sh|zsh)\b/i.test(command)) {
      const piped = command.split('|');
      for (const part of piped) {
        const cmdMatch = this.matchCommand(part.trim());
        if (cmdMatch) {
          return {
            requiresApproval: true,
            riskLevel: 'critical',
            matchedRule: 'PIPE_REMOTE_EXEC',
            reason: '管道远程代码执行检测',
          };
        }
      }
    }

    // Indirect call detection
    const indirectResult = this.detectIndirectCall(command);
    if (indirectResult.isIndirect) {
      return {
        requiresApproval: true,
        riskLevel: indirectResult.riskLevel,
        matchedRule: indirectResult.matchedRules.join(', '),
        reason: `间接调用检测：深度 ${indirectResult.depth}，内层命令：${indirectResult.innerCommands.join(' → ')}`,
        indirectCall: indirectResult,
      };
    }

    return { requiresApproval: false };
  }

  private assessCodeExecute(code: string, language: string): RiskMatchResult {
    // Language-specific dangerous calls
    const lang = language === 'python' ? 'python' :
      (language === 'javascript' || language === 'typescript') ? 'javascript' : null;

    if (lang) {
      const dangerousCalls = this.checkLanguageSpecificCalls(code, lang);
      if (dangerousCalls.length > 0) {
        return {
          requiresApproval: true,
          riskLevel: 'high',
          matchedRule: dangerousCalls.join(', '),
          reason: `代码中包含危险调用：${dangerousCalls.join(', ')}`,
        };
      }
    }

    // Bash code: check for high-risk commands
    if (language === 'bash') {
      const commandCheck = this.matchCommand(code);
      if (commandCheck) {
        return {
          requiresApproval: true,
          riskLevel: commandCheck.riskLevel,
          matchedRule: commandCheck.id,
          reason: `Bash 代码包含高风险命令：${commandCheck.reason}`,
        };
      }

      const indirectResult = this.detectIndirectCall(code);
      if (indirectResult.isIndirect) {
        return {
          requiresApproval: true,
          riskLevel: indirectResult.riskLevel,
          matchedRule: indirectResult.matchedRules.join(', '),
          reason: 'Bash 代码包含间接调用',
          indirectCall: indirectResult,
        };
      }
    }

    // Default: code_execute always requires approval (per §3.4)
    return {
      requiresApproval: true,
      riskLevel: 'medium',
      matchedRule: 'CODE_EXECUTE_DEFAULT',
      reason: '代码执行默认需审批（与 execute_command 等效风险）',
    };
  }

  // ── Path matching helper ─────────────────────────────────────

  private matchPath(filePath: string, rules: RiskRule[]): RiskRule | null {
    const normalized = filePath.replace(/\\/g, '/');
    for (const rule of rules) {
      const pattern = rule.pattern.replace(/\\/g, '/');
      if (pattern.includes('*')) {
        // Simple wildcard matching
        const regexStr = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\{user\}/g, '[^/]+');
        if (new RegExp(regexStr, 'i').test(normalized)) return rule;
      } else if (pattern.startsWith('~')) {
        // Home directory matching
        const homePattern = normalized.replace(
          /^\/home\/[^/]+|\/Users\/[^/]+/g,
          '~',
        );
        if (homePattern.startsWith(pattern)) return rule;
      } else if (normalized.includes(pattern) || normalized.endsWith(pattern)) {
        return rule;
      }
    }
    return null;
  }
}
