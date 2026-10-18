import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { healthRoutes } from './routes/health';
import { settingsRoutes } from './routes/settings';
import { projectsRoutes } from './routes/projects';
import { protocolRoutes } from './routes/protocol';
import { databasesRoutes } from './routes/databases';
import { strategiesRoutes } from './routes/strategies';
import { referencesRoutes } from './routes/references';
import { documentsRoutes } from './routes/documents';
import { extractionRoutes } from './routes/extraction';
import { agentRoutes } from './routes/agent';
import { aiSettingsRoutes } from './routes/ai-settings';
import { statsRoutes } from './routes/stats';
import { agentSkillsRoutes } from './routes/agent-skills';
import { agentKnowledgeRoutes } from './routes/agent-knowledge';
import { exclusionReasonsRoutes } from './routes/exclusion-reasons';
import { dataExtractionRoutes } from './routes/data-extraction';
import { ensureDefaultDatabases } from './services/databases';
import { recoverStaleConversions } from './services/documents';

const serverRoot =
  typeof __dirname !== 'undefined'
    ? __dirname
    : fileURLToPath(new URL('../', import.meta.url));

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    bodyLimit: 50 * 1024 * 1024, // 题录导入等大 JSON 正文（默认 1MB 会 413）
  });
  ensureDefaultDatabases();
  // 服务重启后清理僵死的「转换中」记录，否则前端会一直显示转换中
  const recovered = recoverStaleConversions();
  if (recovered > 0) {
    app.log.warn(`已重置 ${recovered} 条因服务重启中断的全文转换任务`);
  }
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  await app.register(healthRoutes);
  await app.register(settingsRoutes);
  await app.register(projectsRoutes);
  await app.register(protocolRoutes);
  await app.register(databasesRoutes);
  await app.register(strategiesRoutes);
  await app.register(referencesRoutes);
  await app.register(documentsRoutes);
  await app.register(extractionRoutes);
  await app.register(agentRoutes);
  await app.register(aiSettingsRoutes);
  await app.register(statsRoutes);
  await app.register(agentSkillsRoutes);
  await app.register(agentKnowledgeRoutes);
  await app.register(exclusionReasonsRoutes);
  await app.register(dataExtractionRoutes);

  // 生产模式：若 web 已构建，则托管静态资源并回退到 index.html
  const webDist = process.env.WEB_DIST
    ? path.resolve(process.env.WEB_DIST)
    : path.resolve(serverRoot, '../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

// 直接运行本文件时启动服务
const isMain =
  typeof __dirname !== 'undefined'
    ? true // CJS 打包：总是作为入口运行
    : process.argv[1] &&
      import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  buildApp()
    .then((app) => app.listen({ port: PORT, host: HOST }))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
