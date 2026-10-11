import type { ParsedRecord } from './types';

function extractYear(py: string): number | undefined {
  const m = py.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : undefined;
}

/**
 * RIS 题录解析。记录以 "TY  -" 开头，以 "ER  -" 结束；
 * 连续行以 4 个及以上空格缩进表示续行。
 */
export function parseRIS(text: string): ParsedRecord[] {
  const lines = text.split(/\r?\n/);
  const records: ParsedRecord[] = [];
  let current: Record<string, string[]> = {};
  let lastTag = '';

  const flush = () => {
    if (Object.keys(current).length === 0) return;
    const authors = (current['AU'] ?? []).map(cleanAuthor).filter(Boolean);
    const year = extractYear((current['PY'] ?? []).join(' '));
    const an = (current['AN'] ?? []).join(' ').trim();
    records.push({
      title: (current['TI'] ?? []).join(' ').trim(),
      authors,
      abstract: (current['AB'] ?? []).join(' ').trim(),
      year,
      journal: (current['JO'] ?? current['JF'] ?? current['T2'] ?? []).join(' ').trim(),
      doi: (current['DO'] ?? []).join(' ').trim(),
      pmid: /^\d+$/.test(an) ? an : undefined,
      url: (current['UR'] ?? current['L1'] ?? [])[0]?.trim(),
      sourceFormat: 'ris',
    });
    current = {};
    lastTag = '';
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const tagMatch = line.match(/^([A-Z0-9]{2})\s{2}-\s?(.*)$/);
    if (tagMatch) {
      const tag = tagMatch[1]!;
      const value = tagMatch[2] ?? '';
      if (tag === 'TY') flush();
      if (tag === 'ER') {
        flush();
        continue;
      }
      lastTag = tag;
      (current[tag] ??= []).push(value);
    } else if (lastTag && /^\s{4,}/.test(line)) {
      // 续行
      const arr = current[lastTag];
      if (arr) {
        const idx = arr.length - 1;
        arr[idx] = `${arr[idx]} ${line.trim()}`;
      }
    }
  }
  flush();
  return records;
}

function cleanAuthor(a: string): string {
  return a.replace(/[;,]\s*$/, '').trim();
}
