/**
 * The app's only fetch (TOLD 1.8): the dataset manifest, then every figure file it lists, keyed by figure id as the
 * core takes them. URLs are relative to the page (`data/f16c-f110-129/…`). A failed fetch or a file that is not the
 * figure its name says rejects: the page shows that the data did not load.
 */
import type { FigureSet } from '../core/data/figure-set.ts';
import type { FigureFile, Manifest } from '../core/data/types.ts';

export interface AppData {
  readonly manifest: Manifest;
  readonly figures: FigureSet;
}

const DEFAULT_BASE = 'data/f16c-f110-129/';

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  return response.json();
}

export async function loadData(base: string = DEFAULT_BASE): Promise<AppData> {
  const manifest = (await getJson(`${base}manifest.json`)) as Manifest;
  const names = Object.keys(manifest.files).filter((name) => name.endsWith('.json'));
  const files = await Promise.all(names.map(async (name) => (await getJson(`${base}${name}`)) as FigureFile));
  const figures: Record<string, FigureFile> = {};
  files.forEach((fig, i) => {
    const id = (names[i] ?? '').replace(/\.json$/, '');
    if (fig.id !== id) throw new Error(`${base}${id}.json holds figure ${fig.id}`);
    figures[id] = fig;
  });
  return { manifest, figures: Object.freeze(figures) };
}

/** The figure's page image: base + `pages/<id>.png`. */
export function pageImageUrl(fig: FigureFile, base: string = DEFAULT_BASE): string {
  return `${base}${fig.image.file}`;
}
