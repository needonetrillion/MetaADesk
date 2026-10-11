import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { DATA_DIR, db } from '../db/client';
import { projects } from '../db/schema';

/** 清洗项目名里的文件系统非法字符，得到可用作文件夹名的前缀 */
export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
  return cleaned || 'project';
}

/** 组成「项目名-短ID」形式的文件夹名 */
export function makeFolderName(name: string, shortId: string): string {
  return `${sanitizeFolderName(name)}-${shortId}`;
}

/** 读取项目在磁盘上的文件夹名（缺失时回退到项目 ID，兼容旧数据） */
export function projectFolderName(projectId: string): string {
  const row = db
    .select({ folderName: projects.folderName })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  return row?.folderName ?? projectId;
}

/** 项目根目录 */
export function projectDir(projectId: string): string {
  return path.join(DATA_DIR, 'projects', projectFolderName(projectId));
}

/** 单篇文献的文件目录 */
export function referenceDir(projectId: string, referenceId: string): string {
  return path.join(projectDir(projectId), 'data', referenceId);
}

/** 原始 PDF 路径 */
export function pdfPath(projectId: string, referenceId: string): string {
  return path.join(referenceDir(projectId, referenceId), 'source.pdf');
}

/** MinerU 转换出的 Markdown 路径 */
export function markdownPath(projectId: string, referenceId: string): string {
  return path.join(referenceDir(projectId, referenceId), 'markdown.md');
}

/** 新建项目目录、data 子目录与 project.json 元数据 */
export function ensureProjectDir(
  projectId: string,
  meta: { name: string; createdAt: string },
): void {
  const dir = projectDir(projectId);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'project.json'),
    JSON.stringify({ id: projectId, ...meta }, null, 2),
    'utf8',
  );
}

/** 删除整个项目目录 */
export function removeProjectDir(projectId: string): void {
  fs.rmSync(projectDir(projectId), { recursive: true, force: true });
}

/** 删除单篇文献目录 */
export function removeReferenceDir(projectId: string, referenceId: string): void {
  fs.rmSync(referenceDir(projectId, referenceId), { recursive: true, force: true });
}
