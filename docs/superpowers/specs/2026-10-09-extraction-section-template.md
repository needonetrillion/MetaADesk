# 数据提取：分段式字段模板（更新设计）

- 状态：待评审
- 日期：2026-10-09
- 关联：`docs/superpowers/specs/2026-10-09-data-extraction-redesign.md`

## 1. 目标

把「字段提取设置」从“固定三分区”升级为**用户可自定义增删的分段结构**，支持条件段与按结局重复，并据此从每篇文章提取原始数据，最终整理成「实验组 vs 对照组 并排」的 meta 数据表。

## 2. 分段式字段模板（第 1 层：限定要提什么）

字段模板 = 一组**段（section）**，用户可增删改。每个段：

```ts
interface FieldSection {
  id: string;
  name: string;                       // 段名，如「论文相关」「添加物相关」
  level: 'study' | 'arm' | 'outcome'; // 归属层级
  appliesTo?: 'all' | 'experiment' | 'control'; // 条件段（arm级）：仅实验组/仅对照组/全部
  repeatPerOutcome?: boolean;          // outcome级：是否按结局重复（mean/SD/SE/n 属此类）
  fields: Array<{ key: string; label: string; description?: string }>;
}
```

### 默认示例（对应你给的例子）

| 段 | level | appliesTo | repeatPerOutcome | 字段 |
|---|---|---|---|---|
| 论文相关 | study | — | — | 标题、第一作者、发表年份、文献类型 |
| 背景信息 | arm | all | — | 实验地点、处理名称、是否对照组 |
| 添加物相关 | arm | experiment | — | 添加物类型、用量、碳氮比、独有性质1/2/3 |
| 实验结局相关 | outcome | — | true | mean、SD、SE、n |

- 「添加物相关」`appliesTo=experiment`：对照组（空白对照）没有添加物，AI 不提取这段。
- 「实验结局相关」`repeatPerOutcome=true`：每个结局重复一组 mean/SD/SE/n。

## 3. 原始提取（按段提取，每篇一条）

- study 段 → 每篇一个键值对象。
- arm 段 → 每个处理组一个条目；条件段只在对应组类型下提取。
- outcome 段 → 每个处理组 × 每个结局一组数值。

## 4. 最终 meta 数据（第 2 层：成对 × 结局 横排）

每行 = 一对「实验组 vs 对照组」× 一个结局：

- 论文相关字段（标题/第一作者/年份/类型）
- 背景信息字段（实验地点、处理名称、实验组名、对照组名）
- 实验组添加物性质（类型/用量/碳氮比/独有性质）
- 结局数值：实验组 mean/SD/SE/n ｜ 对照组 mean/SD/SE/n

非空白对照的后续情形，其数据也必须能从原始提取（基础数据表）推导得到。

## 5. 实现要点

- `extraction_field_settings` 的 `data` 结构从 `{study, arm, outcome}` 改为 `sections: FieldSection[]`。
- 原始提取 `raw_extractions` 存 study（键值）+ arms（组 + 值映射）+ outcomes（组 × 结局 + 值映射）。
- AI 提取提示词由段模板动态生成，明确条件段与按结局重复的规则。
- 成对表（paired_entries）改为「实验组/对照组并排」的字段形态。

## 6. 范围

- 本更新只覆盖字段模板结构重构 + 成对表横排形态；效应量计算、非空白对照的组织规则属后续。
