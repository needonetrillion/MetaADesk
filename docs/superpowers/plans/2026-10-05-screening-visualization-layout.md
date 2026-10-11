# 子项目 A：题录可视化与布局优化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ③ 初筛与 ④ 全文统一提供「文献详情」抽屉（标题/作者/摘要/期刊/DOI/PMID/URL/来源库 + 在线搜索），并修复设置/初筛/全文操作栏溢出。

**Architecture:** 后端新增单条文献详情接口；前端新增共用的 `ReferenceDetailDrawer` 组件，③④ 各自接入；操作列统一用 `Space wrap` + 短文案 + `scroll x`。

**Tech Stack:** TypeScript + Fastify + better-sqlite3 + Drizzle；React + Ant Design。

**Spec:** `docs/superpowers/specs/2026-10-05-screening-visualization-layout-design.md`

## Global Constraints

- 摘要/作者等完整字段走 `GET /api/references/:id`，③④ 列表不重复携带摘要。
- 在线搜索新标签页打开：DOI→doi.org、PMID→pubmed、标题→Google Scholar；字段无值则不显示对应按钮。
- 前端无单测框架：前端任务用 `pnpm -r typecheck` + `pnpm --filter @meta/web build` + 手工冒烟验证。
- 提交信息中文，遵循仓库现有 commit 风格。

## Review Focus

1. 详情接口对不存在/已删除的文献 → 返回 404，前端抽屉显示「文献不存在」而非报错崩溃。→ Task 1/3。
2. 摘要为空 → 抽屉显示「无摘要」占位，不显示空白区。→ Task 3。
3. 在线搜索标题含特殊字符 → URL 正确 `encodeURIComponent`，不会因 `&`/空格截断。→ Task 3。
4. 窄窗口（如 900px）下设置/③/④ 操作栏 → 不横向溢出页面，可换行或横向滚动。→ Task 6。
5. 抽屉打开时接口慢/失败 → 显示加载态与错误态，可关闭重试。→ Task 3。

---

### Task 1: 后端单条文献详情接口

**Files:**
- Modify: `apps/server/src/services/references.ts`
- Modify: `apps/server/src/routes/references.ts`
- Test: `apps/server/test/reference-detail.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReferenceDetail {
    id: string;
    title: string;
    authors: string[];
    abstract: string;
    journal?: string;
    year?: number;
    doi?: string;
    pmid?: string;
    url?: string;
    sourceName?: string;
  }
  export function getReferenceDetail(id: string): ReferenceDetail | null;
  ```

- [ ] **Step 1: 写失败测试** — 新建 `apps/server/test/reference-detail.test.ts`（隔离 `META_DATA_DIR`，导入 service 与 `db`/schema）：seed 一条 reference（含 authors JSON、abstract、journal、year、doi、pmid、url、sourceDatabaseId）和一个 `search_databases` 行，断言 `getReferenceDetail(id)` 返回 title/authors(数组)/abstract/journal/year/doi/pmid/url/sourceName；`getReferenceDetail('missing')` 返回 null。

- [ ] **Step 2: 运行确认失败** — `npx tsx --test apps/server/test/reference-detail.test.ts`，期望 `getReferenceDetail is not a function`。

- [ ] **Step 3: 实现** — 在 `references.ts` 增加 `getReferenceDetail(id)`：查 `references`，`authors` 用 `safeParse` 解析为 `string[]`；若有 `sourceDatabaseId`，查 `search_databases` 取 `name` 作为 `sourceName`。在 `routes/references.ts` 增加 `GET /api/references/:id`：`getReferenceDetail` 为 null 返回 404，否则返回对象。

- [ ] **Step 4: 运行确认通过** — 同上命令，期望 PASS。

- [ ] **Step 5: 提交** — `git add apps/server/src/services/references.ts apps/server/src/routes/references.ts apps/server/test/reference-detail.test.ts && git commit -m "feat(references): 单条文献详情接口"`

---

