# AI Agent 通用智能助手

一个基于 Next.js 15、React 18、TypeScript 和 `@openai/agents` 的通用 Agent Demo。项目原本是“多轮对话 + 天气/联网/附近工具”的轻量版本，现在补上了更接近主流 Agent 工程的三层结构：

- `Skills Registry`：把“回答策略”沉淀成可复用 skill，而不是把规则全塞进一个 prompt。
- `MCP Capability Registry`：把工具能力组织成 MCP 风格的能力目录，体现规划和路由意识。
- `Harness / Eval Trace`：每轮运行都带上 route、检查项和激活能力，方便展示工程深度。

## 现在项目里新增了什么

### 1. Skills

新增文件：

- `src/lib/ai/skills.ts`

职责：

- 维护 skill library
- 根据用户消息、模式、附件自动激活 skill
- 将 skill 转换为本轮 agent 的附加 instructions

当前内置的 skill：

- `skill.weather-brief`
- `skill.web-research`
- `skill.local-guide`
- `skill.attachment-reader`

### 2. MCP Registry

新增文件：

- `src/lib/ai/mcp.ts`

职责：

- 把能力按 MCP server 风格做成注册表
- 根据模式解析本轮可用能力
- 为 agent 注入 “当前接入了哪些能力” 的上下文

当前模拟的 MCP server：

- `mcp.maps`
- `mcp.browser`
- `mcp.workspace`

说明：

这里还是“项目内模拟 MCP registry”，不是真正启动外部 MCP 进程。但对面试项目来说，这一步已经比“直接写几个 tool 函数”更像现代 Agent Runtime。

### 3. Harness / Eval Trace

新增文件：

- `src/lib/ai/harness.ts`
- `src/lib/ai/stream-types.ts`

职责：

- 为每轮请求生成 `runId`
- 记录 route、激活 skill、激活 MCP server
- 给出本轮 answer 的 harness 检查项
- 通过流式事件把运行元数据推给前端

当前前端可见的运行元数据：

- 当前 mode
- 规划 route
- active skills
- active MCP servers
- harness checks

## 主链路结构

### Agent Runtime

核心文件：

- `src/lib/ai/agent.ts`

当前运行流程：

1. 解析用户输入、模式和附件
2. 选择 active skills
3. 选择 active MCP servers
4. 生成 harness trace
5. 拼装本轮 instructions
6. 执行 agent + tools
7. 将文本增量、工具调用、运行上下文流式推给前端

### 前端展示

核心文件：

- `src/app/page.tsx`

新增了两个可见层：

- 固定的 `Agent Engineering Stack` 面板
- 每条 assistant 消息顶部的 `Agent Runtime` 运行卡片

这两块的目标不是“更炫”，而是让人一眼看出你在做：

- 策略沉淀
- 能力路由
- 运行可观测性

## 为什么这样改，会让项目更有深度

如果项目只有：

- prompt
- model
- tool

那它更像一个“带 function calling 的聊天机器人”。

如果项目开始出现：

- skill registry
- capability registry / MCP 思维
- harness / eval trace
- route 可视化

它就更像一个“有运行时抽象、有可观测性、有可演进空间的 agent system”。

这对前端面试尤其有帮助，因为你不只是展示 UI，而是在展示：

- AI 产品工程化思维
- agent 架构理解
- 可扩展性设计
- 可观测性意识

## 如果你还想继续往上做，建议下一步按这个顺序

### P1：把“模拟 MCP”升级成真正 MCP

建议补：

- 独立 `mcpServers` 配置文件
- 真实的 filesystem / browser / docs MCP server
- tool schema 自动同步

### P2：把 Skills 做成可沉淀资产

建议补：

- `skills/` 目录
- 每个 skill 一个 markdown 或 json 文件
- skill 版本号、标签、触发条件
- skill 命中日志

### P3：把 Harness 做成真正可评测

建议补：

- `evals/` 数据集
- `golden cases`
- 自动跑分脚本
- 回答格式、是否调用工具、是否命中技能的评估指标

### P4：引入多 Agent

建议拆成：

- planner agent
- executor agent
- reporter agent

这样你的项目会从“单助手”进化成“可编排系统”。

## 本地检查

已通过：

```bash
node_modules/.bin/tsc --noEmit
```

说明：

之前尝试过 `next build`，但运行过程中被中断了，所以这次没有把完整构建结果写进 README。
