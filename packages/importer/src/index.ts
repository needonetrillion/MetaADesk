import { parseBibTeX } from './bibtex';
import { parseMedline } from './medline';
import { parseRIS } from './ris';
import { detectFormat } from './types';
import type { ParsedRecord, SourceFormat } from './types';

export * from './types';
export {
  normalizeTitle,
  buildDedupGroups,
  dedupKeyOf,
  makeDedupGroupId,
} from './dedup';
export type { DedupItem } from './dedup';

/** 自动识别格式并解析题录 */
export function parseReferences(text: string): ParsedRecord[] {
  const format = detectFormat(text);
  switch (format) {
    case 'ris':
      return parseRIS(text);
    case 'medline':
      return parseMedline(text);
    case 'bibtex':
      return parseBibTeX(text);
    default:
      throw new Error(
        '无法识别的题录格式，请提供 RIS、PubMed(.txt) 或 BibTeX 文件',
      );
  }
}

export function parseReferencesAs(
  text: string,
  format: SourceFormat,
): ParsedRecord[] {
  switch (format) {
    case 'ris':
      return parseRIS(text);
    case 'medline':
      return parseMedline(text);
    case 'bibtex':
      return parseBibTeX(text);
    default: {
      const never: never = format;
      throw new Error(`未知格式: ${String(never)}`);
    }
  }
}
