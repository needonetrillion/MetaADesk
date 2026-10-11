# 采集 / 去重 / 删除 / 统计 后端核心 实现计划（Plan 1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「来源库项目化 + 入库不去重 + 初筛自动去重合并 + 删除级联 + 来源统计」的后端与数据模型落地，为前端（Plan 2）和提取重构（Plan 3）打基础。

**Architecture:** 单文件 SQLite（`meta.db`）按 `project_id` 逻辑隔离；来源库改为项目级表；导入只落库、标来源与 `import_order`；新增合并服务只重打 `is_duplicate/dedup_group_id`；删除级联走事务、文件清理在事务外；统计实时计算。

**Tech Stack:** TypeScript、Drizzle ORM（better-sqlite3）、Fastify、node:test + tsx。

**Spec:** `docs/superpowers/specs/2026-10-03-screening-collection-refactor-design.md`

## Global Constraints

- Node ≥ 20；pnpm workspace；TypeScript strict。
- 数据仍集中在一个 `meta.db`，项目间靠 `project_id` 隔离；不按项目分 SQLite 文件。
- 文件目录：`data/projects/<项目ID>/data/<文献ID>/{source.pdf, markdown.md}`。
- 导入必须绑定检索式；导入阶段**完全不去重**，`duplicate_count` 恒 0。
- 合并只改 `is_duplicate` 与 `dedup_group_id`，绝不改动 status、判定、全文、提取。
- 删除级联用数据库事务；文件删除放在事务外。
- 现有数据为测试数据，不做历史迁移；DDL/加列保持幂等。

## Review Focus

1. 跨项目隔离：删除 A 项目的来源库，不得影响 B 项目同预设库或同名库。
2. 主条目删除补位：合并后删除主条目，组内下一条最早应成为主条目，且不继承被删条目判定。
3. 删除来源/检索式后，合并结果与统计实时一致。
4. 同一批次/同一来源库内出现重复，也按 `import_order` 取最早为主。
5. `timeoutMs` 保存后读回不变。

---

### Task 1: 数据模型与幂等迁移

**Files:**
- Modify: `apps/server/src/db/ddl.ts`
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/db/client.ts`
- Test: `apps/server/test/schema.test.ts`

**Interfaces:**
- Produces: 表字段/索引可被后续任务引用：
  - `searchDatabases.projectId`、`searchDatabases.presetKey`
  - `references.importOrder`
  - `exclusionReasons`（`id/projectId/code/label/isBuiltin/sortOrder/createdAt`）
  - `screenDecisions.reasonNote`

- [ ] **Step 1: 写失败测试**

在 `apps/server/test/schema.test.ts` 用临时 `META_DATA_DIR` 初始化 db，断言：
```ts
// search_databases 列存在
const dbCols = columnsOf('search_databases');
assert(dbCols.includes('project_id'));
assert(dbCols.includes('preset_key'));
// references 列存在
const refCols = columnsOf('references');
assert(refCols.includes('import_order'));
// exclusion_reasons 表存在且可插入
db.insert(exclusionReasons).values({ id:'r1', projectId:'p1', code:'other', label:'其他', isBuiltin:1, sortOrder:0, createdAt:now }).run();
// screen_decisions 列存在
const decCols = columnsOf('screen_decisions');
assert(decCols.includes('reason_note'));
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test apps/server/test/schema.test.ts`
Expected: FAIL（列/表不存在）

- [ ] **Step 3: 实现 DDL、schema 与迁移**

- `ddl.ts`：`search_databases` 加 `project_id TEXT NOT NULL`、`preset_key TEXT`；`references` 加 `import_order INTEGER`；新增 `exclusion_reasons` 表；`screen_decisions` 加 `reason_note TEXT`；补索引 `search_databases(project_id)`、`references(import_order)`、`references(dedup_group_id)`、`references(source_database_id)`、`references(source_query_id)`、`exclusion_reasons(project_id)`。
- `schema.ts`：同步上述字段与表。
- `client.ts`：用现有 `ensureColumn` 幂等加列 `search_databases.project_id/preset_key`、`references.import_order`、`screen_decisions.reason_note`；新增表由 `CREATE TABLE IF NOT EXISTS` 处理。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test apps/server/test/schema.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/db/ddl.ts apps/server/src/db/schema.ts apps/server/src/db/client.ts apps/server/test/schema.test.ts
git commit -m "feat(db): 来源库项目化、import_order、排除理由表与迁移"
```

---

