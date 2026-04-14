// This file runs once at app startup to migrate the database.
// It force-deletes the old v1 database if it has an outdated schema.

const DB_NAME = 'SecureLoveDB';
const REQUIRED_VERSION = 5;

export async function ensureFreshDB(): Promise<void> {
  return new Promise<void>((resolve) => {
    const check = indexedDB.open(DB_NAME);

    check.onsuccess = () => {
      const db = check.result;
      const version = db.version;
      const stores = Array.from(db.objectStoreNames);
      db.close();

      const needsMigration =
        version < REQUIRED_VERSION ||
        !stores.includes('identity') ||
        !stores.includes('partner');

      if (needsMigration) {
        console.log('[Migrate] Old DB detected, wiping for fresh start...');
        const del = indexedDB.deleteDatabase(DB_NAME);
        del.onsuccess = () => {
          console.log('[Migrate] Old DB deleted. Fresh start.');
          resolve();
        };
        del.onerror = () => {
          console.warn('[Migrate] Could not delete old DB, continuing anyway.');
          resolve();
        };
        del.onblocked = () => {
          console.warn('[Migrate] DB deletion blocked. Continuing anyway.');
          resolve();
        };
      } else {
        resolve();
      }
    };

    check.onerror = () => resolve(); // No DB yet, that's fine
  });
}
