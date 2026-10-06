// IndexedDB persistence. Riffs live in their own store; everything else is small key/value settings.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Setup } from '../theory/music';
import type { TabNote } from '../theory/stream';

export interface Riff {
  id: string;
  name: string;
  notes: TabNote[];
  setup: Setup;
  createdAt: number;
  /** Ordering key: bumped on restore so restored riffs return to the top, as the design did. */
  ts: number;
  deletedAt?: number;
}

interface FretlineDB extends DBSchema {
  riffs: { key: string; value: Riff };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<FretlineDB>> | null = null;
const db = () =>
  (dbp ??= openDB<FretlineDB>('fretline', 1, {
    upgrade(d) {
      d.createObjectStore('riffs', { keyPath: 'id' });
      d.createObjectStore('kv');
    },
  }));

export async function loadRiffs(): Promise<Riff[]> {
  return (await db()).getAll('riffs');
}
export async function putRiff(r: Riff) {
  await (await db()).put('riffs', r);
}
export async function putRiffs(rs: Riff[]) {
  const tx = (await db()).transaction('riffs', 'readwrite');
  await Promise.all([...rs.map((r) => tx.store.put(r)), tx.done]);
}
export async function deleteRiffs(ids: string[]) {
  const tx = (await db()).transaction('riffs', 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await db()).get('kv', key) as Promise<T | undefined>;
}
export async function setKV(key: string, v: unknown) {
  await (await db()).put('kv', v, key);
}

/**
 * One-time import from the prototype's localStorage keys. Its two sample riffs (ids s1/s2) were
 * demo content and are not carried over.
 */
export async function migrateLegacy(): Promise<void> {
  if (await getKV('migrated')) return;
  const read = (k: string) => {
    try {
      return JSON.parse(localStorage.getItem(k) ?? 'null');
    } catch {
      return null;
    }
  };
  const now = Date.now();
  const conv = (r: { id: string; name: string; notes: TabNote[]; setup?: Setup }, i: number, deleted: boolean): Riff => ({
    id: r.id,
    name: r.name,
    notes: r.notes,
    setup: r.setup ?? { offsets: [0, 0, 0, 0, 0, 0], capo: 0 },
    createdAt: now - i,
    ts: now - i,
    ...(deleted ? { deletedAt: now - i } : {}),
  });
  const ok = (r: unknown): r is { id: string; name: string; notes: TabNote[] } =>
    !!r && typeof r === 'object' && Array.isArray((r as { notes?: unknown }).notes) && !['s1', 's2'].includes((r as { id: string }).id);
  const saved = (read('fretline.riffs') ?? []) as unknown[];
  const deleted = (read('fretline.riffs.deleted') ?? []) as unknown[];
  const riffs = [
    ...(Array.isArray(saved) ? saved.filter(ok).map((r, i) => conv(r, i, false)) : []),
    ...(Array.isArray(deleted) ? deleted.filter(ok).map((r, i) => conv(r, i, true)) : []),
  ];
  if (riffs.length) await putRiffs(riffs);
  const su = read('fretline.setup');
  if (su && Array.isArray(su.offsets) && su.offsets.length === 6 && !(await getKV('setup')))
    await setKV('setup', { offsets: su.offsets.map(Number), capo: +su.capo || 0 });
  await setKV('migrated', true);
}

// ---- export / import

export interface RiffFile {
  app: 'fretline';
  version: 1;
  riffs: Riff[];
}

export function exportFile(riffs: Riff[]): Blob {
  const body: RiffFile = { app: 'fretline', version: 1, riffs };
  return new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
}

/** Validates an export and gives every incoming riff a fresh id so imports never overwrite. */
export function parseFile(text: string): Riff[] {
  const j = JSON.parse(text) as Partial<RiffFile>;
  if (j.app !== 'fretline' || !Array.isArray(j.riffs)) throw new Error('Not a Fretline riff file');
  const now = Date.now();
  return j.riffs
    .filter((r) => r && Array.isArray(r.notes) && typeof r.name === 'string')
    .map((r, i) => ({
      id: 'r' + now.toString(36) + i + Math.random().toString(36).slice(2, 6),
      name: r.name,
      notes: r.notes.filter((n) => Number.isFinite(n.s) && Number.isFinite(n.f) && Number.isFinite(n.t)).map(({ s, f, t }) => ({ s, f, t })),
      setup: r.setup && Array.isArray(r.setup.offsets) ? r.setup : { offsets: [0, 0, 0, 0, 0, 0], capo: 0 },
      createdAt: r.createdAt ?? now - i,
      ts: now - i,
    }));
}
