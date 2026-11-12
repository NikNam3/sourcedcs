/**
 * The figure page (TOLD 1.8): `figure.html#<state>&fig=B2-3&view=takeoff`. Reads the state as the TOLD page does
 * (hash, then storage, then the defaults; it writes neither), draws the view's sheets in chain order with their exact
 * paths, and links back to the TOLD page with the same state. A `hashchange` redraws. Unknown `fig` or `view`: one
 * grey line and the back link.
 */
import type { FigureSet } from '../../core/data/figure-set.ts';
import { figure } from '../../core/data/figure-set.ts';
import { deriveInputs } from '../../core/inputs/derive.ts';
import type { Reason } from '../../core/told/told.ts';
import { loadData } from '../load.ts';
import type { AppData } from '../load.ts';
import { reasonText } from '../reasons.ts';
import type { Signs } from '../reasons.ts';
import { fitPage } from '../scale.ts';
import { encodeState } from '../state/hash.ts';
import type { AppState } from '../state/hash.ts';
import { initialState } from '../state/initial.ts';
import { readStored } from '../state/storage.ts';
import { APP_VERSION } from '../version.ts';

import { html } from './dom.ts';
import { renderSheet } from './sheet.ts';
import { figureOf, parseView, viewPaths } from './views.ts';
import type { View } from './views.ts';

const NO_VIEW = 'No such figure view.';
const NO_DATA = 'The chart data could not be loaded.';

const CAPTIONS: Readonly<Record<View, string>> = {
  takeoff: 'Takeoff',
  normal: 'Landing, normal weight',
  heavy: 'Landing, heavyweight',
};

function byId(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (e === null) throw new Error(`figure.html has no #${id}`);
  return e;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const valueOrNull = (d: { ok: true; value: number } | { ok: false }): number | null => (d.ok ? d.value : null);

function signsOf(state: AppState): Signs {
  const derived = deriveInputs(state.inputs);
  return { headwindKt: valueOrNull(derived.headwindKt), slopePct: valueOrNull(derived.slopePct) };
}

const viewFor = (fig: string, current: View): View => (fig.startsWith('B7-') ? current : 'takeoff');

function reasonLine(
  reason: Reason,
  figures: FigureSet,
  signs: Signs,
  fig: string,
  href: (f: string) => string,
): HTMLElement {
  const { figure: label, text } = reasonText(reason, figures, signs);
  const named = figureOf(reason.error.figure);
  const name = named === fig ? label : html('a', { class: 'figure-link', href: href(named) }, [label]);
  return html('p', { class: 'reason' }, [name, `: ${text}`]);
}

function render(data: AppData): void {
  const { state, notes } = initialState(location.hash, readStored(storage()));
  const params = new URLSearchParams(location.hash.slice(1));
  const stateText = encodeState(state);
  byId('notes').replaceChildren(...notes.map((n) => html('p', { class: 'page-note' }, [n])));
  byId('back').setAttribute('href', `index.html#${stateText}`);

  const target = byId('figure-view');
  const parsed = parseView(params.get('fig'), params.get('view'));
  const result = parsed === null ? null : viewPaths(data.figures, state, parsed.fig, parsed.view);
  if (parsed === null || result === null) {
    target.replaceChildren(html('p', { class: 'page-note' }, [NO_VIEW]));
    document.title = 'TOLD: figure';
    return;
  }
  const { fig, view } = parsed;
  document.title = `TOLD: Fig. ${fig}`;
  const href = (f: string): string => `figure.html#${stateText}&fig=${f}&view=${viewFor(f, view)}`;
  const signs = signsOf(state);
  const lines = (keep: (sheetId: string) => boolean): HTMLElement[] =>
    result.reasons.filter((r) => keep(r.error.figure)).map((r) => reasonLine(r, data.figures, signs, fig, href));

  target.replaceChildren(
    ...result.sheets.map((id, i) =>
      renderSheet({
        fig: figure(data.figures, id),
        caption: CAPTIONS[view],
        paths: result.paths,
        // A reason naming a sheet goes under it; one naming another figure under the first sheet.
        reasons: lines((named) => named === id || (i === 0 && !result.sheets.includes(named))),
        figureHref: href,
      }),
    ),
  );
}

function footer(data: AppData | null): void {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const version = data === null ? 'unknown' : String(data.manifest.dataVersion);
  byId('footer-version').textContent = `Data version ${version} · App version ${APP_VERSION} · ${date}`;
}

async function main(): Promise<void> {
  fitPage(byId('page'));
  // The way back works even when the data does not load.
  byId('back').setAttribute(
    'href',
    `index.html#${encodeState(initialState(location.hash, readStored(storage())).state)}`,
  );
  let data: AppData;
  try {
    data = await loadData();
  } catch {
    footer(null);
    byId('figure-view').replaceChildren(html('p', { class: 'page-note' }, [NO_DATA]));
    return;
  }
  footer(data);
  render(data);
  window.addEventListener('hashchange', () => {
    render(data);
  });
}

void main();
