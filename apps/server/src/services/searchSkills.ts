/**
 * 各数据库检索式规则（skill）。
 * 项目 Agent 与「② 检索策略」生成检索式时，按数据库 id 取对应规则。
 * 注意：CNKI / 万方等中文库平台版本较多，字段代码以 verifyNote 提示人工核对。
 */

export interface SearchSkill {
  id: string;
  name: string;
  /** 字段限定写法 */
  fieldSyntax: string;
  /** 布尔运算符与截词 */
  operators: string;
  /** 同一字段内多个同义词的 OR 写法 */
  orWithinField: string;
  /** 完整可复制示例 */
  example: string;
  /** 生成时需注意 / 核对事项 */
  guidance: string;
  verifyNote?: string;
}

export const SEARCH_SKILLS: SearchSkill[] = [
  {
    id: 'db-pubmed',
    name: 'PubMed',
    fieldSyntax: '用字段标签加方括号：[tiab]（题名+摘要）、[ti]、[ab]、[MeSH Terms]/[mh]、[pt]（文献类型）',
    operators: 'AND / OR / NOT（大写）；截词用 *（如 therap*）',
    orWithinField: '"A"[tiab] OR "B"[tiab] OR "C"[tiab]',
    example:
      '("heart failure"[MeSH Terms] OR "heart failure"[tiab]) AND (therap*[tiab] OR treat*[tiab] OR manag*[tiab])',
    guidance:
      '优先用 MeSH 词 + [tiab] 同义词；每个概念同义词控制在 3–5 个；研究设计可用 [pt] 或过滤器，不必塞进检索式。',
  },
  {
    id: 'db-scopus',
    name: 'Scopus',
    fieldSyntax: '用字段代码加圆括号：TITLE-ABS-KEY(...)、TITLE(...)、ABS(...)、KEY(...)、DOCTYPE(...)、PUBYEAR',
    operators: 'AND / OR / AND NOT；截词用 *；精确短语用 { }，宽松短语用 " "',
    orWithinField: 'TITLE-ABS-KEY("A") OR TITLE-ABS-KEY("B")',
    example:
      '( TITLE-ABS-KEY ( "heart failure" ) OR TITLE-ABS-KEY ( "cardiac failure" ) ) AND ( TITLE-ABS-KEY ( therap* ) OR TITLE-ABS-KEY ( treat* ) )',
    guidance: '每个概念同义词 3–5 个即可；Scopus 对括号数量敏感，务必成对。',
  },
  {
    id: 'db-wos',
    name: 'Web of Science',
    fieldSyntax: '用字段标识加等号：TS=（主题）、TI=、AB=、AK=（作者关键词）、KP=（Keywords Plus）、SO=（来源）、PY=、DT=',
    operators: 'AND / OR / NOT（大写）；截词 *（任意）、?（1 字符）、$（0–1 字符）；短语用双引号',
    orWithinField: 'TS=("A" OR "B" OR "C")',
    example:
      'TS=("heart failure" OR "cardiac failure") AND (TS=(therap* OR treat* OR manag*))',
    guidance: '主题用 TS= 即可覆盖题名/摘要/关键词；同义词集中在一个 TS=(...) 里，用 OR 连接。',
  },
  {
    id: 'db-cnki',
    name: 'CNKI (中国知网)',
    fieldSyntax: '用英文字段代码：SU（主题=篇名+关键词+摘要）、TI（篇名）、KY（关键词）、AB（摘要）、FT（全文）',
    operators: 'AND / OR / NOT（大写，前后留空格）；截词用 *、?',
    orWithinField: "SU=('A'+'B'+'C')   ← 同字段同义词用单引号括词、加号 + 连接（不是 OR）",
    example:
      "SU=('好氧堆肥'+'堆肥'+'高温堆肥') AND SU=('沸石'+'改性沸石') AND SU=('氨挥发'+'氮素损失'+'N2O')",
    guidance:
      '务必用 SU= / TI= 等字段代码，不要写「主题=」；同义词用单引号+加号，不要用双引号+OR；每个概念 3–5 个同义词即可。',
    verifyNote: '知网分「专业检索」与「高级检索」，本规则按「专业检索」语法；如平台版本不同请以页面提示为准。',
  },
  {
    id: 'db-wanfang',
    name: '万方',
    fieldSyntax: '用字段名加冒号：主题:、题名:、关键词:、摘要:、作者:',
    operators: 'AND / OR / NOT；截词用 *；短语可用双引号',
    orWithinField: '主题:(A OR B OR C)',
    example: '主题:(好氧堆肥 OR 堆肥 OR 高温堆肥) AND 主题:(沸石 OR 改性沸石) AND 主题:(氨挥发 OR N2O)',
    guidance: '主题: 已覆盖题名/关键词/摘要；每个概念同义词 3–5 个。',
    verifyNote: '万方「专业检索」字段名与运算符请以平台实际提示为准（不同版本有差异）。',
  },
];

export function getSearchSkill(databaseId: string, databaseName?: string): SearchSkill | undefined {
  return (
    SEARCH_SKILLS.find((s) => s.id === databaseId) ??
    SEARCH_SKILLS.find((s) => s.name.toLowerCase() === (databaseName ?? '').toLowerCase())
  );
}