### Task 2: 项目文件目录助手

**Files:**
- Create: `apps/server/src/services/files.ts`
- Test: `apps/server/test/files.test.ts`

**Interfaces:**
- Produces:
  - `projectDir(projectId: string): string`
  - `referenceDir(projectId: string, referenceId: string): string`
  - `pdfPath(projectId, referenceId): string`
  - `markdownPath(projectId, referenceId): string`
  - `ensureProjectDir(projectId: string, meta: { name: string; createdAt: string }): void`
  - `removeProjectDir(projectId: string): void`
  - `removeReferenceDir(projectId: string, referenceId: string): void`
  - 所有路径以相对 `DATA_DIR` 的形式返回。

- [ ] **Step 1: 写失败测试**

用临时 `META_DATA_DIR`，断言：
```ts
ensureProjectDir('p1', { name:'测试', createdAt: now });
assert(fs.existsSync(projectDir('p1')));
assert(fs.existsSync(path.join(projectDir('p1'), 'project.json')));
assert(pdfPath('p1','r1').endsWith('projects/p1/data/r1/source.pdf'));
assert(markdownPath('p1','r1').endsWith('projects/p1/data/r1/markdown.md'));
removeProjectDir('p1');
assert(!fs.existsSync(projectDir('p1')));
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test apps/server/test/files.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `files.ts`**

基于 `DATA_DIR` 计算路径；`ensureProjectDir` 创建 `project.json`（含 name/createdAt）与 `data/`；`removeProjectDir` 递归删除项目目录；`removeReferenceDir` 删除单篇文献目录。文件不存在时静默成功。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test apps/server/test/files.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/services/files.ts apps/server/test/files.test.ts
git commit -m "feat(files): 项目文件目录助手"
```

---

### Task 3: 来源库项目化（列表 / 添加 / 删除级联）

**Files:**
- Create: `apps/server/src/services/sources.ts`
- Modify: `apps/server/src/routes/databases.ts`
- Modify: `apps/server/src/routes/strategies.ts`
- Test: `apps/server/test/sources.test.ts`

**Interfaces:**
- Consumes: `files.ts` 的 `removeReferenceDir`（删除级联见 Task 6）。
- Produces:
  - `listProjectSources(projectId): Array<{ id; name; url?; note?; presetKey?; strategyCount; rawImported; uniqueKept; duplicateRemoved }>`
  - `addSource(projectId, input: { presetKey?; name; url?; note? }): SourceRow`

- [ ] **Step 1: 写失败测试**

断言（临时库 + 两个项目）：
```ts
// 隔离：A 项目添加 PubMed，B 项目列表为空
const a = addSource('pa', { presetKey:'pubmed', name:'PubMed' });
assert(listProjectSources('pa').length === 1);
assert(listProjectSources('pb').length === 0);
assert(listProjectSources('pa')[0].presetKey === 'pubmed');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test apps/server/test/sources.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `sources.ts` 与路由**

`addSource` 写 `search_databases`（projectId + presetKey）；`listProjectSources` 联查策略数与来源统计。路由改为项目级：`GET /api/projects/:projectId/databases` 与 `POST /api/projects/:projectId/databases`（Plan 2 前端同步切换）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test apps/server/test/sources.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/services/sources.ts apps/server/src/routes/databases.ts apps/server/src/routes/strategies.ts apps/server/test/sources.test.ts
git commit -m "feat(sources): 来源库项目化与删除级联"
```

---

### Task 4: 导入改为“不去重 + 分配 import_order”

**Files:**
- Modify: `apps/server/src/services/references.ts`
- Test: `apps/server/test/import.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `references.importOrder`。
- Produces: `importReferences(projectId, parsed, options)` 返回 `{ imported, total, batchId }`（去掉 duplicates）。

- [ ] **Step 1: 写失败测试**

```ts
const a = importReferences('p1', [doiA]);       // 第一次
const b = importReferences('p1', [doiA]);       // 第二次同 DOI
assert(a.imported === 1 && b.imported === 1);   // 不再去重
const rows = allRefs('p1');
assert(rows.every(r => r.isDuplicate === 0));   // 导入不标记重复
assert(new Set(rows.map(r => r.importOrder)).size === 2); // 序号严格递增
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test apps/server/test/import.test.ts`
Expected: FAIL（当前导入会去重）

- [ ] **Step 3: 实现导入逻辑**

移除 `importReferences` 内对已有库/批内去重的比较与 `is_duplicate` 写入；为每条记录分配全局自增 `importOrder`（用 `max(import_order)+1` 或自增计数，在事务内完成）；`import_batches.duplicate_count` 写 0；返回去掉 duplicates。同步更新 `apps/server/test/services.test.ts`、`apps/server/test/routes.test.ts` 中依赖旧“导入即去重”的断言为“不去重”语义。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test apps/server/test/import.test.ts apps/server/test/services.test.ts apps/server/test/routes.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/services/references.ts apps/server/test/import.test.ts
git commit -m "feat(import): 入库不去重并分配 import_order"
```

