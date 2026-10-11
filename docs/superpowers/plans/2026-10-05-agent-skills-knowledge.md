# Agent 技能库与知识文档 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为项目 Agent 增加全局的「技能 + 知识文档」能力，并实现按需两段式加载。

**Architecture:** 后端新增三张表与两个服务（技能 CRUD、知识上传/切块/检索），Agent 对话改为两段式：Pass1 用「索引清单」选出要加载的资源，Pass2 注入完整内容后生成回复。前端新增「技能库」页管理两者。

**Tech Stack:** TypeScript + Fastify + better-sqlite3 + Drizzle；前端 React + Ant Design；知识检索用纯关键词/BM25（不引入向量库）；PDF 文本提取用 `pdf-parse`。

**Spec:** `docs/superpowers/specs/2026-10-05-agent-skills-knowledge-design.md`

## Global Constraints

- 全局一套，不分项目；技能与知识文档都存储在应用级数据目录（`DATA_DIR`）下。
- 知识文档切块：每块约 600 字，重叠约 100 字。
- 知识检索：关键词/BM25，默认取 Top-4 块。
- 按需两段式加载：Pass1 只带索引清单，Pass2 注入选中资源；未选中任何资源时行为等价于现状。
- 技能与知识只作用于「项目 Agent」，不影响批量初筛/单篇建议。
- 前端无单测框架：前端任务用 `pnpm -r typecheck` + `pnpm --filter @meta/web build` + 手工冒烟验证。
- 所有提交信息用中文，遵循仓库现有 commit 风格。

## Review Focus

以下输入/场景是 spec 隐含但容易被漏测的，逐条在其所属任务里补测试：

1. 知识文档上传一个超大文本（远超 600 字）→ 应被切分成多块且块之间有重叠。→ Task 3。
2. 检索一个词在多个块里都出现 → 按相关度排序返回 Top-K，而不是返回全部或乱序。→ Task 3。
3. 删除一个知识文档后 → 其所有块从数据库消失。→ Task 3。
4. 技能名/描述重复或为空 → 创建应被拒绝或给出明确校验。→ Task 2。
5. Pass1 选中不存在的资源 id → 注入阶段应忽略而非崩溃。→ Task 5。

---

### Task 1: 数据库表与依赖

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/db/ddl.ts`
- Modify: `apps/server/package.json`（新增 `pdf-parse`、`@types/pdf-parse`）
- Test: `apps/server/test/agent-resources-schema.test.ts`

**Interfaces:**
- Produces: 三张表 `agent_skills`、`agent_knowledge`、`agent_knowledge_chunks`（字段见 spec §6）。

- [ ] **Step 1: 写失败测试** — 新建 `apps/server/test/agent-resources-schema.test.ts`，设置 `META_DATA_DIR` 到临时目录后导入 `../src/db/client.ts` 与 `../src/db/schema.ts`，断言 `db.select().from(schema.agentSkills).all()` 返回数组（表可查询），并对三张表各插入一行后能读回。

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ares-test-'));
process.env.META_DATA_DIR = tmpDir;
const { db } = await import('../src/db/client.ts');
const schema = await import('../src/db/schema.ts');
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

test('技能/知识三张表可创建并可读写', () => {
  const now = new Date().toISOString();
  db.insert(schema.agentSkills).values({ id: 's1', name: 'n', description: 'd', content: 'c', createdAt: now, updatedAt: now }).run();
  db.insert(schema.agentKnowledge).values({ id: 'k1', name: 'n', description: 'd', format: 'md', sourcePath: null, createdAt: now }).run();
  db.insert(schema.agentKnowledgeChunks).values({ id: 'c1', knowledgeId: 'k1', chunkIndex: 0, text: 't' }).run();
  assert.equal(db.select().from(schema.agentSkills).all().length, 1);
  assert.equal(db.select().from(schema.agentKnowledge).all().length, 1);
  assert.equal(db.select().from(schema.agentKnowledgeChunks).all().length, 1);
});
```

- [ ] **Step 2: 运行确认失败** — `npx tsx --test apps/server/test/agent-resources-schema.test.ts`，期望报错（`agentSkills` 不存在）。

