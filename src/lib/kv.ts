// Tiny key/value persistence layer on top of IndexedDB used for settings,
// auth tokens, collaboration state, extensions metadata and other
// non-file-system data.

import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'webide-kv';
const STORE = 'kv';
let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

export async function kvGet<T = unknown>(key: string): Promise<T | undefined> {
  const db = await getDb();
  return (await db.get(STORE, key)) as T | undefined;
}

export async function kvSet<T = unknown>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put(STORE, value as any, key);
}

export async function kvDel(key: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, key);
}

export async function kvKeys(prefix = ''): Promise<string[]> {
  const db = await getDb();
  const all = (await db.getAllKeys(STORE)) as string[];
  return all.filter((k) => k.startsWith(prefix));
}
