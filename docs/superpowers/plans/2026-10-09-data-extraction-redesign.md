# 数据提取重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ⑤ 数据提取从扁平键值重构为「两步、两张表」的结构化流程（原始提取 → 成对整理），所有 AI 结果可编辑，图表数值转交人工。

**Architecture:** 后端新增三张表 + 数据提取服务（原始提取 / 处理组分类 / 成对生成）；前端 ⑤ 改为主从布局（提取工作台 + 成对表两个子视图）。AI 提取用项目级「数据提取提示词」+ 内置方法论，图表数值标记待人工取点。

**Tech Stack:** TypeScript + Fastify + better-sqlite3 + Drizzle；React + Ant Design；图表取点自绘 SVG 组件。

**Spec:** `docs/superpowers/specs/2026-10-09-data-extraction-redesign.md`

## Global Constraints

- 只提取协议「结局指标」里的目标结局 + 背景信息；不提取 pH/EC/温度等非目标指标。
- 表① 分三类：文献信息（研究级）/ 背景信息（组级，含时间/茬次、处理名称）/ 结局信息（结局级数值）。
- 一篇多处理：背景/结局按「组 × 时间/茬次」拆多行；一个对照组可配多个实验组（共享对照组标记）。
- 配对由 AI 建议 + 人工确认；所有 AI 结果可编辑。
- 图表读不出的数值标「待人工提取」，不猜测。
- 前端无单测框架：前端任务用 `pnpm -r typecheck` + `pnpm --filter @meta/web build` + 手工冒烟。
- 提交信息中文，遵循仓库现有 commit 风格。

## Review Focus

1. 一篇文章有 4 个处理组、3 个茬次 → 原始提取产出 3 个研究级字段 + 12 个组级条目 + 对应结局条目，不丢茬次。→ Task 2。
2. 一个对照组配多个实验组 → 成对表生成多条成对条目，且都标记 `sharedControl=true`。→ Task 4。
3. AI 提取返回 JSON 缺字段/格式错误 → 保存前做校验，不落库半截脏数据。→ Task 2/3。
4. 图表取点：用户只点均值未点误差端点 → 给出明确提示而非静默失败。→ Task 8。
5. 成对表导出 CSV 时，中文/逗号/引号 → 正确转义，Excel 打开不乱码。→ Task 4/7。

---

