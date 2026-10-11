import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { count, desc, eq, inArray } from 'drizzle-orm';
import { db, inTransaction, DATA_DIR } from '../db/client';
import { removeProjectDir, ensureProjectDir, projectDir, makeFolderName } from '../services/files';
import { seedDefaultExclusionReasons } from '../services/exclusionReasons';
import { seedDefaultSources } from '../services/sources';
import {
  agentConversations,
  documents,
  exclusionReasons,
  extractionTemplates,
  extractions,
  figures,
  importBatches,
  projects,
  protocols,
  references,
  screenDecisions,
  searchDatabases,
  searchStrategies,
} from '../db/schema';

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const renameSchema = z.object({
  name: z.string().min(1),
});

export async function projectsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', async () => {
    const rows = db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt))
      .all();
    return rows.map((p) => {
      const row = db
        .select({ c: count() })
        .from(references)
        .where(eq(references.projectId, p.id))
        .get();
      return { ...p, referenceCount: row?.c ?? 0 };
    });
  });

  app.post('/api/projects', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: '参数错误' });
    }
    const now = new Date().toISOString();
    const folderName = makeFolderName(parsed.data.name, randomUUID().slice(0, 6));
    const project = {
      id: randomUUID(),
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      folderName,
      createdAt: now,
    };
    db.insert(projects).values(project).run();
    ensureProjectDir(project.id, { name: project.name, createdAt: now });
    seedDefaultExclusionReasons(project.id);
    seedDefaultSources(project.id);
    return { ...project, referenceCount: 0 };
  });

  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!p) return reply.code(404).send({ error: '项目不存在' });
    return p;
  });

  app.patch('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: '参数错误' });
    }
    const p = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!p) return reply.code(404).send({ error: '项目不存在' });

    const newName = parsed.data.name;
    const shortId = (p.folderName?.split('-').pop()) || id.slice(0, 6);
    const newFolderName = makeFolderName(newName, shortId);
    const oldDir = projectDir(id);
    const newDir = path.join(DATA_DIR, 'projects', newFolderName);

    // 先改磁盘目录（不可回滚副作用放事务外），再写库
    if (oldDir !== newDir) {
      fs.renameSync(oldDir, newDir);
      const metaPath = path.join(newDir, 'project.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { name?: string };
        meta.name = newName;
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
      }
    }

    db.update(projects)
      .set({ name: newName, folderName: newFolderName })
      .where(eq(projects.id, id))
      .run();

    const refCount = db
      .select({ c: count() })
      .from(references)
      .where(eq(references.projectId, id))
      .get();
    return { ...p, name: newName, folderName: newFolderName, referenceCount: refCount?.c ?? 0 };
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!p) return reply.code(404).send({ error: '项目不存在' });

    const refs = db
      .select({ id: references.id })
      .from(references)
      .where(eq(references.projectId, id))
      .all();
    const refIds = refs.map((r) => r.id);

    // 先删本地文件（不可回滚的副作用放在事务外）
    if (refIds.length) {
      const docs = db
        .select({ pdfPath: documents.pdfPath, markdownPath: documents.markdownPath })
        .from(documents)
        .where(inArray(documents.referenceId, refIds))
        .all();
      for (const d of docs) {
        if (d.pdfPath) fs.rmSync(d.pdfPath, { force: true });
        if (d.markdownPath) fs.rmSync(d.markdownPath, { force: true });
      }
    }

    // 一次事务删除所有项目级数据，避免中途异常留下孤儿行
    inTransaction((tx) => {
      if (refIds.length) {
        tx.delete(screenDecisions).where(inArray(screenDecisions.referenceId, refIds)).run();
        tx.delete(figures).where(inArray(figures.referenceId, refIds)).run();
        tx.delete(extractions).where(inArray(extractions.referenceId, refIds)).run();
        tx.delete(documents).where(inArray(documents.referenceId, refIds)).run();
        tx.delete(references).where(inArray(references.id, refIds)).run();
      }
      tx.delete(references).where(eq(references.projectId, id)).run();
      tx.delete(protocols).where(eq(protocols.projectId, id)).run();
      tx.delete(searchStrategies).where(eq(searchStrategies.projectId, id)).run();
      tx.delete(searchDatabases).where(eq(searchDatabases.projectId, id)).run();
      tx.delete(exclusionReasons).where(eq(exclusionReasons.projectId, id)).run();
      // 以下三张表也带 projectId，之前漏删会留下孤儿数据
      tx.delete(importBatches).where(eq(importBatches.projectId, id)).run();
      tx.delete(extractionTemplates).where(eq(extractionTemplates.projectId, id)).run();
      tx.delete(agentConversations).where(eq(agentConversations.projectId, id)).run();
      tx.delete(projects).where(eq(projects.id, id)).run();
    });
    removeProjectDir(id);
    return { ok: true };
  });
}
