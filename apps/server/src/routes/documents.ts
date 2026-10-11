import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NoProviderError } from '../services/llm';
import {
  convertAllDocuments,
  convertDocument,
  createDocument,
  getDocument,
  listDocumentStates,
  MINERU_TIMEOUT_SECONDS,
  readMarkdown,
  resolveImagesDir,
  resolvePdfPath,
} from '../services/documents';
import { applyFulltextDecision, suggestFulltext } from '../services/references';

const decisionSchema = z.object({
  decision: z.enum(['include', 'exclude', 'undecided']),
  reasons: z.array(z.string()).default([]),
  note: z.string().optional(),
});

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function documentsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/references/:id/document', async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: '未收到文件' });
    if (path.extname(file.filename).toLowerCase() !== '.pdf') {
      return reply.code(400).send({ error: '仅支持 PDF 文件' });
    }
    const buf = await file.toBuffer();
    const dest = resolvePdfPath(id);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    try {
      return createDocument(id, dest);
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.get('/api/references/:id/document', async (req) => {
    const { id } = req.params as { id: string };
    return getDocument(id);
  });

  // 返回原始 PDF 文件，供浏览器新标签页查看
  app.get('/api/references/:id/document/file', async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = getDocument(id);
    if (!doc) return reply.code(404).send({ error: '尚未上传全文' });
    if (!fs.existsSync(doc.pdfPath)) return reply.code(404).send({ error: 'PDF 文件不存在' });
    const buf = fs.readFileSync(doc.pdfPath);
    reply.type('application/pdf').send(buf);
  });

  // 返回 MinerU 提取出的图片
  app.get('/api/references/:id/document/images/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const imgPath = path.join(resolveImagesDir(id), name);
    if (!fs.existsSync(imgPath)) return reply.code(404).send({ error: '图片不存在' });
    const ext = path.extname(name).toLowerCase();
    const type = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
    reply.type(type).send(fs.readFileSync(imgPath));
  });

  // 批量查询文档转换状态（前端轮询用；放在 :id 路由之后注册也没问题，路径不同）
  app.post('/api/documents/states', async (req, reply) => {
    const body = z
      .object({ referenceIds: z.array(z.string()).max(500) })
      .safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: '参数错误' });
    return {
      mineruTimeoutSeconds: MINERU_TIMEOUT_SECONDS,
      documents: listDocumentStates(body.data.referenceIds),
    };
  });

  app.post('/api/references/:id/document/convert', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return convertDocument(id);
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  // 批量转换当前项目所有待转换/失败的全文
  app.post('/api/projects/:projectId/documents/convert-all', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    try {
      return convertAllDocuments(projectId);
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.get('/api/references/:id/document/markdown', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return readMarkdown(id);
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.post('/api/references/:id/fulltext/decision', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    try {
      return applyFulltextDecision(id, parsed.data);
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.post('/api/references/:id/fulltext/suggest', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const { markdown } = readMarkdown(id);
      return await suggestFulltext(id, markdown);
    } catch (err) {
      if (err instanceof NoProviderError) {
        return reply.code(400).send({ error: err.message });
      }
      return reply.code(400).send({ error: errMsg(err) });
    }
  });
}
