import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  clearExtraction,
  exportPairedCSV,
  generatePairedEntries,
  getClassification,
  getPairedEntries,
  getRawExtraction,
  listPairedEntries,
  runRawExtraction,
  saveClassification,
  savePairedEntries,
  saveRawExtraction,
  suggestClassification,
} from '../services/dataExtraction';
import {
  generateFieldSettings,
  getFieldSettings,
  saveFieldSettings,
} from '../services/extractionFieldSettings';
import { NoProviderError } from '../services/llm';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const rawSchema = z.object({
  study: z.record(z.string(), z.string()),
  arms: z.array(z.object({ id: z.string(), values: z.record(z.string(), z.string()) })),
  outcomes: z.array(z.object({ id: z.string(), armId: z.string(), outcome: z.string(), values: z.record(z.string(), z.string()) })),
});

const classificationSchema = z.object({
  groups: z.array(z.object({ name: z.string(), type: z.enum(['experiment', 'control', 'other']) })),
  pairings: z.array(z.object({ treatment: z.string(), control: z.string() })),
});

const pairedSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      treatment: z.string(),
      control: z.string(),
      outcome: z.string(),
      treatmentN: z.string().optional(),
      controlN: z.string().optional(),
      treatmentMean: z.string().optional(),
      controlMean: z.string().optional(),
      treatmentSd: z.string().optional(),
      controlSd: z.string().optional(),
      unit: z.string().optional(),
      timePoint: z.string().optional(),
      sharedControl: z.boolean(),
    }),
  ),
});

const fieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
});

const fieldSettingsSchema = z.object({
  sections: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      level: z.enum(['study', 'arm', 'outcome']),
      appliesTo: z.enum(['all', 'experiment', 'control']).optional(),
      repeatPerOutcome: z.boolean().optional(),
      fields: z.array(fieldSchema),
    }),
  ),
});

export async function dataExtractionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/references/:id/raw-extraction', async (req) => {
    const { id } = req.params as { id: string };
    return getRawExtraction(id);
  });

  app.put('/api/references/:id/raw-extraction', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = rawSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    try {
      return saveRawExtraction(id, parsed.data);
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.post('/api/references/:id/raw-extraction/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await runRawExtraction(id);
    } catch (err) {
      if (err instanceof NoProviderError) return reply.code(400).send({ error: err.message });
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.delete('/api/references/:id/extraction', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return clearExtraction(id);
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.get('/api/references/:id/classification', async (req) => {
    const { id } = req.params as { id: string };
    return getClassification(id);
  });

  app.put('/api/references/:id/classification', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = classificationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    try {
      return saveClassification(id, parsed.data);
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.post('/api/references/:id/classification/suggest', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await suggestClassification(id);
    } catch (err) {
      if (err instanceof NoProviderError) return reply.code(400).send({ error: err.message });
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.get('/api/references/:id/paired-entries', async (req) => {
    const { id } = req.params as { id: string };
    return { entries: getPairedEntries(id) };
  });

  app.put('/api/references/:id/paired-entries', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = pairedSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    savePairedEntries(id, parsed.data.entries);
    return { ok: true };
  });

  app.post('/api/references/:id/paired-entries/generate', async (req) => {
    const { id } = req.params as { id: string };
    const entries = generatePairedEntries(id);
    savePairedEntries(id, entries);
    return { entries };
  });

  app.get('/api/projects/:projectId/paired-entries', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return listPairedEntries(projectId);
  });

  app.get('/api/projects/:projectId/paired-entries/export.csv', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    reply.type('text/csv; charset=utf-8').send(exportPairedCSV(projectId));
  });

  app.get('/api/projects/:projectId/extraction-field-settings', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return getFieldSettings(projectId);
  });

  app.put('/api/projects/:projectId/extraction-field-settings', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const parsed = fieldSettingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    return saveFieldSettings(projectId, parsed.data);
  });

  app.post('/api/projects/:projectId/extraction-field-settings/generate', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return generateFieldSettings(projectId);
  });
}
