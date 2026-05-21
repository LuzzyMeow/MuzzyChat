# MuzzyChat

多智能体群聊协作平台 —— 一套可从零开始本地运行的 AI Agent 群聊系统。

> GitHub: [LuzzyMeow/MuzzyChat](https://github.com/LuzzyMeow/MuzzyChat)

## 项目概述

MuzzyChat 旨在构建一套**从底层架构到上层体验完全自主可控**、**能随时间自我进化**的多智能体群聊系统。它不是对现有产品的修改，而是从零生长出来的、拥有自我记忆和学习能力的全新平台。

### 核心场景

| 场景 | 说明 |
|:---|:---|
| 多 Agent 群聊 | 用户创建群组，多个 AI Agent 协作完成任务或自由讨论 |
| 单 Agent 对话 | 用户与单个 Agent 一对一私聊，Agent 拥有完整工具能力 |
| TRPG 模式（规划中） | 内置 TRPG 跑团模式，承接 NekoLand 全部功能 |

### 核心特性

- **双模式群聊**：Parallel 自由发言模式 + Supervisor 按需发言模式
- **ACE 长期记忆**：三层记忆模型（情景/语义/程序），策略卡片自进化
- **梦境自学习**：浅睡→REM→深睡三段式自我反思与优化
- **Skill 系统**：文件化管理 Agent 技能，支持热更新
- **ReAct Agent**：基于 LangGraph.js 的状态图驱动决策循环
- **TRPG 模式**：完整 COC 7 版规则引擎 + DM Agent + 角色卡/背包/地图

## 技术栈

| 层 | 技术 |
|:---|:---|
| 前端 | React 19 + Ant Design 5.x + @lobehub/ui + zustand + SWR |
| 后端 | NestJS + TypeScript 5.x |
| 数据库 | PostgreSQL 16 + pgvector |
| 缓存/队列 | Upstash Redis + BullMQ |
| Agent 运行时 | LangGraph.js |
| LLM 调用 | LangChain.js SDK 直连（@langchain/openai、@langchain/anthropic 等） |
| 测试 | Vitest + Playwright |
| 包管理 | pnpm workspace monorepo |

## 项目结构

```
MuzzyChat/
├── packages/
│   ├── backend/                # NestJS 后端
│   │   ├── prisma/
│   │   │   └── schema.prisma   # 数据库模型（19 models）
│   │   └── src/
│   │       ├── agent/          # Agent CRUD 模块
│   │       ├── agent-loop/     # ReAct 循环模块（LangGraph.js）
│   │       ├── chat-group/     # 群组管理与成员管理模块
│   │       ├── conversation/   # 会话 CRUD 模块
│   │       ├── llm/            # LLM 调用封装（LangChain.js）
│   │       ├── gateway/        # Socket.IO 网关
│   │       ├── prisma/         # Prisma 服务
│   │       ├── app.module.ts   # 根模块
│   │       └── main.ts         # 入口
│   └── frontend/               # React 前端
│       ├── src/
│       │   ├── pages/          # 页面组件
│       │   ├── stores/         # zustand 状态管理
│       │   ├── App.tsx         # 根组件
│       │   └── main.tsx        # 入口
│       └── e2e/                # Playwright E2E 测试
├── prisma.config.ts            # Prisma 配置
├── tsconfig.base.json          # 共享 TypeScript 配置
├── pnpm-workspace.yaml         # pnpm workspace 配置
└── package.json                # 根 monorepo 配置
```

## 环境要求

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0
- **PostgreSQL** 16+（需安装 pgvector 扩展）
- **Upstash Redis**（或兼容 Redis 7.x 的服务）

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.template .env
```

编辑 `.env` 填写以下关键配置：

```env
# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/muzzychat

# Upstash Redis
UPSTASH_REDIS_URL=redis://...
UPSTASH_REDIS_TOKEN=...

# LLM 模型（至少配置一个）
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### 3. 初始化数据库

```bash
pnpm db:migrate
pnpm db:generate
```

### 4. 启动开发服务

```bash
# 同时启动前后端
pnpm dev

# 或分别启动
pnpm dev:backend   # http://localhost:3000
pnpm dev:frontend  # http://localhost:5173
```

## 可用脚本

| 命令 | 说明 |
|:---|:---|
| `pnpm dev` | 启动前后端开发服务 |
| `pnpm build` | 构建前后端 |
| `pnpm lint` | 代码检查 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test` | 运行单元测试 |
| `pnpm test:e2e` | 运行 Playwright E2E 测试 |
| `pnpm db:migrate` | 执行数据库迁移 |
| `pnpm db:generate` | 生成 Prisma Client |
| `pnpm db:studio` | 打开 Prisma Studio 管理界面 |

## 开发路线图

| 阶段 | 内容 | 状态 |
|:---|:---|:---|
| Phase 1 | 基础设施：项目骨架、数据库、Agent 工坊 | 已完成 |
| Phase 2 | 核心对话：单 Agent 私聊 + 多 Agent 群聊 | 进行中（Agent CRUD + LLM Service + Conversation + ChatGroup + Agent ReAct Loop 已完成） |
| Phase 3 | 双模式引擎：Parallel + Supervisor 发言模式 | 待开始 |
| Phase 4 | 工具与安全：文件交互、命令行、审批卡 | 待开始 |
| Phase 5 | 记忆与学习：ACE 三层记忆 + 梦境系统 | 待开始 |
| Phase 6 | Skill 系统：文件化 Skill 管理 + 市场 | 待开始 |
| Phase 7 | TRPG 模式：完整跑团功能集成 | 技术设计 v1.2 已完成 |
| Phase 8 | 优化与发布：性能、监控、部署 | 待开始 |

## 许可证

MIT