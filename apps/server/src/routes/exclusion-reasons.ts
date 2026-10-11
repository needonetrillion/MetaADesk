import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listExclusionReasons,
  saveExclusionReasons,
  suggestExclusionReasons,
} from '../services/exclusionReasons';
import { NoProviderError } from '../services/llm';

const reasonsSchema = z.object({
  reasons: z.array(
    z.object({
      id: z.string().optional(),
      code: z.string().optional(),
      label: z.string().min(1),
      isBuiltin: z.boolean().optional(),
      sortOrder: z.number().optional(),
    }),
  ),
});

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function exclusionReasonsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:projectId/exclusion-reasons', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return listExclusionReasons(projectId);
  });

  app.put('/api/projects/:projectId/exclusion-reasons', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const parsed = reasonsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    try {
      saveExclusionReasons(projectId, parsed.data.reasons);
      return listExclusionReasons(projectId);
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.post('/api/projects/:projectId/exclusion-reasons/suggest', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    try {
      const reasons = await suggestExclusionReasons(projectId);
      return { reasons };
    } catch (err) {
      if (err instanceof NoProviderError) return reply.code(400).send({ error: err.message });
      return reply.code(400).send({ error: errMsg(err) });
    }
  });
}
