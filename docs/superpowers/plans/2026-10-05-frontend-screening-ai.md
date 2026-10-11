# 前端 ②③⑥ + 初筛 AI + 项目助手 实现计划（Plan 2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1 后端核心之上，完成 ② 采集管理、③ 初筛去重/大表/初筛 AI、⑥ 统计结果，以及项目助手的「项目级上下文 + 对话删除 + 停止取消」，并补齐初筛 AI 的模型/提示词按项目配置。

**Architecture:** 后端新增 `project_ai_settings`（项目级初筛模型与提示词）、提示词生成服务、批量初筛的跳过/重判、Agent 上下文从计数升级为项目级结构化摘要；LLM 客户端支持外部 `AbortSignal`，Agent 聊天路由用 `request close` 触发取消；前端按 ②③⑥ 重做交互。

**Tech Stack:** TypeScript、React + Ant Design、Fastify、better-sqlite3 + Drizzle、node:test + tsx。

**Spec:** `docs/superpowers/specs/2026-10-03-screening-collection-refactor-design.md`
**Plan 1（前置）：** `docs/superpowers/plans/2026-10-03-collection-dedup-backend-core.md`

## Global Constraints

- Node ≥ 20；pnpm workspace；TypeScript strict。
- 来源库、排除理由、初筛 AI 模型/提示词均按项目隔离；全局 Provider/API Key 在「设置」里配置。
- 导入必须绑定检索式（Plan 1 已强制）。
- 去重合并只重打 `is_duplicate`/`dedup_group_id`，不碰判定/全文/提取；③ 自动合并并可手动「重新合并」。
- 初筛批量 AI 默认「跳过已有 AI 建议」，另提供「全部重新判断」；同意 AI = 单条/全局/勾选。
- Agent 上下文只含项目级信息（协议/检索式/提取表字段/来源统计/排除理由/流程计数），不含单篇文献明细。
- 前端目前无单测框架：前端任务以 `pnpm --filter @meta/web typecheck` + `pnpm --filter @meta/web build` + 手工回归为验证；纯逻辑抽到可测模块时用 node:test。

## Review Focus

1. 项目级初筛提示词/模型被正确使用：A 项目配置不影响 B 项目；未配置时继承全局。
2. 批量初筛「跳过已判」与「全部重判」边界：已有 `aiSuggestion` 的默认跳过，force 时覆盖。
3. 停止按钮真正打断后端 LLM 请求（不只在 UI 上停止），并允许中断后立即发第二条。
4. 删除某条对话 = 删除该条及其后所有消息，且持久化。
5. 来源库删除后，② 列表与 ⑥ 统计实时一致（复用 Plan 1 的删除级联与统计）。

---

### Task 1: `project_ai_settings` 表 + AI 设置服务

**Files:**
- Modify: `apps/server/src/db/ddl.ts`、`apps/server/src/db/schema.ts`、`apps/server/src/db/client.ts`
- Create: `apps/server/src/services/aiSettings.ts`
- Test: `apps/server/test/ai-settings.test.ts`

**Interfaces:**
- Produces:
  - `projectAiSettings` 表（`projectId` 主键、`assistantProviderId`、`screeningProviderId`、`screeningSystemPrompt`、`updatedAt`）
  - `getAiSettings(projectId): AiSettings | null`
  - `saveAiSettings(projectId, input): AiSettings`
  - `generateScreeningPrompt(projectId): string`

- [ ] **Step 1: 写失败测试**

用临时 `META_DATA_DIR`，断言：
```ts
// 默认继承：无记录时 getAiSettings 返回 null，screeningSystemPrompt 为空
assert.equal(getAiSettings('p1'), null);
// 保存/读回
saveAiSettings('p1', { screeningProviderId:'prov-s', screeningSystemPrompt:'PROMPT-A' });
assert.equal(getAiSettings('p1')!.screeningSystemPrompt, 'PROMPT-A');
// 生成提示词包含 PICO 关键词 + 纳入/排除标准 + 输出要求
const p = generateScreeningPrompt('p1');
assert.match(p, /纳入/);
assert.match(p, /排除/);
assert.match(p, /待定/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test apps/server/test/ai-settings.test.ts`
Expected: FAIL（表/模块不存在）

- [ ] **Step 3: 实现表与 `aiSettings.ts`**

DDL/schema/client 加 `project_ai_settings`；`generateScreeningPrompt` 读取协议 + 检索式全文，拼「判断是否可接受（纳入/排除/待定）+ 理由」要求。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test apps/server/test/ai-settings.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/db/ddl.ts apps/server/src/db/schema.ts apps/server/src/db/client.ts apps/server/src/services/aiSettings.ts apps/server/test/ai-settings.test.ts
git commit -m "feat(ai-settings): 项目级初筛模型与提示词"
```

---

### Task 2: 初筛批量 AI 使用项目级设置 + 跳过/重判

**Files:**
- Modify: `apps/server/src/services/llm.ts`、`apps/server/src/services/references.ts`
- Test: `apps/server/test/screening-targets.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `getAiSettings`。
- Produces:
  - `selectScreeningTargets(projectId, opts: { force?: boolean; referenceIds?: string[] }): ScreeningTarget[]`（纯函数，便于测试）
  - `suggestBatch` 使用项目级 `screeningSystemPrompt` 与 `screeningProviderId`；默认跳过已有 `aiSuggestion`，`force=true` 时全部重判。