---

### Task 5: 去重合并服务

**Files:**
- Create: `apps/server/src/services/merge.ts`
- Test: `apps/server/test/merge.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `references.importOrder`。
- Produces: `mergeDuplicates(projectId): { groups: number; duplicates: number }`。

- [ ] **Step 1: 写失败测试**

断言：
```ts
// 同 DOI 跨库：最早 import_order 为主，其余重复
mergeDuplicates('p1');
const byOrder = allRefs('p1').sort((x,y)=>x.importOrder-y.importOrder);
assert(byOrder[0].isDuplicate === 0);
assert(byOrder[1].isDuplicate === 1);
assert(byOrder[0].dedupGroupId === byOrder[1].dedupGroupId);
// 幂等：再跑一次结果不变
const r1 = mergeDuplicates('p1'); const r2 = mergeDuplicates('p1');
assert.deepEqual(r1, r2);
// 主条目被删后补位，且不继承判定
deleteRef(byOrder[0].id); mergeDuplicates('p1');
assert(statusOf(byOrder[1].id) === 'imported'); // 补位者保持自身状态
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test apps/server/test/merge.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `merge.ts`**

分组 key：DOI(小写) 优先，否则归一化标题；组内按 `importOrder` 升序，第一为主（`is_duplicate=0`），其余 `is_duplicate=1`，共享一个 `dedupGroupId`；实现为事务内先重置本组标记再重算，不触碰 status/decisions/documents/extractions。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test apps/server/test/merge.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/services/merge.ts apps/server/test/merge.test.ts
git commit -m "feat(merge): 初筛去重合并服务"
```

---

### Task 6: 删除级联（检索式 / 来源库 / 复用项目删除）

**Files:**
- Modify: `apps/server/src/services/references.ts`（或新 `delete.ts`）
- Modify: `apps/server/src/services/strategies.ts`
- Modify: `apps/server/src/routes/projects.ts`
- Test: `apps/server/test/delete-cascade.test.ts`

**Interfaces:**
- Consumes: `files.ts` 的 `removeReferenceDir`。
- Produces:
  - `deleteStrategyCascade(strategyId): { deletedReferences: number }`
  - `deleteSourceCascade(projectId, sourceId): { deletedStrategies: number; deletedReferences: number }`
  - 项目删除复用同一套级联并删除整个项目目录。

- [ ] **Step 1: 写失败测试**

```ts
// 建库、策略、导入、上传假 PDF、建判定
deleteStrategyCascade(strategyId);
assert(refsByStrategy(strategyId).length === 0);
assert(!fs.existsSync(pdfFile));            // 文件已删
// 来源库删除同理
deleteSourceCascade(projectId, sourceId);
assert(refsBySource(sourceId).length === 0);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test apps/server/test/delete-cascade.test.ts`
Expected: FAIL（当前只删策略行/无来源删除）

- [ ] **Step 3: 实现级联删除**

DB 删除（策略、批次、文献、判定、全文、提取、图表）在事务内；文件删除在事务外按 referenceId 调 `removeReferenceDir`；`deleteStrategyCascade` 删 `source_query_id = strategyId` 的文献；`deleteSourceCascade` 删该库策略后调用策略级联。项目删除改为调用来源级联 + `removeProjectDir`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test apps/server/test/delete-cascade.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/services/delete.ts apps/server/src/services/strategies.ts apps/server/src/routes/projects.ts apps/server/test/delete-cascade.test.ts
git commit -m "feat(delete): 检索式/来源库/项目级联删除"
```

---

### Task 7: 来源统计与 PRISMA 汇总

**Files:**
- Create: `apps/server/src/services/stats.ts`
- Modify: `apps/server/src/services/prisma.ts`
- Test: `apps/server/test/stats.test.ts`

