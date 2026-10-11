export type SourceFormat = 'ris' | 'medline' | 'bibtex';

/** 从题录文件解析出的统一记录 */
export interface ParsedRecord {
  title: string;
  authors: string[];
  abstract: string;
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  url?: string;
  sourceFormat: SourceFormat;
}

/** 去重组 */
export interface DedupGroup {
  groupId: string;
  canonicalIndex: number; // 保留的主条目索引
  itemIndices: number[]; // 组内全部条目索引
}

/** 自动识别题录格式 */
export function detectFormat(text: string): SourceFormat | 'unknown' {
  const lines = text.split(/\r?\n/);
  const first = lines.find((l) => l.trim().length > 0) ?? '';
  if (/^PMID\s*-/i.test(first.trim())) return 'medline';
  if (/^@[a-zA-Z]+\s*\{/.test(first.trim())) return 'bibtex';
  if (/^TY\s+-\s+/i.test(first.trim())) return 'ris';
  return 'unknown';
}