- [ ] **Step 1: 写失败测试**

```ts
// 三篇：A 无建议、B 有建议、C 有建议
assert.deepEqual(selectScreeningTargets('p1', {}).map(x=>x.id), ['A']);
assert.deepEqual(selectScreeningTargets('p1', { force:true }).map(x=>x.id), ['A','B','C']);
assert.deepEqual(selectScreeningTargets('p1', { referenceIds:['B'] }).map(x=>x.id), ['B']);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test apps/server/test/screening-targets.test.ts`
Expected: FAIL（函数不存在）

- [ ] **Step 3: 实现目标选择与批量建议**

`selectScreeningTargets` 只取非重复、初筛开放状态，按 `force` 决定是否排除已有 `aiSuggestion`。`suggestBatch` 加载项目 AI 设置并传入 `suggestReferencesBatch`（提示词覆盖）与项目级 `getScreeningLLM(providerId)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test apps/server/test/screening-targets.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/services/llm.ts apps/server/src/services/references.ts apps/server/test/screening-targets.test.ts
git commit -m "feat(screening-ai): 项目级模型/提示词与跳过重判"
```

---

### Task 3: LLM 请求支持外部取消信号

**Files:**
- Modify: `packages/llm/src/http.ts`、`packages/llm/src/types.ts`、`packages/llm/src/openai.ts`、`packages/llm/src/anthropic.ts`
- Test: `packages/llm/test/http-abort.test.ts`

**Interfaces:**
- Produces: `CompletionOptions.signal?: AbortSignal`；`postJSON` 合并外部 `signal` 与超时信号后传给 `fetch`。

- [ ] **Step 1: 写失败测试**

```ts
const ctrl = new AbortController();
const p = postJSON({ endpoint:'http://x', headers:{}, body:{}, timeoutMs:5000, retries:0, signal: ctrl.signal });
ctrl.abort();
await assert.rejects(p, (e) => e.name === 'AbortError');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test packages/llm/test/http-abort.test.ts`
Expected: FAIL（postJSON 不接受 signal）

- [ ] **Step 3: 实现取消信号**

`HttpCallOptions` 加 `signal?`；用 `AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])`（Node 20+ 支持，否则手动合并）传给 `fetch`；`CompletionOptions` 加 `signal`；两个客户端透传。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test packages/llm/test/http-abort.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/llm/src/http.ts packages/llm/src/types.ts packages/llm/src/openai.ts packages/llm/src/anthropic.ts packages/llm/test/http-abort.test.ts
git commit -m "feat(llm): 支持外部取消信号"
```

---

### Task 4: Agent 上下文 v2（项目级结构化摘要）

**Files:**
- Modify: `apps/server/src/services/agent.ts`
- Test: `apps/server/test/agent-context.test.ts`

**Interfaces:**
- Produces: 导出 `buildContext(projectId): string`，内容包含协议全文、检索式全文、提取字段表、来源统计、排除理由列表、流程计数、下一步建议。

- [ ] **Step 1: 写失败测试**

种子数据后断言 `buildContext('p1')` 包含：
```ts
assert.match(ctx, /PubMed/);            // 来源库名
assert.match(ctx, /q-pubmed/);          // 检索式正文
assert.match(ctx, /原始命中/);          // 来源统计
assert.match(ctx, /研究对象不符/);       // 排除理由
assert.match(ctx, /design/);            // 提取字段 key
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test apps/server/test/agent-context.test.ts`
Expected: FAIL（当前 buildContext 不导出/内容不全）

- [ ] **Step 3: 实现 `buildContext` v2**

补入 `listStrategies` 的 query/notes、`getTemplate` 字段、`sourceStats`、`listExclusionReasons`；保留计数与下一步建议；仍不传单篇文献明细。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test apps/server/test/agent-context.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/services/agent.ts apps/server/test/agent-context.test.ts
git commit -m "feat(agent): 项目级上下文 v2"
```

---

### Task 5: Agent 聊天支持取消（前端+后端）

**Files:**
- Modify: `apps/server/src/services/agent.ts`、`apps/server/src/routes/agent.ts`、`apps/web/src/api.ts`、`apps/web/src/components/AgentPanel.tsx`
- 验证：`pnpm --filter @meta/server typecheck` + `pnpm --filter @meta/web typecheck`

**Interfaces:**
- Consumes: Task 3 的 `CompletionOptions.signal`。
- Produces: `agentChat(projectId, messages, signal?)`；路由 `POST /api/projects/:id/agent/chat` 用 `req.raw.on('close')` 触发 `AbortController`；前端 `api.agentChat(..., signal)` 透传。

- [ ] **Step 1: 后端签名与路由接入**