### Task 1: 数据模型（三张表 + DDL）

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/db/ddl.ts`
- Test: `apps/server/test/raw-extraction-schema.test.ts`

**Interfaces:**
- Produces 三张表（字段见下），供后续任务使用：
  - `raw_extractions(id, reference_id UNIQUE, data TEXT, created_at, updated_at)`
  - `treatment_classifications(id, reference_id UNIQUE, data TEXT, created_at, updated_at)`
  - `paired_entries(id, reference_id UNIQUE, data TEXT, created_at, updated_at)`

- [ ] **Step 1: 写失败测试** — 隔离 `META_DATA_DIR` 后导入 `db`/`schema`，断言三张表可 `insert` 一行并读回（`data` 为 JSON 字符串）。
- [ ] **Step 2: 运行确认失败** — `npx tsx --test apps/server/test/raw-extraction-schema.test.ts`，期望 `raw_extractions is not defined`。
- [ ] **Step 3: 实现** — `schema.ts` 增加三张表定义（`data` 用 `text`）；`ddl.ts` 的 `SCHEMA_SQL` 增加三个 `CREATE TABLE IF NOT EXISTS`（`reference_id` 加唯一索引）。
- [ ] **Step 4: 运行确认通过** — 同上命令，期望 PASS。
- [ ] **Step 5: 提交** — `git add apps/server/src/db/schema.ts apps/server/src/db/ddl.ts apps/server/test/raw-extraction-schema.test.ts && git commit -m "feat(extract): 数据提取三张表"`

---

### Task 2: 原始提取服务（表①，含时间/茬次）

**Files:**
- Create: `apps/server/src/services/dataExtraction.ts`
- Modify: `apps/server/src/services/ai.ts`（新增 `extractRawData`）
- Create: `apps/server/src/routes/data-extraction.ts`
- Modify: `apps/server/src/index.ts`（注册路由）
- Test: `apps/server/test/raw-extraction.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RawArm { id: string; name: string; groupType?: 'experiment'|'control'|'other'; dose?: string; material?: string; cn?: string; temperature?: string; time?: string; notes?: string; }
  export interface RawOutcome { id: string; armId: string; outcome: string; n?: string; mean?: string; sd?: string; se?: string; unit?: string; timePoint?: string; note?: string; }
  export interface RawExtraction { study: Record<string,string>; arms: RawArm[]; outcomes: RawOutcome[]; }
  export function getRawExtraction(referenceId: string): RawExtraction | null;
  export function saveRawExtraction(referenceId: string, data: RawExtraction): RawExtraction; // 校验：arms/outcomes 为数组，armId 指向存在的 arm
  export async function runRawExtraction(referenceId: string): Promise<RawExtraction>; // AI，落库并推进状态到 extracted
  ```

- [ ] **Step 1: 写失败测试** — `saveRawExtraction` 落库后 `getRawExtraction` 读回（study 字段、arms 含 time、outcomes 含 armId）；`saveRawExtraction` 对 `outcomes[].armId` 指向不存在 arm 抛错。
- [ ] **Step 2: 运行确认失败** — `Cannot find module '../src/services/dataExtraction'`。
- [ ] **Step 3: 实现** — `ai.ts` 的 `extractRawData({ markdown, outcomes, studyDesign })` 返回 `RawExtraction`（提示词要求：按组 × 时间/茬次拆行、只提目标结局、图表读不出的留空并返回 `figuresPending` 数组）。`dataExtraction.ts` 的 `saveRawExtraction` 校验后 JSON 落库；`runRawExtraction` 读 markdown + 提取提示词 → `extractRawData` → 校验落库 → `setReferenceStatusTx('extracted')`。路由：`GET/PUT /api/references/:id/raw-extraction`、`POST /api/references/:id/raw-extraction/run`。
- [ ] **Step 4: 运行确认通过** — 同上命令，期望 PASS。
- [ ] **Step 5: 提交** — `git add ... && git commit -m "feat(extract): 原始提取服务与路由"`

---

### Task 3: 处理组分类服务（表②，AI 建议配对）

**Files:**
- Modify: `apps/server/src/services/dataExtraction.ts`
- Modify: `apps/server/src/services/ai.ts`（新增 `suggestPairing`）
- Modify: `apps/server/src/routes/data-extraction.ts`
- Test: `apps/server/test/treatment-classification.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TreatmentGroup { name: string; type: 'experiment'|'control'|'other'; }
  export interface Pairing { treatment: string; control: string; }
  export interface TreatmentClassification { groups: TreatmentGroup[]; pairings: Pairing[]; }
  export function getClassification(referenceId: string): TreatmentClassification | null;
  export function saveClassification(referenceId: string, data: TreatmentClassification): TreatmentClassification; // 校验：pairings 中的组名在 groups 中，treatment 是 experiment、control 是 control
  export async function suggestClassification(referenceId: string): Promise<TreatmentClassification>; // AI，不落库，供确认
  ```

- [ ] **Step 1: 写失败测试** — `saveClassification` 读回；pairings 引用了不存在的组名抛错；treatment 组类型不是 experiment 抛错。
- [ ] **Step 2: 运行确认失败** — `Cannot find module '../src/services/dataExtraction'`。
- [ ] **Step 3: 实现** — `ai.ts` `suggestPairing({ arms, protocol })` 根据协议 I/C 建议 groups + pairings。`dataExtraction.ts` 实现 get/save/suggestClassification；`suggestClassification` 读 raw extraction 的 arms 传给 AI。路由：`GET/PUT /api/references/:id/classification`、`POST /api/references/:id/classification/suggest`。
- [ ] **Step 4: 运行确认通过** — 同上命令，期望 PASS。
- [ ] **Step 5: 提交** — `git add ... && git commit -m "feat(extract): 处理组分类与AI配对建议"`

---

### Task 4: 成对条目生成 + 汇总导出

**Files:**
- Modify: `apps/server/src/services/dataExtraction.ts`
- Modify: `apps/server/src/routes/data-extraction.ts`
- Test: `apps/server/test/paired-entries.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PairedEntry { id: string; treatment: string; control: string; outcome: string; treatmentN?: string; controlN?: string; treatmentMean?: string; controlMean?: string; treatmentSd?: string; controlSd?: string; unit?: string; timePoint?: string; sharedControl: boolean; }
  export function generatePairedEntries(referenceId: string): PairedEntry[]; // 由 raw + classification 计算（同一对照配多个实验组均标记 sharedControl）
  export function savePairedEntries(referenceId: string, entries: PairedEntry[]): void;
  export function getPairedEntries(referenceId: string): PairedEntry[];
  export function listPairedEntries(projectId: string): Array<{ referenceId: string; title: string; entries: PairedEntry[] }>;
  export function exportPairedCSV(projectId: string): string; // BOM + 转义
  ```

- [ ] **Step 1: 写失败测试** — 构造 raw（2 实验组 + 1 对照组，2 结局）+ classification（对照配 2 实验组），`generatePairedEntries` 返回 4 条且 `sharedControl` 全为 true；`exportPairedCSV` 含标题并正确转义含逗号的值。
- [ ] **Step 2: 运行确认失败** — `generatePairedEntries is not a function`。
- [ ] **Step 3: 实现** — 按 pairings × 结局展开成条目，从 outcomes 里取对应组数值；`listPairedEntries` 联表 references 取标题；CSV 用 `\uFEFF` + 逗号转义。路由：`POST /api/references/:id/paired-entries/generate`、`GET/PUT /api/references/:id/paired-entries`、`GET /api/projects/:id/paired-entries`、`GET /api/projects/:id/paired-entries/export.csv`。
- [ ] **Step 4: 运行确认通过** — 同上命令，期望 PASS。
- [ ] **Step 5: 提交** — `git add ... && git commit -m "feat(extract): 成对条目生成与导出"`

---

### Task 5: 数据提取提示词（项目级）

**Files:**
- Modify: `apps/server/src/db/schema.ts`（`project_ai_settings` 加 `extraction_system_prompt`）、`ddl.ts`、`client.ts`（ensureColumn）
- Modify: `apps/server/src/services/aiSettings.ts`（`extractionSystemPrompt` + `generateExtractionPrompt`）
- Modify: `apps/server/src/routes/ai-settings.ts`
- Test: `apps/server/test/extraction-prompt.test.ts`

**Interfaces:**
- Produces: `AiSettings.extractionSystemPrompt`；`generateExtractionPrompt(projectId): string`（含三层结构 + 时间/茬次 + 只提目标结局的指令）。

- [ ] **Step 1: 写失败测试** — `saveAiSettings({extractionSystemPrompt:'P'})` 读回；`generateExtractionPrompt` 含「时间」「茬次」「实验组」「对照组」关键词。
- [ ] **Step 2: 运行确认失败** — `generateExtractionPrompt is not a function`。
- [ ] **Step 3: 实现** — 同初筛/全文提示词套路：字段、迁移、service 函数、`generate-prompt` 之外加 `generate-extraction-prompt` 路由。
- [ ] **Step 4: 运行确认通过** — 同上命令，期望 PASS。
- [ ] **Step 5: 提交** — `git add ... && git commit -m "feat(extract): 项目级数据提取提示词"`

---

### Task 6: 前端 ⑤ 主从布局 + 提取工作台

**Files:**
- Create: `apps/web/src/pages/project/ExtractionTab.tsx`（重写）
- Modify: `apps/web/src/types.ts`、`apps/web/src/api.ts`
- Test: 无（typecheck/build）

**Interfaces:**
- Consumes: Task 2/3/4/5 的接口。

- [ ] **Step 1: 类型与接口** — `types.ts` 加 `RawExtraction/RawArm/RawOutcome/TreatmentClassification/PairedEntry`；`api.ts` 加 get/save/run raw、get/save/suggest classification、get/generate/save paired、get/generate/save extraction prompt。
- [ ] **Step 2: 实现工作台** — `ExtractionTab.tsx`：左 = `ft_included` 文献列表（`api.getFulltext` 过滤），右 = 选中文献工作台（题录 + 「AI 提取」按钮 + 表①三区可编辑网格 + 表②分类编辑 + 「AI 建议配对」按钮 + 图表待取点列表）；「提取提示词」设置弹窗。
- [ ] **Step 3: 验证** — `pnpm --filter @meta/web typecheck` + build 通过。
- [ ] **Step 4: 提交** — `git add ... && git commit -m "feat(web): ⑤主从布局与提取工作台"`

---

### Task 7: 前端成对表视图 + 导出

**Files:**
- Modify: `apps/web/src/pages/project/ExtractionTab.tsx`
- Test: 无（typecheck/build）

- [ ] **Step 1: 实现成对表子视图** — ⑤ 顶部 Segmented 切换「提取工作台 / 成对表」；成对表展示全项目成对条目（表格）+「导出 CSV」（`api.exportPairedCSV` 下载）。
- [ ] **Step 2: 验证** — typecheck + build 通过。
- [ ] **Step 3: 提交** — `git add ... && git commit -m "feat(web): 成对表视图与导出"`

---

### Task 8: 图表取点工具

**Files:**
- Create: `apps/web/src/components/FigureDigitizer.tsx`
- Modify: `apps/web/src/pages/project/ExtractionTab.tsx`（接入）
- Test: 无（typecheck/build）

- [ ] **Step 1: 实现取点组件** — SVG 展示用户粘贴/上传的图表图片；线图/柱状图模式：点「均值」+ 点「误差棒一端」得到 SD/SE；点「均值」+ 点「误差棒另一端」同理；输出数值与单位，回填到对应结局字段；未点齐端点时给提示。失败提示可用外部工具后手动回填。
- [ ] **Step 2: 验证** — typecheck + build 通过；手工冒烟：上传一张误差棒图，取点得均值/SD。
- [ ] **Step 3: 提交** — `git add ... && git commit -m "feat(web): 内置图表取点工具"`

---

### Task 9: 全量验证

**Files:** 无

- [ ] **Step 1: 全量测试** — `node --import tsx --test apps/server/test/*.test.ts packages/importer/test/*.test.ts packages/core/test/*.test.ts`，期望全部通过。
- [ ] **Step 2: 类型与构建** — `pnpm -r typecheck` 与 `pnpm --filter @meta/web build` 通过。
- [ ] **Step 3: 手工冒烟** — 选一篇 ft_included 文献 → AI 提取（表① 三区有数据）→ AI 建议配对 → 确认生成成对条目 → 成对表导出 CSV。
- [ ] **Step 4: 提交残余** — `git status` 干净则结束。
