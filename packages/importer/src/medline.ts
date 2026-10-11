import type { ParsedRecord } from './types';

/**
 * PubMed / MEDLINE 文本格式解析。
 * 记录以 "PMID- " 开头，记录之间以空行分隔；
 * 续行以 6 个空格缩进。
 */
export function parseMedline(text: string): ParsedRecord[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  const records: ParsedRecord[] = [];

  for (const block of blocks) {
    if (!/PMID\s*-/.test(block)) continue;
    const lines = block.split('\n');
    const fields: Record<string, string[]> = {};
    let lastTag = '';

    for (const raw of lines) {
      const m = raw.match(/^([A-Z]{1,4})\s*-\s?(.*)$/);
      if (m) {
        lastTag = m[1]!;
        (fields[lastTag] ??= []).push(m[2] ?? '');
      } else if (lastTag && /^\s{6}/.test(raw)) {
        const arr = fields[lastTag];
        if (arr) {
          const idx = arr.length - 1;
          arr[idx] = `${arr[idx]} ${raw.trim()}`;
        }
      }
    }

    const lid = (fields['LID'] ?? fields['AID'] ?? [])
      .join(' ')
      .match(/(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)/i)?.[1];

    records.push({
      title: (fields['TI'] ?? []).join(' ').trim(),
      authors: (fields['FAU'] ?? fields['AU'] ?? [])
        .map((a) => a.trim())
        .filter(Boolean),
      abstract: (fields['AB'] ?? []).join(' ').trim(),
      year: extractMedlineYear((fields['DP'] ?? [])[0]),
      journal: (fields['JT'] ?? fields['TA'] ?? []).join(' ').trim(),
      doi: lid,
      pmid: (fields['PMID'] ?? [])[0]?.trim(),
      url: undefined,
      sourceFormat: 'medline',
    });
  }
  return records;
}

function extractMedlineYear(dp: string | undefined): number | undefined {
  if (!dp) return undefined;
  const m = dp.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : undefined;
}
