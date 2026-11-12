/**
 * The page's localStorage for `state/storage.ts`, which takes it as an argument so that `state/` stays free of DOM
 * globals. Called by the pages' main modules only.
 */

/** localStorage, or null where reading it throws (storage disabled). */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
