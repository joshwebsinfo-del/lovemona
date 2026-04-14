
import { openDB, type IDBPDatabase } from 'idb';

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
  status: 'sent' | 'delivered' | 'read' | 'unread';
  disappearing?: boolean;
  expiresAt?: number;
  reaction?: string;
}

export interface VaultItem {
  id: string;
  type: 'photo' | 'video' | 'voice';
  data: string; // Base64 data (simplified for speed)
  name: string;
  timestamp: number;
  locked: boolean;
}

const DB_NAME = 'SecureLoveDB';
const DB_VERSION = 5;

export async function initDB(): Promise<IDBPDatabase> {
  const tryOpen = () => openDB(DB_NAME, DB_VERSION, {
    upgrade(db, _, __, transaction) {
      const stores = ['messages', 'vault', 'keys', 'auth', 'identity', 'partner', 'settings'];
      for (const store of stores) {
        let os;
        if (!db.objectStoreNames.contains(store)) {
          os = db.createObjectStore(store, { keyPath: 'id' });
        } else {
          os = transaction.objectStore(store);
        }

        if (store === 'messages' || store === 'vault') {
           if (!os.indexNames.contains('timestamp')) {
              os.createIndex('timestamp', 'timestamp');
           }
        }
      }
    },
  });

  try {
    return await tryOpen();
  } catch (err) {
    console.warn('DB open failed, resetting database...', err);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return await tryOpen();
  }
}

export async function clearLocalData() {
  const db = await initDB();
  const tx = db.transaction(['messages', 'vault', 'keys', 'auth'], 'readwrite');
  await Promise.all([
    tx.objectStore('messages').clear(),
    tx.objectStore('vault').clear(),
    tx.objectStore('keys').clear(),
    tx.objectStore('auth').clear(),
  ]);
  await tx.done;
}