`agentChat` 接受 `signal` 并传给 `client.completeJSON`；路由创建 `AbortController`，`req.raw.on('close', () => ctrl.abort())`，把 `signal` 传入。

- [ ] **Step 2: 前端接入 AbortController 与停止按钮**

`AgentPanel` 维护 `abortRef`；发送时新建 controller；加载中按钮变为「停止」，点击 `abort()`；中断时不追加“出错了”回复，仅清 loading 保留用户消息，可立即再发。

- [ ] **Step 3: 验证**

Run: `pnpm --filter @meta/server typecheck && pnpm --filter @meta/web typecheck`
Expected: PASS（无类型错误）

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/services/agent.ts apps/server/src/routes/agent.ts apps/web/src/api.ts apps/web/src/components/AgentPanel.tsx
git commit -m "feat(agent): 聊天停止/取消"
```

---

### Task 6: Agent 对话删除（某条及其后所有）

**Files:**
- Modify: `apps/web/src/components/AgentPanel.tsx`
- 验证：`pnpm --filter @meta/web typecheck` + 手工回归

**Interfaces:**
- 每条消息 hover 显示删除按钮；删除 = `messages.slice(0, index)` 并 `putAgentHistory` 持久化；`Popconfirm` 二次确认。

- [ ] **Step 1: 实现删除交互**

- [ ] **Step 2: 验证**

Run: `pnpm --filter @meta/web typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/AgentPanel.tsx
git commit -m "feat(agent): 删除某段对话"
```

---

### Task 7: 前端 ② 检索策略（项目级来源库 + 导入 + 条目管理）

**Files:**
- Modify: `apps/web/src/api.ts`、`apps/web/src/types.ts`、`apps/web/src/pages/project/StrategiesTab.tsx`
- 验证：`pnpm --filter @meta/web typecheck` + `pnpm --filter @meta/web build`

**Interfaces:**
- 使用 `GET/POST /api/projects/:projectId/databases`、`GET /api/databases/presets`、`DELETE /api/projects/:projectId/databases/:id`（若 Plan 1 未暴露则本任务补该路由）、导入必须传 `strategyId`、条目管理走删除级联接口。

- [ ] **Step 1: 重写 StrategiesTab**

来源库列表（三数统计）、添加预设/自定义、展开检索式、导入（粘贴+文件，绑定策略）、条目管理、删除库/检索式确认。

- [ ] **Step 2: 验证**

Run: `pnpm --filter @meta/web typecheck && pnpm --filter @meta/web build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/api.ts apps/web/src/types.ts apps/web/src/pages/project/StrategiesTab.tsx
git commit -m "feat(web): ② 采集管理"
```

---

### Task 8: 前端 ③ 初筛（Excel 大表 + 合并 + 初筛 AI 设置）

**Files:**
- Modify: `apps/web/src/api.ts`、`apps/web/src/types.ts`、`apps/web/src/pages/project/ScreeningTab.tsx`
- 验证：`pnpm --filter @meta/web typecheck` + `pnpm --filter @meta/web build`

**Interfaces:**
- 调用合并结果（Plan 1 `mergeDuplicates` 的暴露路由）、`GET/PUT /ai-settings`、`POST /ai-settings/generate-prompt`、批量建议（`force`）、同意 AI（单条/全局/勾选）。

- [ ] **Step 1: 重写 ScreeningTab**

多列审阅大表、AI「是否可接受+理由」、人工「判定+排除理由+备注」、来源库列、重复明细、显示重复条目、顶部合并结果+重新合并、初筛 AI 设置弹窗、批量进度与停止。

- [ ] **Step 2: 验证**

Run: `pnpm --filter @meta/web typecheck && pnpm --filter @meta/web build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/api.ts apps/web/src/types.ts apps/web/src/pages/project/ScreeningTab.tsx
git commit -m "feat(web): ③ 初筛大表与 AI 设置"
```

---

### Task 9: 前端 ⑥ 结果（来源库统计 + PRISMA）

**Files:**
- Modify: `apps/web/src/api.ts`、`apps/web/src/types.ts`、`apps/web/src/pages/project/ResultsTab.tsx`
- 验证：`pnpm --filter @meta/web typecheck` + `pnpm --filter @meta/web build`

**Interfaces:**
- 使用 Plan 1 的来源统计接口与 PRISMA 汇总接口，展示来源库统计表与流程数字。

- [ ] **Step 1: 接入统计接口**

- [ ] **Step 2: 验证**

Run: `pnpm --filter @meta/web typecheck && pnpm --filter @meta/web build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/api.ts apps/web/src/types.ts apps/web/src/pages/project/ResultsTab.tsx
git commit -m "feat(web): ⑥ 来源统计与 PRISMA"
```

---

## Self-Review 结果

- 覆盖 spec 的 Plan 2 范围：项目级 AI 设置、批量初筛跳过/重判、LLM 取消、Agent 上下文 v2、对话删除、②③⑥ 前端、统计。
- Review Focus 5 项分别落在 Task 1、2、3/5、6、7/9。
- 前端任务无单测框架：以 typecheck/build/手工回归验证（已在 Global Constraints 记录）。
