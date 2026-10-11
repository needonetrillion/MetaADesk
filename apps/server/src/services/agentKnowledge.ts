import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { count, desc, eq, inArray } from 'drizzle-orm';
import { db, DATA_DIR } from '../db/client';
import { agentKnowledge, agentKnowledgeChunks } from '../db/schema';

export interface AgentKnowledge {
  id: string;
  name: string;
  description: string;
  format: string;
  chunkCount: number;
  createdAt: string;
}

export interface KnowledgeChunk {
  id: string;
  knowledgeId: string;
  chunkIndex: number;
  text: string;
}

const knowledgeRoot = () => path.join(DATA_DIR, 'agent', 'knowledge');

/** 把长文本切成约 size 字、带 overlap 重叠的块 */
export function chunkText(text: string, size = 600, overlap = 100): string[] {
  const paras = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (paras.length === 0) return [];

  const chunks: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && (cur + '\n' + p).length > size) {
      chunks.push(cur);
      const tail = cur.slice(-overlap);
      cur = tail ? `${tail}\n${p}` : p;
    } else {
      cur = cur ? `${cur}\n${p}` : p;
    }
    while (cur.length > size) {
      chunks.push(cur.slice(0, size));
      cur = cur.slice(size - overlap);
    }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

/** 从查询里抽取用于匹配的词元：英文/数字单词 + 中文相邻字 bigram（中文无空格分词，用 bigram 近似） */
function tokenizeForSearch(query: string): string[] {
  const tokens: string[] = [];
  const words = query.match(/[a-z0-9]+/gi) ?? [];
  tokens.push(...words.map((w) => w.toLowerCase()).filter((w) => w.length > 1));

  const cjk = query.match(/[\u4e00-\u9fff]/g) ?? [];
  for (let i = 0; i < cjk.length - 1; i++) {
    tokens.push(cjk[i]! + cjk[i + 1]!);
  }
  return tokens;
}

/** 关键词/BM25 风格检索：词元命中计数 × IDF，返回 Top-K 相关块 */
export function retrieveChunks(query: string, chunks: KnowledgeChunk[], k = 4): KnowledgeChunk[] {
  const tokens = tokenizeForSearch(query);
  if (tokens.length === 0) return [];

  const n = chunks.length;
  // 文档频率：包含该词元的块数，用于 IDF
  const df = new Map<string, number>();
  for (const t of tokens) {
    let c = 0;
    for (const chunk of chunks) {
      if (chunk.text.toLowerCase().includes(t)) c++;
    }
    df.set(t, c);
  }

  const scored = chunks.map((chunk) => {
    const lower = chunk.text.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      let tf = 0;
      let idx = lower.indexOf(t);
      while (idx !== -1) {
        tf += 1;
        idx = lower.indexOf(t, idx + t.length);
      }
      if (tf > 0) {
        const idf = Math.log(1 + n / (df.get(t) ?? 1));
        score += tf * idf;
      }
    }
    return { chunk, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex)
    .slice(0, k)
    .map((x) => x.chunk);
}

export function addKnowledge(input: {
  name: string;
  description: string;
  text: string;
  format: string;
}): AgentKnowledge {
  const name = input.name.trim();
  if (!name) throw new Error('知识名称不能为空');
  const id = randomUUID();
  const dir = path.join(knowledgeRoot(), id);
  fs.mkdirSync(dir, { recursive: true });
  const sourcePath = path.join(dir, 'source.txt');
  fs.writeFileSync(sourcePath, input.text, 'utf8');

  const now = new Date().toISOString();
  db.insert(agentKnowledge)
    .values({
      id,
      name,
      description: input.description.trim(),
      format: input.format,
      sourcePath,
      createdAt: now,
    })
    .run();

  const chunks = chunkText(input.text);
  chunks.forEach((text, index) => {
    db.insert(agentKnowledgeChunks)
      .values({ id: randomUUID(), knowledgeId: id, chunkIndex: index, text })
      .run();
  });

  return { id, name, description: input.description.trim(), format: input.format, chunkCount: chunks.length, createdAt: now };
}

export function listKnowledge(): AgentKnowledge[] {
  return db
    .select()
    .from(agentKnowledge)
    .orderBy(desc(agentKnowledge.createdAt))
    .all()
    .map((row) => {
      const c = db
        .select({ c: count() })
        .from(agentKnowledgeChunks)
        .where(eq(agentKnowledgeChunks.knowledgeId, row.id))
        .get();
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        format: row.format,
        chunkCount: c?.c ?? 0,
        createdAt: row.createdAt,
      };
    });
}

export function deleteKnowledge(id: string): void {
  fs.rmSync(path.join(knowledgeRoot(), id), { recursive: true, force: true });
  db.delete(agentKnowledgeChunks).where(eq(agentKnowledgeChunks.knowledgeId, id)).run();
  db.delete(agentKnowledge).where(eq(agentKnowledge.id, id)).run();
}

export function getChunksByKnowledgeIds(ids: string[]): KnowledgeChunk[] {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(agentKnowledgeChunks)
    .where(inArray(agentKnowledgeChunks.knowledgeId, ids))
    .orderBy(agentKnowledgeChunks.knowledgeId, agentKnowledgeChunks.chunkIndex)
    .all();
}
