import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { parseReferences, parseReferencesAs } from '@meta/importer';
import { db } from '../db/client';
import { searchStrategies } from '../db/schema';
import { NoProviderError } from '../services/llm';
import { mergeDuplicates } from '../services/merge';
import {
  acceptAiSuggestions,
  applyHumanDecision,
  deleteImportBatch,
  deleteReference,
  deleteReferencesByIds,
  getReferenceDetail,
  importReferences,
  listFulltext,
  listImportBatches,
  listScreening,
  suggestBatch,
  suggestOne,
  type ScreeningFilter,
} from '../services/references';

const decisionSchema = z.object({
  decision: z.enum(['include', 'exclude', 'undecided']),
  reasons: z.array(z.string()).default([]),
  note: z.string().optional(),
});

export async function referencesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/references/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = getReferenceDetail(id);
    if (!detail) return reply.code(404).send({ error: '文献不存在' });
    return detail;
  });

  app.post('/api/projects/:projectId/references/import', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = z
      .object({
        text: z.string().min(1),
        format: z.enum(['ris', 'medline', 'bibtex']).optional(),
        strategyId: z.string().min(1),
        databaseId: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: '请提供题录文本 text 并绑定检索式 strategyId' });
    }
    let parsed;
    try {
      parsed = body.data.format
        ? parseReferencesAs(body.data.text, body.data.format)
        : parseReferences(body.data.text);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : '题录解析失败' });
    }
    if (parsed.length === 0) {
      return reply.code(400).send({ error: '未解析到任何文献记录' });
    }
    // 检索式必须存在且属于本项目
    const strat = db
      .select()
      .from(searchStrategies)
      .where(eq(searchStrategies.id, body.data.strategyId))
      .get();
    if (!strat || strat.projectId !== projectId) {
      return reply.code(400).send({ error: '检索式不存在或不属于当前项目' });
    }
    const databaseId = body.data.databaseId ?? strat.databaseId;
    return importReferences(projectId, parsed, {
      strategyId: body.data.strategyId,
      databaseId,
      format: body.data.format,
    });
  });

  // 文件上传导入（multipart，适合大文件；strategyId 走 query 参数）
  app.post('/api/projects/:projectId/references/import-file', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const strategyId = (req.query as { strategyId?: string }).strategyId;
    if (!strategyId) return reply.code(400).send({ error: '请通过 strategyId 绑定检索式' });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: '未收到文件' });
    const buf = await file.toBuffer();
    const text = buf.toString('utf8');
    let parsed;
    try {
      parsed = parseReferences(text);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : '题录解析失败' });
    }
    if (parsed.length === 0) return reply.code(400).send({ error: '未解析到任何文献记录' });
    const strat = db
      .select()
      .from(searchStrategies)
      .where(eq(searchStrategies.id, strategyId))
      .get();
    if (!strat || strat.projectId !== projectId) {
      return reply.code(400).send({ error: '检索式不存在或不属于当前项目' });
    }
    return importReferences(projectId, parsed, { strategyId, databaseId: strat.databaseId });
  });

  app.get('/api/projects/:projectId/import-batches', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return listImportBatches(projectId);
  });

  app.delete('/api/import-batches/:id', async (req) => {
    const { id } = req.params as { id: string };
    return deleteImportBatch(id);
  });

  app.delete('/api/references/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteReference(id);
    return { ok: true };
  });

  app.post('/api/references/batch-delete', async (req, reply) => {
    const body = z.object({ ids: z.array(z.string()).min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '参数错误' });
    return deleteReferencesByIds(body.data.ids);
  });

  app.get('/api/projects/:projectId/references', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const q = req.query as {
      status?: string;
      search?: string;
      page?: string;
      pageSize?: string;
      includeDuplicates?: string;
    };
    const page = Number.parseInt(q.page ?? '1', 10);
    const pageSize = Number.parseInt(q.pageSize ?? '50', 10);
    return listScreening(projectId, {
      filter: (q.status as ScreeningFilter | undefined) ?? 'all',
      search: q.search,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 50,
      includeDuplicates: q.includeDuplicates === 'true',
    });
  });

  app.get('/api/projects/:projectId/fulltext', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return listFulltext(projectId);
  });

  app.post('/api/references/:id/decision', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: '参数错误', details: parsed.error.flatten() });
    }
    try {
      return applyHumanDecision(id, parsed.data);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/references/:id/suggest', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await suggestOne(id);
    } catch (err) {
      if (err instanceof NoProviderError) {
        return reply.code(400).send({ error: err.message });
      }
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post(
    '/api/projects/:projectId/screening/suggest-batch',
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = z
        .object({
          referenceIds: z.array(z.string()).optional(),
          chunkSize: z.number().int().min(1).max(50).optional(),
          force: z.boolean().optional(),
        })
        .safeParse(req.body ?? {});
      try {
        return await suggestBatch(
          projectId,
          body.success ? body.data.referenceIds : undefined,
          body.success ? body.data.chunkSize : undefined,
          body.success ? body.data.force : undefined,
        );
      } catch (err) {
        if (err instanceof NoProviderError) {
          return reply.code(400).send({ error: err.message });
        }
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post('/api/projects/:projectId/screening/accept-ai', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const body = z
      .object({ referenceIds: z.array(z.string()).optional() })
      .safeParse(req.body ?? {});
    return acceptAiSuggestions(
      projectId,
      body.success ? body.data.referenceIds : undefined,
    );
  });

  // 手动触发去重合并（③ 初筛“重新合并”）
  app.post('/api/projects/:projectId/screening/merge', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return mergeDuplicates(projectId);
  });
}
