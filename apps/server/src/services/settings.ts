import type { ProviderConfig } from '@meta/llm';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { settings } from '../db/schema';

export interface AppSettings {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  screeningProviderId: string | null;
  mineruToken: string;
  mineruBaseUrl?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  providers: [],
  activeProviderId: null,
  screeningProviderId: null,
  mineruToken: '',
  mineruBaseUrl: 'https://mineru.net/api/v4',
};

export function getSettings(): AppSettings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(row.data) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(next: AppSettings): AppSettings {
  const data = JSON.stringify(next);
  db.insert(settings)
    .values({ id: 1, data })
    .onConflictDoUpdate({ target: settings.id, set: { data } })
    .run();
  return getSettings();
}
