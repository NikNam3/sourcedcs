/**
 * The state string in localStorage (TOLD 1.8 "Storage"): the hash without '#', under one key. Storage that is missing
 * or throws (private mode) is ignored. The caller passes the storage in, so nothing here touches a DOM global.
 */
export const STORAGE_KEY = 'perf.f16.v1';

/** The stored string; null when there is none, no storage, or reading throws. */
export function readStored(storage: Pick<Storage, 'getItem'> | null): string | null {
  if (storage === null) return null;
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Writes the string; no storage or a throw (quota, private mode) is swallowed. */
export function writeStored(storage: Pick<Storage, 'setItem'> | null, text: string): void {
  if (storage === null) return;
  try {
    storage.setItem(STORAGE_KEY, text);
  } catch {
    // Storage is optional: the hash still carries the state.
  }
}