### Task 2: 前端类型与接口

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReferenceDetail { id: string; title: string; authors: string[]; abstract: string; journal?: string; year?: number; doi?: string; pmid?: string; url?: string; sourceName?: string; }
  // api.getReferenceDetail: (id: string) => request<ReferenceDetail>(`/api/references/${id}`)
  ```

- [ ] **Step 1: 加类型** — `types.ts` 增加 `ReferenceDetail`。
- [ ] **Step 2: 加接口** — `api.ts` 增加 `getReferenceDetail(id)`，并 import `ReferenceDetail`。
- [ ] **Step 3: 验证** — `pnpm --filter @meta/web typecheck` 通过。
- [ ] **Step 4: 提交** — `git add apps/web/src/types.ts apps/web/src/api.ts && git commit -m "feat(web): 文献详情类型与接口"`

---

### Task 3: 共用「文献详情」抽屉组件

**Files:**
- Create: `apps/web/src/components/ReferenceDetailDrawer.tsx`

**Interfaces:**
- Consumes: Task 2 `api.getReferenceDetail`、`ReferenceDetail`。
- Produces: `export default function ReferenceDetailDrawer(props: { referenceId: string | null; onClose: () => void }): JSX`

- [ ] **Step 1: 实现组件** — 用 AntD `Drawer`：`open={!!referenceId}`，`referenceId` 变化时 `getReferenceDetail` 拉取（loading / error 态；error 显示「文献不存在或加载失败」）；展示标题、作者（`join('、')`）、摘要（可滚动，空则「无摘要」）、期刊、年份、DOI、PMID、URL、来源库；「在线搜索」按钮组（DOI/PMID/标题，有值才显示，`window.open` 新标签页，标题用 `encodeURIComponent`）。
- [ ] **Step 2: 验证** — `pnpm --filter @meta/web typecheck` 通过；手工冒烟（见 Task 7）。
- [ ] **Step 3: 提交** — `git add apps/web/src/components/ReferenceDetailDrawer.tsx && git commit -m "feat(web): 文献详情抽屉组件"`

---

### Task 4: ③ 初筛接入抽屉

**Files:**
- Modify: `apps/web/src/pages/project/ScreeningTab.tsx`

**Interfaces:**
- Consumes: Task 3 `ReferenceDetailDrawer`。

- [ ] **Step 1: 接入** — 加 `const [detailId, setDetailId] = useState<string | null>(null)`；「操作」列加「详情」按钮 `setDetailId(r.id)`；标题 `Typography.Text` 加 `onClick` 打开；渲染 `<ReferenceDetailDrawer referenceId={detailId} onClose={() => setDetailId(null)} />`。
- [ ] **Step 2: 验证** — `pnpm --filter @meta/web typecheck` 通过。
- [ ] **Step 3: 提交** — `git add apps/web/src/pages/project/ScreeningTab.tsx && git commit -m "feat(web): 初筛表接入文献详情抽屉"`

---

### Task 5: ④ 全文接入抽屉

**Files:**
- Modify: `apps/web/src/pages/project/FulltextTab.tsx`

**Interfaces:**
- Consumes: Task 3 `ReferenceDetailDrawer`。

- [ ] **Step 1: 接入** — 同 Task 4：加 `detailId` state、操作列「详情」按钮、标题可点击、渲染抽屉。
- [ ] **Step 2: 验证** — `pnpm --filter @meta/web typecheck` 通过。
- [ ] **Step 3: 提交** — `git add apps/web/src/pages/project/FulltextTab.tsx && git commit -m "feat(web): 全文表接入文献详情抽屉"`

---

### Task 6: 操作栏溢出修复

**Files:**
- Modify: `apps/web/src/pages/SettingsPage.tsx`
- Modify: `apps/web/src/pages/project/ScreeningTab.tsx`
- Modify: `apps/web/src/pages/project/FulltextTab.tsx`

**Interfaces:** 无新增。

- [ ] **Step 1: 修复设置页** — Provider 表「操作」列改 `Space wrap`，按钮文案「设为项目 Agent 默认」→「设为默认」；`Table` 加 `scroll={{ x: 'max-content' }}`。
- [ ] **Step 2: 修复 ③ ④ 操作列** — 两个表格「操作」列改为 `Space wrap`（已 wrap 则保留），`Table` 加 `scroll={{ x: 'max-content' }}`，必要时缩窄按钮文案。
- [ ] **Step 3: 排查 ②⑤⑥** — 检查 `StrategiesTab`/`ExtractionTab`/`ResultsTab` 的 `Table` 是否有 `scroll={{ x: 'max-content' }}` 与操作列 `Space wrap`，缺失则补齐（无操作列的表格只补 scroll）。
- [ ] **Step 4: 验证** — `pnpm -r typecheck` 通过；手工冒烟：900px 宽窗口下设置/③/④ 不横向溢出页面。
- [ ] **Step 5: 提交** — `git add apps/web/src/pages/SettingsPage.tsx apps/web/src/pages/project/ScreeningTab.tsx apps/web/src/pages/project/FulltextTab.tsx apps/web/src/pages/project/StrategiesTab.tsx apps/web/src/pages/project/ExtractionTab.tsx apps/web/src/pages/project/ResultsTab.tsx && git commit -m "fix(web): 操作栏溢出与表格横向滚动"`

---

### Task 7: 全量验证

**Files:** 无

- [ ] **Step 1: 全量测试** — `node --import tsx --test apps/server/test/*.test.ts packages/importer/test/*.test.ts packages/core/test/*.test.ts`，期望全部通过。
- [ ] **Step 2: 类型与构建** — `pnpm -r typecheck` 与 `pnpm --filter @meta/web build` 通过。
- [ ] **Step 3: 手工冒烟** — ③④ 打开「详情」显示完整题录与在线搜索；不存在 id 显示错误态；900px 窄窗口操作栏不溢出。
- [ ] **Step 4: 提交（如有残余）** — `git status` 干净则结束。
