import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { searchDatabases } from '../db/schema';
import { generateSearchQuery } from '../services/ai';
import { NoProviderError } from '../services/llm';
import { getProtocol } from '../services/protocol';
import {
  createStrategy,
  deleteStrategy,
  listStrategies,
  updateStrategy,
} from '../services/strategies';

const createSchema = z.object({
  databaseId: z.string().min(1),
  query: z.string().min(1),
  notes: z.string().optional(),
  generatedBy: z.enum(['ai', 'manual']).default('manual'),
});

export async function strategiesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:projectId/strategies', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return listStrategies(projectId);
  });

  app.post('/api/projects/:projectId/strategies', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: '参数错误', details: parsed.error.flatten() });
    }
    return createStrategy(projectId, parsed.data);
  });

  app.put('/api/strategies/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ query: z.string().min(1), notes: z.string().optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    updateStrategy(id, parsed.data);
    return { ok: true };
  });

  app.delete('/api/strategies/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteStrategy(id);
    return { ok: true };
  });

  app.post(
    '/api/projects/:projectId/strategies/generate',
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = z
        .object({ databaseId: z.string().min(1) })
        .safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: '参数错误' });

      const dbRow = db
        .select()
        .from(searchDatabases)
        .where(eq(searchDatabases.id, body.data.databaseId))
        .get();
      if (!dbRow) return reply.code(404).send({ error: '数据库不存在' });

      const proto = getProtocol(projectId);
      if (!proto) {
        return reply
          .code(400)
          .send({ error: '请先制定协议（至少填写 PICO 要素）再生成检索式' });
      }

      try {
        const result = await generateSearchQuery({
          databaseId: dbRow.id,
          databaseName: dbRow.name,
          pico: proto.pico,
        });
        return {
          ...result,
          databaseId: dbRow.id,
          databaseName: dbRow.name,
        };
      } catch (err) {
        if (err instanceof NoProviderError) {
          return reply.code(400).send({ error: err.message });
        }
        return reply
          .code(502)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