- [ ] **Step 3: 实现** — 在 `schema.ts` 增加三张表定义；在 `ddl.ts` 的 `SCHEMA_SQL` 增加对应 `CREATE TABLE IF NOT EXISTS`；在 `apps/server` 执行 `pnpm add pdf-parse` 与 `pnpm add -D @types/pdf-parse`。

- [ ] **Step 4: 运行确认通过** — 同上命令，期望 PASS。

- [ ] **Step 5: 提交** — `git add apps/server/src/db/schema.ts apps/server/src/db/ddl.ts apps/server/package.json pnpm-lock.yaml apps/server/test/agent-resources-schema.test.ts && git commit -m "feat(agent): 技能与知识三张表及pdf解析依赖"`

---

### Task 2: 技能 CRUD 服务与路由

**Files:**
- Create: `apps/server/src/services/agentSkills.ts`
- Create: `apps/server/src/routes/agent-skills.ts`
- Modify: `apps/server/src/index.ts`（注册路由）
- Test: `apps/server/test/agent-skills.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AgentSkill { id: string; name: string; description: string; content: string; createdAt: string; updatedAt: string; }
  export interface SkillInput { name: string; description: string; content: string; }
  export function listSkills(): AgentSkill[];
  export function createSkill(input: SkillInput): AgentSkill;
  export function updateSkill(id: string, input: SkillInput): AgentSkill; // 不存在抛错
  export function deleteSkill(id: string): void;
  ```

- [ ] **Step 1: 写失败测试** — `apps/server/test/agent-skills.test.ts`（隔离 `META_DATA_DIR`，导入 service 与 `db`），断言：创建返回含 id；`listSkills()` 含刚创建项；更新后 name/content 改变；空 name 被拒绝（抛错）；删除后列表为空。

```ts
test('技能创建/列表/更新/删除', () => {
  const s = skills.createSkill({ name: '检索式专家', description: '生成检索式', content: '规则' });
  assert.ok(s.id);
  assert.equal(skills.listSkills().length, 1);
  const u = skills.updateSkill(s.id, { name: '检索式专家2', description: 'd', content: '新规则' });
  assert.equal(u.name, '检索式专家2');
  assert.equal(u.content, '新规则');
  skills.deleteSkill(s.id);
  assert.equal(skills.listSkills().length, 0);
});
test('空技能名被拒绝', () => {
  assert.throws(() => skills.createSkill({ name: '  ', description: 'd', content: 'c' }));
});
```

- [ ] **Step 2: 运行确认失败** — 期望 `Cannot find module '../src/services/agentSkills'`。

- [ ] **Step 3: 实现** — 在 `agentSkills.ts` 实现四个函数（用 `randomUUID`、`db`、`agentSkills` 表；name trim 后为空抛 `Error('技能名不能为空')`）。在 `routes/agent-skills.ts` 暴露 `GET/POST/PUT/DELETE /api/agent/skills`（POST/PUT body 用 zod `{name,description,content}`）。在 `index.ts` 注册。

- [ ] **Step 4: 运行确认通过** — 同上命令，期望 PASS。

- [ ] **Step 5: 提交** — `git add ... && git commit -m "feat(agent): 技能增删改查"`

---

### Task 3: 知识切块、检索与 CRUD 服务

**Files:**
- Create: `apps/server/src/services/agentKnowledge.ts`
- Test: `apps/server/test/agent-knowledge.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AgentKnowledge { id: string; name: string; description: string; format: string; chunkCount: number; createdAt: string; }
  export interface KnowledgeChunk { id: string; knowledgeId: string; chunkIndex: number; text: string; }
  export function chunkText(text: string, size?: number, overlap?: number): string[];
  export function retrieveChunks(query: string, chunks: KnowledgeChunk[], k?: number): KnowledgeChunk[];
  export function addKnowledge(input: { name: string; description: string; text: string; format: string }): AgentKnowledge;
  export function listKnowledge(): AgentKnowledge[];
  export function deleteKnowledge(id: string): void;
  export function getChunksByKnowledgeIds(ids: string[]): KnowledgeChunk[];
  ```

- [ ] **Step 1: 写失败测试** — `apps/server/test/agent-knowledge.test.ts`，断言：
  1. `chunkText('a'.repeat(2000), 600, 100)` 返回长度 ≥3 且每块长度 ≤ 600、相邻块有重叠文本。
  2. `retrieveChunks('zeolite', chunks, 2)` 只返回含 `zeolite` 的块且按命中次数降序、数量 ≤2。
  3. `addKnowledge`（md 文本 1200 字）后 `listKnowledge()` 返回 1 项且 `chunkCount ≥ 2`；`deleteKnowledge` 后列表为空且 `db` 中无该知识对应块。

