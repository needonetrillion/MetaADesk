# Meta 分析初筛系统

本地单用户的 Meta 分析辅助系统，覆盖「协议制定 → 检索策略 → 题摘初筛 → 全文上传 → 全文判断与数据提取 → 结果展示」的固定流程，每个阶段由 AI 辅助人来判断与提取。

## 为什么做这个项目

在部分领域中，Meta 分析的数据提取与分析流程其实相当混乱，很多初学者也常常遗漏步骤，让整个流程在缺乏合适记录的情况下反复拉扯。我自己不喜欢这种不清晰、不明确的行动，也不太能接受重复地进行同一种标准判断；更难受的是，我常常会怀疑自己的标准是否合理、之前判断过的文献是否存在问题。

在我看来，Meta 分析这一整套流程有很大的标准化、自动化空间，但不少领域至今仍在人工管理文献与条目。

其实标准化的平台与流程规范并不少——比如 [Covidence](https://www.covidence.org/)、[Rayyan](https://www.rayyan.ai/) 等平台，[PRISMA 2020](https://www.prisma-statement.org/)、[Cochrane Handbook](https://training.cochrane.org/handbook) 等标准——但它们在起步时大多被打上了「医学领域」的标签，让人难以理解和套用；要么传播范围较小，要么设置了相应的门槛。

我最初了解这个领域时，正值 AI 蓬勃发展的 2024 年。当时的 AI 大多还是聊天式的来回对话，但小尺度模型的结构化输出能力已初步成型。我当时就想：这个能力完全可以应用到 Meta 分析中来。自己做了一些简单测试，效果确实不错；只是自驱力不高、又俗事缠身，构建整个系统的想法迟迟没有落地。

今年，Claw、各类 Agent、Harness 等产品相继问世，个人落地项目的能力大幅增强；同时自己也愈发想「做成一些事」，于是重新启动了这个项目。

目前项目还只是完成了初步的框架搭建。核心理念是：在 Agent 系统的指导与辅助下，帮助研究人员科学、严谨、合理地实现全流程的数据提取工作。当前打包版本暂缺「数据提取」部分功能（这部分在源代码中已有初步方法与实现步骤），后续我会慢慢完善。

给自己定一个小目标：**每个月的第一个星期，抽出时间进行项目的修复与维护**。也非常欢迎有想法、有能力的同学一起参与实现。

## 技术栈

- **Monorepo**：pnpm workspace + TypeScript
- **后端**：Fastify + better-sqlite3 + Drizzle ORM（`apps/server`）
- **前端**：React + Vite + Ant Design（`apps/web`）
- **LLM**：多 Provider 抽象（`packages/llm`），支持 OpenAI 兼容协议（DeepSeek/OpenAI/通义千问/Ollama）与 Anthropic；请求带超时（默认 120s，可在设置里按 Provider 调整）与指数退避重试
- **PDF 转 Markdown**：MinerU 在线服务（`packages/mineru`，封装官方 `mineru-open-sdk`）
- **题录解析**：RIS / PubMed(MEDLINE) / BibTeX + 全局唯一去重组（`packages/importer`）

## 目录结构

```
apps/
  server/        # Fastify API + SQLite + 各阶段业务逻辑
  web/           # React 前端
packages/
  core/          # 领域模型 + 文献状态机 + PRISMA 排除理由
  llm/           # 多 Provider 抽象 + 结构化输出(zod)
  mineru/        # MinerU 在线 API 客户端
  importer/      # 题录解析 + 去重
data/            # SQLite 库、上传的 PDF、生成的 Markdown（运行时生成）
```

## 快速开始

### 1. 前置要求

- **Node.js ≥ 20**（推荐 22），检查：`node -v`
- **pnpm ≥ 9**：没有则 `npm install -g pnpm`，或 `corepack enable && corepack prepare pnpm@10 --activate`

### 2. 安装依赖

```bash
pnpm install
```

> `better-sqlite3` 是原生模块：安装时会先用 prebuild-install 下载预编译二进制；若你的 Node/平台没有匹配的预编译包，会自动回退到本机编译（macOS 需 Xcode 命令行工具 `xcode-select --install`，Windows 需 VS Build Tools）。pnpm 10 默认拦截原生构建脚本，本仓库已在 `package.json` 的 `pnpm.onlyBuiltDependencies` 中放行了 `better-sqlite3` 与 `esbuild`，无需手动 approve。

### 3. 启动（开发模式，推荐日常用）

```bash
pnpm dev
```

会同时启动两个进程：

| 服务 | 地址 | 说明 |
|---|---|---|
| 后端 API | http://127.0.0.1:8787 | Fastify + SQLite，数据落在 `data/` |
| 前端界面 | http://localhost:5173 | React + Vite，`/api` 已代理到后端 |

**打开 http://localhost:5173 使用。**

也可分别启动：

```bash
pnpm dev:server   # 仅后端（watch 热重载）
pnpm dev:web      # 仅前端（HMR）
```

### 4. 验证是否正常

```bash
curl http://127.0.0.1:8787/api/health
# 期望返回：{"ok":true,"time":"..."}
```

### 5. 生产模式（单进程，无需前端 dev server）

```bash
pnpm build                               # 构建前端 + 全仓类型检查
pnpm --filter @meta/server start         # 后端同时托管前端静态资源
```

打开 **http://127.0.0.1:8787**。

## 使用前配置

进入「设置」页：

1. **大模型 Provider**：点击 DeepSeek / OpenAI / 通义千问 / Ollama 预设按钮快速添加，填入 API Key 与模型名，点「测试」验证连接，点「设为默认」指定默认模型。
2. **MinerU**：在 https://mineru.net/apiManage/token 免费获取 Token，粘贴保存。

## 六阶段流程与状态机

| 阶段 | 系统功能 | 文献状态 |
|---|---|---|
| 1 协议 | PICO + 纳入/排除标准，可导出注册文本 | — |
| 2 检索 | 数据库管理 + AI 生成检索式并按库翻译语法 | — |
| 3 初筛 | 导入题录 → 去重 → AI 辅助判定 + 人工拍板 | `imported → screening_tas → tas_included/tas_excluded` |
| 4 全文 | 上传 PDF → MinerU 转 Markdown | `fulltext_pending → fulltext_uploaded` |
| 5 全文+提取 | AI 提取文本/表格；图表只提示位置，人工用工具提取 | `fulltext_uploaded → ft_included/ft_excluded → extracted` |
| 6 展示 | PRISMA 流程/排除理由汇总 + 结构化数据表 + 导出 | — |

状态迁移由 `packages/core/src/status.ts` 的状态机统一约束，服务端一切状态变更都经
`apps/server/src/services/transitions.ts` 收口：

- `TRANSITIONS` 是允许的推进方向：同阶段内与相邻阶段间的推进允许（判定可一步完成），跨阶段跳跃（如 `imported → extracted`）直接报错。
- `REGRESSIONS` 是显式声明的主动回退：撤回排除（`tas_excluded → screening_tas`）、改判、重新上传全文（`fulltext_uploaded/ft_included/extracted → fulltext_pending`）。
- 回退时自动清理失效的派生数据：回到待全文会删掉全文判定，回到提取之前会删掉旧的提取结果。
- 重复条目（`is_duplicate = 1`）不进入初筛列表、计数与 AI 批量建议，单独统计为「去重剔除」。

排除理由编码与中文标签见 `packages/core/src/reasons.ts`，按阶段汇总后展示在「⑥ 结果」页的 PRISMA 区域，并可单独导出。

## 开发进度

- [x] **Phase 0**：脚手架 + 数据模型 + LLM Provider 抽象 + MinerU 封装 + 题录解析/去重 + 设置页 + 项目列表
- [x] **Phase 1**：协议制定（PICO 表单 + AI 生成草案 + 导出注册文本）+ 检索式生成（数据库种子 + AI 按库语法生成 + 手工编辑）
- [x] **Phase 2**：题录导入（RIS/PubMed/BibTeX + 拖拽上传）+ 去重 + 初筛工作台（单篇/批量 AI 建议 + 人工判定 + 排除理由）
- [x] **Phase 3**：全文 PDF 上传（绑定初筛纳入条目）+ MinerU 在线转 Markdown（异步轮询）+ 全文筛选工作台（查看全文 + AI 建议 + 人工判定）
- [x] **Phase 4**：数据提取（AI 提取研究信息/结局数据 + 图表定位提示人工用工具提取并回填）+ 结果展示（动态字段表 + CSV 导出）+ 项目删除
- [x] **Phase 5（健壮性与方法学补强）**：
  - 状态机从「死代码」变为真正的唯一写入口（`services/transitions.ts`），修掉「接受全部 AI 判定把已提取文献打回初筛」「重复上传 PDF 让流程倒退」两类 bug
  - 重复条目不再进入初筛列表、计数与 AI 批量建议，符合 PRISMA「去重后筛选」口径
  - 删除项目级联补齐 `import_batches` / `extraction_templates` / `agent_conversations`，导入/删除/提取改为单事务
  - 去重组 id 全局唯一化，消除跨批次撞号
  - LLM 请求加超时 + 指数退避重试；批量建议分块容错，单块失败不丢进度
  - 全文转换前端轮询上限与 MinerU timeout（900s）对齐，服务重启自动把僵死任务置为可重试；新增批量状态接口
  - 初筛列表服务端筛选 + 分页 + 关键词搜索，避免几千条题录时首屏 payload 过大
  - 新增 PRISMA 流程与排除理由汇总（结果页展示 + 单独导出）
  - 提取字段表改 key 时自动迁移历史提取数据，不再丢列
  - 新增状态机/去重/服务层/路由测试，`pnpm typecheck` 同时检查测试代码

## 六阶段完整闭环

| 阶段 | 入口标签页 | 产出 |
|---|---|---|
| 1 协议 | ① 协议制定 | PICO + 纳入/排除 + 结局指标，可导出注册文本 |
| 2 检索 | ② 检索策略 | 各数据库检索式（AI 按库语法生成） |
| 3 初筛 | ③ 初筛 | 题录导入去重 + AI 辅助判定 + 人工拍板 |
| 4 全文 | ④ 全文 | PDF 上传 → MinerU 转 Markdown + 全文筛选 |
| 5 提取 | ⑤ 提取 | AI 提取文本/表格数据 + 图表定位人工取值回填 |
| 6 结果 | ⑥ 结果 | 结构化汇总表 + CSV 导出 |

## 常用脚本

```bash
pnpm typecheck            # 全仓类型检查（含测试代码）
pnpm test                 # 运行测试（状态机 / 去重 / 服务层 / 路由冒烟）
pnpm --filter @meta/server dev   # 仅后端（watch）
pnpm --filter @meta/web dev      # 仅前端（HMR）
```

测试使用 Node 内置 test runner + tsx，覆盖：

- `packages/core/test/status.test.ts`：状态机推进/回退矩阵
- `packages/importer/test/dedup.test.ts`：去重 key 与去重组 id 的唯一性
- `apps/server/test/services.test.ts`：导入去重、重复条目不进初筛、接受 AI 判定不回退流程、
  状态回退清理派生数据、提取字段 renaming 迁移、项目级联删除、转换任务恢复
- `apps/server/test/routes.test.ts`：真实 HTTP 路由冒烟（分页筛选、PRISMA 汇总、状态迁移报错等）

## 常见问题

- **`pnpm install` 时 better-sqlite3 编译失败**：确认 Node ≥ 20 且装了平台编译工具（macOS：`xcode-select --install`；Windows：Visual Studio Build Tools 的「使用 C++ 的桌面开发」）。或改用有预编译二进制的 Node 版本（22 LTS）。
- **端口 8787 / 5173 被占用**：`lsof -ti:8787 | xargs kill -9` 释放；或改 `apps/server/src/index.ts` 的 `PORT`、`apps/web/vite.config.ts` 的 `port`（记得同步改代理 target）。
- **前端能打开但接口报 404 / 连不上**：确认后端已启动（先 `curl http://127.0.0.1:8787/api/health`）；前端开发模式的 `/api` 代理只在 `pnpm dev:web`（vite）下生效。
- **AI 功能报「尚未配置大模型 Provider」**：进「设置」页添加 Provider 并「设为默认」，点「测试」确认连通。
- **MinerU 转换报「请先配置 MinerU Token」**：进「设置」页粘贴 mineru.net 的 Token。
