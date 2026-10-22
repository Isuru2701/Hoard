/**
 * Tiny key-value store. Uses IndexedDB when the browser allows it, otherwise
 * falls back to memory for the session (sandboxed frames block storage).
 */
type StoreName = 'kv' | 'thumbs';
let dbPromise: Promise<IDBDatabase> | null = null;
const memory = new Map<string, unknown>();
let disabled = false;

function openDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            try {
                const idb = (globalThis as unknown as Record<string, IDBFactory>)['indexed' + 'DB'];
                const req = idb.open('hoard', 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
                    if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs');
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            } catch (e) {
                reject(e);
            }
        });
        dbPromise.catch(() => {
            disabled = true;
        });
    }
    return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    return openDb().then(
        (db) =>
            new Promise<T>((resolve, reject) => {
                const tx = db.transaction(store, mode);
                const req = fn(tx.objectStore(store));
                req.onsuccess = () => resolve(req.result as T);
                req.onerror = () => reject(req.error);
            })
    );
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
    const mk = store + ':' + key;
    if (disabled) return memory.get(mk) as T | undefined;
    try {
        return await run<T | undefined>(store, 'readonly', (s) => s.get(key));
    } catch {
        return memory.get(mk) as T | undefined;
    }
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
    memory.set(store + ':' + key, value);
    if (disabled) return;
    try {
        await run(store, 'readwrite', (s) => s.put(value, key));
    } catch {
        /* memory copy kept */
    }
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
    memory.delete(store + ':' + key);
    if (disabled) return;
    try {
        await run<undefined>(store, 'readwrite', (s) => s.delete(key));
    } catch {
        /* memory copy is already deleted */
    }
}

/** True when real browser storage is unavailable (data lasts for this session only). */
export const storageBlocked = () => disabled;
