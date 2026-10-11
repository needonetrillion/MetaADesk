# 子项目 A：题录可视化 + 统一信息展示 + 布局优化 设计规格

- 状态：已批准（待实现）
- 日期：2026-10-05
- 项目：Meta 分析初筛系统

## 1. 目标

让研究者在 ③ 初筛和 ④ 全文阶段都能看到每篇文献的完整题录（标题、作者、摘要等），并能一键在线查证；同时修复设置/初筛/全文等页面操作栏在窄窗口下溢出边界的问题。

## 2. 范围

- ③ 初筛、④ 全文共用同一个「文献详情」抽屉。
- 后端新增单条文献详情接口。
- 布局溢出修复（设置页 Provider 表、③ 初筛表、④ 全文表，并顺带排查 ②⑤⑥）。
- 不涉及：初筛 AI 队列式判断（子项目 B）、数据提取重构（子项目 C）、提取预设知识入库（子项目 D）。

## 3. 统一「文献详情」抽屉

- 新建 `apps/web/src/components/ReferenceDetailDrawer.tsx`。
- 打开时按需请求 `GET /api/references/:id`，取得完整字段后展示，避免列表接口重复携带摘要。
- 展示字段：标题、作者、摘要（可滚动）、期刊、年份、DOI、PMID、URL、来源库名。
- 「在线搜索」按钮（字段有值才显示，新标签页打开）：
  - DOI → `https://doi.org/<doi>`
  - PMID → `https://pubmed.ncbi.nlm.nih.gov/<pmid>/`
  - 标题 → `https://scholar.google.com/scholar?q=<encodeURIComponent(标题)>`

## 4. ③ 初筛接入

- 每行「操作」列增加「详情」按钮，打开抽屉；标题文本也可点击打开。

## 5. ④ 全文接入

- 每行「操作」列增加「详情」按钮，打开抽屉（上传 PDF 前即可查看完整题录）。

## 6. 布局优化

- 设置页 Provider 表、③ 初筛表、④ 全文表的「操作」列：
  - 用 `Space wrap` 换行；
  - 缩短按钮文案（如「设为默认」）；
  - 表格加 `scroll={{ x: 'max-content' }}`，窄窗口横向滚动而非溢出页面。
- 顺带检查 ②⑤⑥ 是否存在同类溢出，统一处理。

## 7. 后端新增接口

- `GET /api/references/:id`：返回单条文献完整题录，字段包括 title、authors、abstract、journal、year、doi、pmid、url、sourceName（来源库名）。

## 8. 测试

- 后端：`GET /api/references/:id` 返回完整字段；不存在时 404。
- 前端无单测框架：`pnpm -r typecheck` + `pnpm --filter @meta/web build` + 手工冒烟（③④ 打开抽屉显示摘要，在线搜索新标签页打开，窄窗口操作栏不溢出）。
