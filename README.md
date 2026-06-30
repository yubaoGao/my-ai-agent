# AI Agent 通用智能助手

基于 **Next.js 15、React 18、TypeScript 和 `@openai/agents`** 开发的通用 AI Agent 示例项目。

项目支持多轮对话、天气查询、联网检索、附近地点查询和附件处理，并在基础 Agent 能力之上加入了：

* Skills Registry：可复用的回答策略管理
* MCP Capability Registry：工具能力注册与路由
* Harness / Eval Trace：运行链路追踪与检查
* 流式响应：实时展示模型文本、工具调用和运行状态
* Agent Runtime 可视化：展示当前路由、技能和能力调用情况

该项目不仅关注聊天界面，也尝试对 Agent 的策略、工具、路由和运行状态进行模块化管理。

---

## 功能特性

### 多轮对话

支持连续对话，并将历史消息传递给 Agent，使模型能够结合上下文回答问题。

### 多模式运行

根据用户选择的模式，为当前请求启用不同的工具和处理策略，例如：

* 普通对话
* 天气查询
* 联网检索
* 附近地点查询
* 附件分析

### 工具调用

Agent 可以根据用户问题决定是否调用工具，而不是完全依赖固定流程。

当前项目包含的工具能力主要有：

* 天气查询
* Web 检索
* 附近地点查询
* 附件内容读取

### 流式响应

后端以流式事件的方式向前端返回：

* 文本增量
* 工具调用状态
* Agent 运行上下文
* Harness 检查结果

前端可以在模型生成答案的过程中实时更新页面。

### Agent Runtime 可视化

每条 Assistant 消息上方都会展示本轮请求的运行信息，包括：

* 当前运行模式
* 规划路由
* 激活的 Skills
* 激活的 MCP Servers
* Harness Checks
* Run ID

这些信息用于观察 Agent 在本轮请求中采用了哪些策略和能力。

---

## 技术栈

| 技术                    | 用途                 |
| --------------------- | ------------------ |
| Next.js 15            | 前端页面、服务端接口与项目构建    |
| React 18              | 用户界面开发             |
| TypeScript            | 类型约束与工程维护          |
| `@openai/agents`      | Agent 创建、运行与工具调用   |
| Zod                   | Tool 参数校验与类型定义     |
| Tailwind CSS          | 页面样式               |
| Server-Sent Streaming | Agent 响应和运行事件的流式传输 |

---

## 系统架构

项目主要分为以下几个模块：

```text
User Input
    │
    ▼
Request Parser
    │
    ├── Skill Resolver
    ├── MCP Capability Resolver
    └── Harness Trace Builder
    │
    ▼
Agent Runtime
    │
    ├── Instructions
    ├── Model
    └── Tools
    │
    ▼
Streaming Events
    │
    ├── Text Delta
    ├── Tool Event
    ├── Runtime Context
    └── Harness Result
    │
    ▼
Frontend UI
```
## 核心模块

### Skills Registry

核心文件：

```text
src/lib/ai/skills.ts
```

Skills Registry 用于管理可以复用的回答策略。

相比将所有规则写入同一个系统 Prompt，Skill 可以根据当前问题动态激活，使不同能力之间保持相对独立。

当前内置 Skills：

| Skill                     | 作用             |
| ------------------------- | -------------- |
| `skill.weather-brief`     | 生成简洁、结构化的天气回答  |
| `skill.web-research`      | 对联网检索结果进行整理和总结 |
| `skill.local-guide`       | 处理附近地点和本地生活问题  |
| `skill.attachment-reader` | 处理包含附件的用户请求    |

主要职责：

* 维护 Skill 列表
* 定义 Skill 的触发条件
* 根据消息、模式和附件激活 Skill
* 将 Skill 转换为本轮 Agent Instructions

---

### MCP Capability Registry

核心文件：

```text
src/lib/ai/mcp.ts
```

该模块使用类似 MCP Server Registry 的方式管理工具能力。

当前注册的能力：

| MCP Server      | 作用              |
| --------------- | --------------- |
| `mcp.maps`      | 地图和附近地点相关能力     |
| `mcp.browser`   | Web 检索和网页信息获取能力 |
| `mcp.workspace` | 附件和工作区内容读取能力    |

主要职责：

* 维护能力注册表
* 根据当前模式选择可用能力
* 向 Agent 注入能力描述
* 为前端提供本轮能力激活信息

> 当前实现属于项目内部的 MCP 风格能力注册表，并未启动独立的外部 MCP Server 进程。

这种设计主要用于将工具定义、能力描述和路由逻辑从 Agent 主流程中拆分出来，为后续接入真实 MCP 服务预留扩展空间。

---

### Harness / Eval Trace

核心文件：

```text
src/lib/ai/harness.ts
src/lib/ai/stream-types.ts
```

Harness 用于记录和检查每轮 Agent 请求的运行过程。

当前记录的信息包括：

* Run ID
* 当前 Mode
* 规划 Route
* Active Skills
* Active MCP Servers
* Harness Checks

Harness Checks 可以用于检查：

* 是否选择了正确的处理路由
* 是否激活了预期 Skill
* 是否启用了需要的工具能力
* 回答是否经过完整运行流程

