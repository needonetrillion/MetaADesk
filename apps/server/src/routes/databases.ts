import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addSource, listProjectSources, PRESET_DATABASES } from '../services/sources';
import { deleteSourceCascade } from '../services/delete';
import { SEARCH_SKILLS } from '../services/searchSkills';

const sourceSchema = z.object({
  presetKey: z.string().optional(),
  name: z.string().min(1),
  url: z.string().optional(),
  note: z.string().optional(),
});

export async function databasesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:projectId/databases', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return listProjectSources(projectId);
  });

  app.get('/api/search-skills', async () => SEARCH_SKILLS);

  app.get('/api/databases/presets', async () => PRESET_DATABASES);

  app.post('/api/projects/:projectId/databases', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const parsed = sourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    return addSource(projectId, parsed.data);
  });

  app.delete('/api/projects/:projectId/databases/:sourceId', async (req) => {
    const { projectId, sourceId } = req.params as { projectId: string; sourceId: string };
    return deleteSourceCascade(projectId, sourceId);
  });
}
