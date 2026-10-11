import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NoProviderError } from '../services/llm';
import { buildPrismaSummary } from '../services/prisma';
import {
  exportResultsCSV,
  getExtraction,
  getTemplate,
  listExtractions,
  proposeTemplate,
  runExtraction,
  saveTemplate,
  updateFigure,
} from '../services/extraction';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const fieldDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

export async function extractionRoutes(app: FastifyInstance): Promise<void> {
  // —— 数据提取字段表 ——
  app.get('/api/projects/:projectId/extraction-template', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return getTemplate(projectId);
  });

  app.put('/api/projects/:projectId/extraction-template', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const parsed = z.object({ fields: z.array(fieldDefSchema) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    return saveTemplate(projectId, parsed.data.fields);
  });
  app.post('/api/projects/:projectId/extraction-template/propose', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    try {
      return await proposeTemplate(projectId);
    } catch (err) {
      if (err instanceof NoProviderError) {
        return reply.code(400).send({ error: err.message });
      }
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.post('/api/references/:id/extract', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await runExtraction(id);
    } catch (err) {
      if (err instanceof NoProviderError) {
        return reply.code(400).send({ error: err.message });
      }
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.get('/api/references/:id/extraction', async (req) => {
    const { id } = req.params as { id: string };
    return getExtraction(id);
  });

  app.put('/api/figures/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        status: z.enum(['pending', 'extracted', 'skipped']).optional(),
        extractedValueNote: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    updateFigure(id, parsed.data);
    return { ok: true };
  });

  app.get('/api/projects/:projectId/extractions', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return listExtractions(projectId);
  });

  app.get('/api/projects/:projectId/results/export', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return { csv: exportResultsCSV(projectId) };
  });

  // PRISMA 流程与排除理由汇总
  app.get('/api/projects/:projectId/results/prisma', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return buildPrismaSummary(projectId);
  });
}
