import type { FastifyInstance } from 'fastify';
import { sourceStats } from '../services/stats';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:projectId/stats/sources', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return sourceStats(projectId);
  });
}
