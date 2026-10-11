import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { agentChat, getConversation, quickAction, saveConversation } from '../services/agent';
import { NoProviderError } from '../services/llm';

const messagesSchema = z.array(
  z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  }),
);

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:projectId/agent/history', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return { messages: getConversation(projectId) };
  });

  app.put('/api/projects/:projectId/agent/history', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = z.object({ messages: messagesSchema }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '参数错误' });
    saveConversation(projectId, body.data.messages);
    return { ok: true };
  });

  app.post('/api/projects/:projectId/agent/quick', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = z
      .object({ type: z.enum(['search_strategy', 'extraction_table']) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '参数错误' });
    try {
      const proposals = await quickAction(projectId, body.data.type);
      return { proposals };
    } catch (err) {
      if (err instanceof NoProviderError) {
        return reply.code(400).send({ error: err.message });
      }
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/projects/:projectId/agent/chat', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = z.object({ messages: messagesSchema }).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: '参数错误：缺少 messages' });
    }
    const ctrl = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) ctrl.abort();
    });
    try {
      return await agentChat(projectId, body.data.messages, ctrl.signal);
    } catch (err) {
      if (ctrl.signal.aborted) {
        return reply.code(499).send({ error: '请求已取消' });
      }
      if (err instanceof NoProviderError) {
        return reply.code(400).send({ error: err.message });
      }
      return reply
        .code(502)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
