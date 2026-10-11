import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createSkill,
  deleteSkill,
  listSkills,
  updateSkill,
} from '../services/agentSkills';

const skillSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  content: z.string(),
});

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function agentSkillsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agent/skills', async () => listSkills());

  app.post('/api/agent/skills', async (req, reply) => {
    const parsed = skillSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    try {
      return createSkill(parsed.data);
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.put('/api/agent/skills/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = skillSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    try {
      return updateSkill(id, parsed.data);
    } catch (err) {
      return reply.code(404).send({ error: errMsg(err) });
    }
  });

  app.delete('/api/agent/skills/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteSkill(id);
    return { ok: true };
  });
}
