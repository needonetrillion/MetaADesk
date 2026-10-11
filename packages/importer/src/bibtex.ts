import type { ParsedRecord } from './types';

/** 宽松的 BibTeX 解析：按 @type{key, field={...}} 切分条目与字段 */
export function parseBibTeX(text: string): ParsedRecord[] {
  const records: ParsedRecord[] = [];
  const entryRe = /@[a-zA-Z]+\s*\{/g;
  const entries = splitEntries(text);

  for (const entry of entries) {
    const fields = parseFields(entry.body);
    const get = (key: string): string => {
      for (const k of Object.keys(fields)) {
        if (k.toLowerCase() === key) return fields[k]!;
      }
      return '';
    };

    const year = Number((get('year').match(/\b(19|20)\d{2}\b/) ?? [])[0]) || undefined;

    records.push({
      title: get('title'),
      authors: get('author')
        .split(/\s+and\s+/i)
        .map((a) => a.replace(/[{}]/g, '').trim())
        .filter(Boolean),
      abstract: get('abstract'),
      year,
      journal: get('journal') || get('booktitle'),
      doi: get('doi').replace(/^https?:\/\/doi\.org\//i, ''),
      pmid: get('pmid'),
      url: get('url'),
      sourceFormat: 'bibtex',
    });
  }

  return records.filter((r) => r.title || r.doi);
}

interface Entry {
  body: string;
}

function splitEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  let depth = 0;
  let buf = '';
  let started = false;
  let startAt = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (!started) {
      if (ch === '@') {
        started = true;
        startAt = i;
        buf = '';
      }
      continue;
    }
    buf += ch;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        entries.push({ body: buf });
        started = false;
      }
    }
  }
  return entries;
}

function parseFields(body: string): Record<string, string> {
  // 去掉开头 "type{key,"
  const comma = body.indexOf(',');
  const rest = comma >= 0 ? body.slice(comma + 1) : body;
  const fields: Record<string, string> = {};
  let i = 0;
  const n = rest.length;

  while (i < n) {
    // 跳到字段名
    while (i < n && /[\s,}]/.test(rest[i]!)) i++;
    if (i >= n) break;
    const keyMatch = rest.slice(i).match(/^([a-zA-Z0-9_-]+)\s*=/);
    if (!keyMatch) break;
    const key = keyMatch[1]!;
    i += keyMatch[0].length;

    // 跳过空白
    while (i < n && /\s/.test(rest[i]!)) i++;
    if (i >= n) break;

    let value = '';
    if (rest[i] === '{') {
      // 花括号值，需匹配嵌套深度
      let depth = 0;
      i++;
      while (i < n) {
        const c = rest[i]!;
        if (c === '{') depth++;
        else if (c === '}') {
          if (depth === 0) break;
          depth--;
        }
        value += c;
        i++;
      }
      i++; // 跳过闭合 }
    } else if (rest[i] === '"') {
      i++;
      while (i < n && rest[i] !== '"') {
        value += rest[i]!;
        i++;
      }
      i++;
    } else {
      // 裸值到逗号
      while (i < n && rest[i] !== ',') {
        value += rest[i]!;
        i++;
      }
    }
    fields[key] = value.trim();
  }
  return fields;
}
