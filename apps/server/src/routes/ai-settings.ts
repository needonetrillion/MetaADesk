import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  generateExtractionPrompt,
  generateFulltextPrompt,
  generateScreeningPrompt,
  getAiSettings,
  saveAiSettings,
} from '../services/aiSettings';

const aiSettingsSchema = z.object({
  screeningProviderId: z.string().nullable().optional(),
  screeningSystemPrompt: z.string().nullable().optional(),
  fulltextSystemPrompt: z.string().nullable().optional(),
  extractionSystemPrompt: z.string().nullable().optional(),
});

export async function aiSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:projectId/ai-settings', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return getAiSettings(projectId);
  });

  app.put('/api/projects/:projectId/ai-settings', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const parsed = aiSettingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    return saveAiSettings(projectId, parsed.data);
  });

  app.post('/api/projects/:projectId/ai-settings/generate-prompt', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return { prompt: generateScreeningPrompt(projectId) };
  });

  app.post('/api/projects/:projectId/ai-settings/generate-fulltext-prompt', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return { prompt: generateFulltextPrompt(projectId) };
  });

  app.post('/api/projects/:projectId/ai-settings/generate-extraction-prompt', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return { prompt: generateExtractionPrompt(projectId) };
  });
}
