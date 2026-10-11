import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  addKnowledge,
  deleteKnowledge,
  listKnowledge,
} from '../services/agentKnowledge';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 从文件内容提取纯文本（PDF 用本地解析，其余按 utf8 解码） */
export async function extractTextFromBuffer(buf: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    return result.text ?? '';
  }
  return buf.toString('utf8');
}

export async function agentKnowledgeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agent/knowledge', async () => listKnowledge());

  app.post('/api/agent/knowledge', async (req, reply) => {
    let file: Buffer | null = null;
    let filename = '';
    let name = '';
    let description = '';
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          file = await part.toBuffer();
          filename = part.filename;
        } else {
          const v = String(part.value ?? '');
          if (part.fieldname === 'name') name = v;
          else if (part.fieldname === 'description') description = v;
        }
      }
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
    if (!file) return reply.code(400).send({ error: '未收到文件' });
    try {
      const text = await extractTextFromBuffer(file, filename);
      const format = path.extname(filename).toLowerCase().replace('.', '') || 'txt';
      return addKnowledge({ name, description, text, format });
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.delete('/api/agent/knowledge/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteKnowledge(id);
    return { ok: true };
  });
}