**Interfaces:**
- Consumes: Task 5 的合并结果。
- Produces:
  - `sourceStats(projectId): Array<{ sourceId; name; rawImported; uniqueKept; duplicateRemoved }>`
  - `buildPrismaSummary(projectId)` 改用 `sourceStats` 计算 `duplicatesRemoved / screened`。

- [ ] **Step 1: 写失败测试**

```ts
// 两个来源：PubMed 2 条（其中 1 条与 Embase 重复）、Embase 1 条
mergeDuplicates(projectId);
const s = sourceStats(projectId);
assert(pubmed.rawImported === 2 && pubmed.uniqueKept === 2); // 最早库全保留
assert(embase.rawImported === 1 && embase.uniqueKept === 0);
const flow = buildPrismaSummary(projectId).flow;
assert(flow.duplicatesRemoved === 1);
assert(flow.screened === 2);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test apps/server/test/stats.test.ts`
Expected: FAIL（无 sourceStats）

- [ ] **Step 3: 实现 `stats.ts` 并改 `prisma.ts`**

`sourceStats` 按 `source_database_id` 分组计数：raw = 全部条数；unique = `is_duplicate=0` 条数；duplicate = raw - unique。`buildPrismaSummary` 的 `duplicatesRemoved` 改为 Σ duplicate，`screened` 改为 Σ unique。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test apps/server/test/stats.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/services/stats.ts apps/server/src/services/prisma.ts apps/server/test/stats.test.ts
git commit -m "feat(stats): 来源库命中统计与 PRISMA 汇总"
```

---

### Task 8: 项目级排除理由

**Files:**
- Create: `apps/server/src/services/exclusionReasons.ts`
- Test: `apps/server/test/exclusion-reasons.test.ts`

**Interfaces:**
- Produces:
  - `listExclusionReasons(projectId): Array<{ id; code; label; isBuiltin; sortOrder }>`
  - `saveExclusionReasons(projectId, reasons: Array<{ id?; code; label; isBuiltin?; sortOrder? }>): void`
  - `seedDefaultExclusionReasons(projectId): void`

- [ ] **Step 1: 写失败测试**

```ts
seedDefaultExclusionReasons('p1');
assert(listExclusionReasons('p1').length > 0);
saveExclusionReasons('p1', [ { code:'custom_1', label:'自定义理由' } ]);
assert(listExclusionReasons('p1').some(r => r.label === '自定义理由'));
assert(listExclusionReasons('p2').length === 0); // 项目隔离
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test apps/server/test/exclusion-reasons.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `exclusionReasons.ts`**

内置 PRISMA 理由播种；`saveExclusionReasons` 全量替换本项目理由（事务内）；自定义 code 用 `custom_<uuid>`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test apps/server/test/exclusion-reasons.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/services/exclusionReasons.ts apps/server/test/exclusion-reasons.test.ts
git commit -m "feat(reasons): 项目级排除理由"
```

---

### Task 9: 修复 `timeoutMs` 持久化

**Files:**
- Modify: `apps/server/src/routes/settings.ts`
- Test: `apps/server/test/settings-timeout.test.ts`

**Interfaces:**
- Consumes: 现有 `providerSchema`。
- Produces: `PUT /api/settings` 保留 provider 的 `timeoutMs`。

- [ ] **Step 1: 写失败测试**

```ts
const provider = { id:'p1', name:'T', kind:'openai-compatible', baseUrl:'http://x', apiKey:'', model:'m', timeoutMs: 30000 };
const saved = saveSettings({ providers:[provider], ...DEFAULT_SETTINGS });
assert(saved.providers[0].timeoutMs === 30000);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test apps/server/test/settings-timeout.test.ts`
Expected: FAIL（timeoutMs 被 zod 丢弃）

- [ ] **Step 3: 实现**

在 `routes/settings.ts` 的 `providerSchema` 增加 `timeoutMs: z.number().int().min(5000).max(600000).optional()`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test apps/server/test/settings-timeout.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/routes/settings.ts apps/server/test/settings-timeout.test.ts
git commit -m "fix(settings): 保存并校验 timeoutMs"
```

---

## Self-Review 结果

- 覆盖 spec 的 Plan 1 范围：数据模型、文件目录、后端核心、排除理由、统计、timeout 修复均有用任务对应；AI 设置与提取重构留给 Plan 2/3。
- Review Focus 5 项分别落在 Task 3、5、6/7、5、9 的测试中。
- 类型/命名跨任务一致：`mergeDuplicates`、`sourceStats`、`deleteStrategyCascade`、`deleteSourceCascade` 在 Tasks 5/6/7 中一致。
