/** The app's version, shown in the footer and on the Limitations page; a test keeps it equal to package.json's. */
export const APP_VERSION = '0.1.0';

/** The footer line: "Data version 3 · App version 0.1.0 · 12 Nov 2026"; `dataVersion` null when the data did not load. */
export function versionLine(dataVersion: number | null, date: Date): string {
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  return `Data version ${dataVersion === null ? 'unknown' : String(dataVersion)} · App version ${APP_VERSION} · ${day}`;
}
