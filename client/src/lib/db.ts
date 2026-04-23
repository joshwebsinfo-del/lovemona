
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
  data: string | ArrayBuffer; // Support for fast binary storage
  name: string;
  timestamp: number;
  locked: boolean;
}

const DB_NAME = 'SecureLoveDB';
const DB_VERSION = 5;

export async function initDB(): Promise<IDBPDatabase> {
  const tryOpen = () => openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      console.log(`[DB] Upgrading from v${oldVersion} to v${newVersion}`);
      const stores = ['messages', 'vault', 'keys', 'auth', 'identity', 'partner', 'settings'];
      for (const store of stores) {
        if (!db.objectStoreNames.contains(store)) {
          console.log(`[DB] Creating store: ${store}`);
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }

      // Add indexes to existing stores if missing
      const messagesStore = transaction.objectStore('messages');
      if (!messagesStore.indexNames.contains('timestamp')) {
        messagesStore.createIndex('timestamp', 'timestamp');
      }
      
      const vaultStore = transaction.objectStore('vault');
      if (!vaultStore.indexNames.contains('timestamp')) {
        vaultStore.createIndex('timestamp', 'timestamp');
      }
    },
  });

  try {
    return await tryOpen();
  } catch (err: any) {
    console.error('[DB] Failed to open database:', err);
    
    // Only wipe if it's a version mismatch that we can't recover from,
    // or if the database is explicitly corrupt.
    if (err.name === 'VersionError') {
      console.warn('[DB] Version mismatch detected, attempting recovery...');
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
      return await tryOpen();
    }
    
    // For other errors, just throw and let the app handle the loading state
    throw err;
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