当前 Harness 主要用于运行可观测性，还不是完整的自动化评测系统。

---

### Agent Runtime

核心文件：

```text
src/lib/ai/agent.ts
```

该模块负责组织 Agent 的完整运行流程，包括：

* 解析用户输入
* 解析运行模式
* 处理附件
* 选择 Skills
* 选择 MCP 能力
* 创建 Harness Trace
* 拼装 Instructions
* 执行 Agent
* 调用 Tools
* 输出流式事件

Agent Runtime 是 Skills、MCP Registry、Harness 和具体工具之间的协调层。

---

### 前端页面

核心文件：

```text
src/app/page.tsx
```

前端负责：

* 输入和发送消息
* 展示多轮对话
* 切换 Agent 运行模式
* 显示流式生成内容
* 展示工具调用状态
* 展示 Agent Runtime 信息

页面中包含两个主要的工程信息展示区域：

#### Agent Engineering Stack

展示当前项目已经实现的 Agent 工程模块，例如：

* Skills
* MCP Registry
* Harness
* Streaming
* Tool Calling

#### Agent Runtime Card

展示每轮请求实际激活的：

* Mode
* Route
* Skills
* MCP Servers
* Harness Checks

---

## 项目目录

以下仅展示与 Agent 运行相关的主要文件：

```text
src/
├── app/
│   ├── page.tsx
│   └── api/
│       └── ...
│
└── lib/
    └── ai/
        ├── agent.ts
        ├── skills.ts
        ├── mcp.ts
        ├── harness.ts
        ├── stream-types.ts
        └── ...
```

各模块职责：

```text
agent.ts         Agent 主运行流程
skills.ts        Skill 注册、匹配和指令生成
mcp.ts           MCP 风格能力注册与解析
harness.ts       运行追踪和检查项生成
stream-types.ts  前后端流式事件类型定义
```

---

## 本地运行

### 1. 克隆项目

```bash
git clone <your-repository-url>
cd <your-project-directory>
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

在项目根目录创建本地环境变量文件：

```bash
.env.local
```

按照项目代码中实际使用的环境变量名称，配置 OpenAI API Key 以及天气、地图或搜索服务所需的密钥。

不要将真实密钥提交到 GitHub。

建议在仓库中提供一个不包含真实密钥的示例文件：

```text
.env.example
```

### 4. 启动开发环境

```bash
npm run dev
```

启动后访问：

```text
http://localhost:3000
```

---

## 常用命令

```bash
# 启动开发环境
npm run dev

# TypeScript 类型检查
npx tsc --noEmit

# 构建生产版本
npm run build

# 启动生产版本
npm run start

# 代码检查
npm run lint
```

---

## 类型检查

项目已执行：

```bash
node_modules/.bin/tsc --noEmit
```

当前 TypeScript 类型检查可以通过。

生产构建仍建议在部署前重新执行：

```bash
npm run build
```

确保服务端环境变量、第三方接口和生产环境配置均正常。

---

## 设计思路

一个基础的 Tool Calling 应用通常只包含：

```text
Prompt + Model + Tools
```

随着工具数量和使用场景增加，容易出现以下问题：

* 系统 Prompt 持续膨胀
* 不同回答规则相互影响
* 所有工具在每轮请求中同时暴露
* 难以判断 Agent 为什么选择某个工具
* 出现错误时难以定位运行环节
* 缺少可复现的评测记录

因此，本项目增加了三个中间层：

```text
Skills
    负责管理回答策略

MCP Capability Registry
    负责管理和选择工具能力

Harness
    负责记录和检查运行过程
```

这些模块并不会直接提高模型本身的能力，但能够改善项目的：

* 可维护性
* 可扩展性
* 可观察性
* 调试效率
* 评测能力

---
## 后续规划

### 真实 MCP 接入

* 增加独立 MCP Server 配置
* 接入 filesystem、browser 或 docs MCP Server
* 自动读取 Tool Schema
* 支持 MCP 服务连接状态检查
* 支持工具发现和动态注册

### Skills 资产化

* 将 Skills 拆分到独立目录
* 支持 Markdown 或 JSON 格式
* 增加版本号和标签
* 增加优先级与冲突处理
* 记录 Skill 命中日志

示例结构：

```text
skills/
├── weather-brief.md
├── web-research.md
├── local-guide.md
└── attachment-reader.md
```

### 自动化评测

* 建立 `evals/` 测试集
* 增加 Golden Cases
* 自动执行测试用例
* 检查工具调用是否正确
* 检查 Skill 是否命中
* 检查回答格式和关键内容
* 对不同版本结果进行对比

### 多 Agent 编排

计划尝试拆分为：

```text
Planner Agent
    负责理解任务并制定执行步骤

Executor Agent
    负责调用工具和完成具体任务

Reporter Agent
    负责整理结果并生成最终回答
```

### 上下文与知识库

* 对话摘要压缩
* 最近消息与历史摘要组合
* RAG 知识库检索
* BM25 与向量检索混合召回
* ReRank 结果重排
* 用户长期记忆管理

---

## 安全说明

请勿在代码或 Git 提交记录中公开：

* OpenAI API Key
* 地图服务 Key
* 搜索服务 Key
* 数据库连接地址
* Access Token
* 用户隐私数据

---

