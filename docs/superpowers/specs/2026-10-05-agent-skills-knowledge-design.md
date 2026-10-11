# 项目 Agent「技能库 + 知识文档」设计规格

- 状态：已批准（待实现）
- 日期：2026-10-05
- 项目：Meta 分析初筛系统

## 1. 目标

为「项目 Agent」增加两个扩展能力，帮助 Agent 在对话与生成时更贴合用户的方法与知识：

1. **技能（Skill）**：用户自定义的行为规则/方法说明，选中后注入 Agent 上下文，改变其行为。
2. **知识文档（Knowledge）**：用户上传的文档（Markdown / 纯文本 / PDF），Agent 按需检索并引用其中内容。

两者均为**全局一套**（所有项目共享），并采用**按需两段式加载**，避免把全部内容塞进上下文。

## 2. 作用域与加载

- 全局共用，不分项目。
- 上下文只携带「索引清单」（id + 名称 + 一句话描述），不携带完整内容。
- Agent 按需决定加载哪些技能/文档，加载后才注入完整内容。

## 3. 技能（Skill）

- 结构：`name`（名称）、`description`（一句话描述，用于索引与匹配）、`content`（Markdown 正文，行为规则）。
- 管理：新建 / 编辑 / 删除。
- v1 不自动导入 GitHub `SKILL.md` 目录（后续可加导入）。
- 生效方式：Agent 选中某技能后，其 `content` 作为系统提示词的一部分注入。

## 4. 知识文档（Knowledge）

- 支持格式：Markdown（`.md`）、纯文本（`.txt`）、PDF（`.pdf`）。
- PDF 使用**本地文本提取**（如 `pdf-parse`），不依赖 MinerU、不产生费用。
- 上传流程：提取文本 → 切块（每块约 500–800 字，带重叠）→ 存块。
- 检索：关键词/BM25 匹配，取 Top-K 块（默认 K=4）注入上下文。

## 5. Agent 两段式加载流程

```
用户提问
  → Pass1（轻量）：上下文 = 项目上下文 + 技能/知识「索引清单」
      → LLM 输出 { load: [resourceId...] }（要加载哪些，可为空）
  → Pass2：注入所选技能的完整正文 + 所选知识文档的最相关块
      → LLM 生成最终 { reply, action }
```

- 资源 id 需区分类型（技能 / 知识文档）。
- 只作用于**项目 Agent**（对话与快捷按钮）；批量初筛、单篇建议继续使用各自初筛提示词，不受影响。
- 若 Pass1 未加载任何资源，Pass2 等价于当前行为（仅多一次轻量调用）。

## 6. 数据模型

- `agent_skills`：id、name、description、content、createdAt、updatedAt。
- `agent_knowledge`：id、name、description、format、sourcePath、createdAt。
- `agent_knowledge_chunks`：id、knowledgeId、chunkIndex、text。
- 知识文档原文/切块文件存 `data/agent/knowledge/<knowledgeId>/`。

## 7. UI

- 左侧导航新增「技能库」页（与「设置」「使用手册」并列）。
- 分区一「技能」：列表 + 新建/编辑/删除，Markdown 编辑。
- 分区二「知识文档」：列表 + 上传/删除，显示名称、描述、切块数。

## 8. 接口

- 技能：`GET/POST/PUT/DELETE /api/agent/skills`。
- 知识：`GET/POST/DELETE /api/agent/knowledge`（上传时解析并切块）。
- Agent 对话内部改造为两段式加载。

## 9. 测试

- 技能 CRUD。
- 知识上传 → 切块 → 检索（关键词匹配命中预期块）。
- 两段式加载：mock LLM，Pass1 返回 `load`，断言 Pass2 注入了对应技能正文/知识块。
- 无资源时可正常对话（回归）。

## 10. 范围与后续

- v1 不含：向量化/embedding 检索、GitHub SKILL.md 目录自动导入、按项目覆盖。
- 后续可加：embedding 检索、技能导入、技能商店/预设模板。
