import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createLLMClient, PROVIDER_PRESETS } from '@meta/llm';
import { testMineruConnection } from '@meta/mineru';
import { getSettings, saveSettings } from '../services/settings';

const providerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['openai-compatible', 'anthropic']),
  baseUrl: z.string().min(1),
  apiKey: z.string().default(''),
  model: z.string().min(1),
  temperature: z.number().optional(),
  timeoutMs: z.number().int().min(5000).max(600000).optional(),
});

const settingsSchema = z.object({
  providers: z.array(providerSchema),
  activeProviderId: z.string().nullable(),
  screeningProviderId: z.string().nullable(),
  mineruToken: z.string().default(''),
  mineruBaseUrl: z.string().optional(),
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => getSettings());

  app.put('/api/settings', async (req, reply) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: '参数错误', details: parsed.error.flatten() });
    }
    return saveSettings(parsed.data);
  });

  app.get('/api/settings/presets', async () => PROVIDER_PRESETS);

  app.post('/api/settings/test-llm', async (req, reply) => {
    const parsed = providerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: '参数错误', details: parsed.error.flatten() });
    }
    try {
      const client = createLLMClient(parsed.data);
      const replyText = await client.complete([
        {
          role: 'user',
          content: '请只回复一行：<你的模型名称或版本> 收到。不要输出任何其他文字。',
        },
      ]);
      return { ok: true, reply: replyText };
    } catch (err) {
      return reply.code(502).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/settings/test-mineru', async (req) => {
    const body = z
      .object({ token: z.string().optional(), baseUrl: z.string().optional() })
      .safeParse(req.body ?? {});
    const settings = getSettings();
    const token = body.success ? (body.data.token ?? settings.mineruToken) : settings.mineruToken;
    const baseUrl = body.success ? (body.data.baseUrl ?? settings.mineruBaseUrl) : settings.mineruBaseUrl;
    return testMineruConnection({ token, baseUrl });
  });
}
