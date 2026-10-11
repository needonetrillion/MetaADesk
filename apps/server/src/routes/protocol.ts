import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateProtocolDraft } from '../services/ai';
import { NoProviderError } from '../services/llm';
import {
  formatProtocolText,
  getProtocol,
  saveProtocol,
} from '../services/protocol';

const protocolSchema = z.object({
  title: z.string(),
  objective: z.string(),
  pico: z.object({
    population: z.string(),
    intervention: z.string(),
    comparison: z.string(),
    outcome: z.string(),
    studyDesign: z.string().optional(),
  }),
  criteria: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['inclusion', 'exclusion']),
      text: z.string(),
    }),
  ),
  outcomes: z.array(z.string()),
});

export async function protocolRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:projectId/protocol', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return getProtocol(projectId);
  });

  app.put('/api/projects/:projectId/protocol', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const parsed = protocolSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: '参数错误', details: parsed.error.flatten() });
    }
    return saveProtocol(projectId, parsed.data);
  });

  app.post('/api/projects/:projectId/protocol/generate', async (req, reply) => {
    const body = z
      .object({ researchQuestion: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: '请提供研究问题 researchQuestion' });
    }
    try {
      return await generateProtocolDraft(body.data.researchQuestion);
    } catch (err) {
      if (err instanceof NoProviderError) {
        return reply.code(400).send({ error: err.message });
      }
      return reply
        .code(502)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/projects/:projectId/protocol/export', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const proto = getProtocol(projectId);
    if (!proto) return reply.code(404).send({ error: '尚未制定协议' });
    return { text: formatProtocolText(proto), title: proto.title };
  });
}
