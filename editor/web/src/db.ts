import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DocRecord, OutboxItem, PostMeta } from './types';

interface Schema extends DBSchema {
  posts: { key: string; value: PostMeta };
  docs: { key: string; value: DocRecord };
  outbox: { key: string; value: OutboxItem };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB<Schema>('blog-editor', 1, {
      upgrade(d) {
        d.createObjectStore('posts', { keyPath: 'file' });
        d.createObjectStore('docs', { keyPath: 'file' });
        d.createObjectStore('outbox', { keyPath: 'id' });
      },
    });
  }
  return dbp;
}

/** IndexedDB can be unavailable (private mode); callers treat failures as "not persisted". */
async function safe<T>(fn: (d: IDBPDatabase<Schema>) => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn(await db());
  } catch (e) {
    console.warn('IndexedDB error', e);
    return fallback;
  }
}

export const store = {
  getPosts: () => safe((d) => d.getAll('posts'), [] as PostMeta[]),
  setPosts: (posts: PostMeta[]) =>
    safe(async (d) => {
      const tx = d.transaction('posts', 'readwrite');
      await tx.store.clear();
      for (const p of posts) await tx.store.put(p);
      await tx.done;
    }, undefined),
  getDoc: (file: string) => safe((d) => d.get('docs', file), undefined),
  getAllDocs: () => safe((d) => d.getAll('docs'), [] as DocRecord[]),
  putDoc: (rec: DocRecord) => safe((d) => d.put('docs', rec).then(() => undefined), undefined),
  deleteDoc: (file: string) => safe((d) => d.delete('docs', file), undefined),
  getOutbox: () => safe((d) => d.getAll('outbox'), [] as OutboxItem[]),
  putOutbox: (item: OutboxItem) => safe((d) => d.put('outbox', item).then(() => undefined), undefined),
  deleteOutbox: (id: string) => safe((d) => d.delete('outbox', id), undefined),
};