- [ ] **Step 2: 运行确认失败** — 期望 `Cannot find module '../src/services/agentKnowledge'`。

- [ ] **Step 3: 实现** — `chunkText`：按段落合并至 size，超长段落硬切；块间复制 overlap 字符。`retrieveChunks`：对 query 按空白分词 + 整串子串匹配计分，取 Top-K 按分数降序、分数相同按 chunkIndex 升序。`addKnowledge`：生成 id，写原文到 `DATA_DIR/agent/knowledge/<id>/source.<ext>`，`chunkText` 后逐块插入 `agentKnowledgeChunks`。`listKnowledge` 用 `count` 计算每项 chunkCount。`deleteKnowledge` 删除三处（文件、块、元数据）。

- [ ] **Step 4: 运行确认通过** — 同上命令，期望 PASS。

- [ ] **Step 5: 提交** — `git add apps/server/src/services/agentKnowledge.ts apps/server/test/agent-knowledge.test.ts && git commit -m "feat(agent): 知识切块检索与CRUD"`

---

### Task 4: 知识上传路由（multipart）

**Files:**
- Create: `apps/server/src/routes/agent-knowledge.ts`
- Modify: `apps/server/src/index.ts`（注册路由）
- Test: `apps/server/test/agent-knowledge-route.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `addKnowledge`、`listKnowledge`、`deleteKnowledge`，以及 `extractTextFromBuffer`（本任务新增，见下）。
- Produces:
  ```ts
  export function extractTextFromBuffer(buf: Buffer, filename: string): Promise<string>;
  ```

- [ ] **Step 1: 写失败测试** — `apps/server/test/agent-knowledge-route.test.ts` 用真实 HTTP（参考 `routes.test.ts` 的 `buildApp` + 端口 8797），断言：POST multipart（`file` 为含 1500 字 markdown 的 Blob、文件名 `guide.md`、表单字段 `name`/`description`）返回 200 且 `chunkCount ≥ 2`；随后 GET 列表含该项；DELETE 后 GET 为空。`extractTextFromBuffer` 单独测：md/txt 返回解码文本，非 pdf 的二进制应能 utf8 解码。

- [ ] **Step 2: 运行确认失败** — 期望 404（路由未注册）。

- [ ] **Step 3: 实现** — `extractTextFromBuffer(buf, filename)`：扩展名 `.pdf` 走 `pdf-parse`（`const pdf = await import('pdf-parse'); await pdf.default(buf)` 取 `.text`），否则 `buf.toString('utf8')`。路由：`POST /api/agent/knowledge`（`req.file()` + 表单字段，调用 `extractTextFromBuffer` 后 `addKnowledge`）、`GET /api/agent/knowledge`、`DELETE /api/agent/knowledge/:id`。

- [ ] **Step 4: 运行确认通过** — 同上命令，期望 PASS。

- [ ] **Step 5: 提交** — `git add ... && git commit -m "feat(agent): 知识文档上传接口"`

---

### Task 5: Agent 两段式加载（索引、选择、注入）

**Files:**
- Create: `apps/server/src/services/agentResources.ts`
- Modify: `apps/server/src/services/agent.ts`（`agentChat` 接入两段式）
- Test: `apps/server/test/agent-resources.test.ts`

**Interfaces:**
- Consumes: Task 2 `listSkills`、Task 3 `listKnowledge`/`getChunksByKnowledgeIds`。
- Produces:
  ```ts
  export interface ResourceIndexItem { id: string; type: 'skill' | 'knowledge'; name: string; description: string; }
  export function buildResourceIndex(): ResourceIndexItem[];
  export function selectResourcesPrompt(index: ResourceIndexItem[], query: string): string;
  export function resourceContext(ids: string[], query: string, k?: number): string;
  export function getChunksByKnowledgeIds(ids: string[]): KnowledgeChunk[]; // 在 agentKnowledge.ts
  ```

- [ ] **Step 1: 写失败测试** — `apps/server/test/agent-resources.test.ts`（隔离 DB，先 seed 1 技能 + 1 知识及若干块）：
  1. `buildResourceIndex()` 返回 2 项，type 分别为 `skill`/`knowledge`，含 name/description。
  2. `selectResourcesPrompt(index, '检索')` 包含「检索」与所有资源的名称。
  3. `resourceContext([skillId, knowledgeId], 'zeolite')` 返回文本同时包含该技能 `content` 和知识块中命中 `zeolite` 的文本。
  4. `resourceContext(['不存在的id'], 'x')` 返回不含技能正文的空/占位文本，且不抛错。

- [ ] **Step 2: 运行确认失败** — 期望 `Cannot find module '../src/services/agentResources'`。

- [ ] **Step 3: 实现** — `buildResourceIndex` 合并 `listSkills` 与 `listKnowledge`。`selectResourcesPrompt` 输出索引清单 + 「请只返回需要加载的资源 id 列表」。`resourceContext` 把选中技能的 `content` 全文 + 选中知识经 `getChunksByKnowledgeIds` + `retrieveChunks` 取 Top-k 的块，拼成带小标题的文本；未命中则忽略。在 `agent.ts` 的 `agentChat`：取最后一条 user 消息作为 query；若 `buildResourceIndex()` 非空，先用 `selectResourcesPrompt` + schema `{ load: z.array(z.string()) }` 跑 Pass1，再 `resourceContext(load, query)` 拼入系统提示词后跑现有 Pass2。

- [ ] **Step 4: 运行确认通过** — 同上命令，期望 PASS。

- [ ] **Step 5: 提交** — `git add ... && git commit -m "feat(agent): 技能与知识按需两段式加载"`

---

### Task 6: 前端「技能库」页与导航

**Files:**
- Modify: `apps/web/src/types.ts`（新增 `AgentSkill`、`AgentKnowledge`）
- Modify: `apps/web/src/api.ts`（技能/知识接口方法）
- Create: `apps/web/src/pages/SkillsPage.tsx`
- Modify: `apps/web/src/App.tsx`（新增 `/skills` 路由）
- Modify: `apps/web/src/components/ProjectList.tsx`（导航新增「技能库」按钮）

**Interfaces:**
- Consumes: Task 2/4 的后端接口。
- Produces: 页面「技能库」，含「技能」与「知识文档」两个 Card 分区。

- [ ] **Step 1: 类型与接口** — `types.ts` 增加 `AgentSkill`、`AgentKnowledge`；`api.ts` 增加 `listSkills/createSkill/updateSkill/deleteSkill` 与 `listKnowledge/uploadKnowledge/deleteKnowledge`（uploadKnowledge 用 FormData POST）。

- [ ] **Step 2: 实现页面** — `SkillsPage.tsx`：技能列表（Table + 新建/编辑 Modal 用 `Input`/`TextArea` 编辑 name/description/content）与知识文档列表（Table + 上传用 `Upload` 组件 + 名称/描述表单 + 删除）；加载用 `api` 方法；删除知识前用 Popconfirm 提示。

- [ ] **Step 3: 接入导航** — `App.tsx` 加 `<Route path="/skills" element={<SkillsPage />} />`；`ProjectList.tsx` 底部加「技能库」按钮（`ReadOutlined` 图标，`navigate('/skills')`，高亮逻辑同设置）。

- [ ] **Step 4: 验证** — `pnpm -r typecheck` 通过；`pnpm --filter @meta/web build` 通过。

- [ ] **Step 5: 提交** — `git add ... && git commit -m "feat(web): 技能库页面与导航"`

---

### Task 7: 全量验证

**Files:** 无（仅验证）

- [ ] **Step 1: 运行全量测试** — `node --import tsx --test apps/server/test/*.test.ts packages/importer/test/*.test.ts packages/core/test/*.test.ts`，期望全部通过。
- [ ] **Step 2: 类型与构建** — `pnpm -r typecheck` 与 `pnpm --filter @meta/web build` 通过。
- [ ] **Step 3: 手工冒烟** — 启动前后端，在「技能库」新建技能、上传 markdown 知识文档；在项目 Agent 提问命中该技能/知识，确认回复会引用；删除后确认消失。
- [ ] **Step 4: 提交（如有残余改动）** — `git status` 确认干净后结束。
