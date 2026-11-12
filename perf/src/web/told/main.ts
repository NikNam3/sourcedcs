/**
 * The TOLD page (TOLD 1.8): loads the chart data, then the state (hash, then storage, then the defaults), and on
 * every input and every builder change recomputes everything with `computeTold`, renders it, and writes the state
 * to the hash (`history.replaceState`, so typing does not fill the history) and to localStorage. A pasted link
 * (`hashchange`) reloads the state. A data load failure shows one grey line and nothing else.
 */
import type { FigureSet } from '../../core/data/figure-set.ts';
import { buildCatalogue } from '../../core/dragindex/catalogue.ts';
import { DEFAULT_LOADOUT } from '../../core/dragindex/loadout-row.ts';
import { deriveInputs } from '../../core/inputs/derive.ts';
import { DEFAULT_INPUTS } from '../../core/inputs/inputs.ts';
import { parseNumber } from '../../core/inputs/parse.ts';
import { computeTold } from '../../core/told/told.ts';
import { loadData } from '../load.ts';
import type { AppData } from '../load.ts';
import { fitPage } from '../scale.ts';
import { decodeState, encodeState } from '../state/hash.ts';
import type { AppState } from '../state/hash.ts';
import { initialState } from '../state/initial.ts';
import { readStored, writeStored } from '../state/storage.ts';
import { APP_VERSION } from '../version.ts';

import { derivedLines } from './derived-line.ts';
import { mountDragIndex } from './dragindex-view.ts';
import type { DragIndexView } from './dragindex-view.ts';
import { unparsedFields } from './field-check.ts';
import { blankDefaults, computeInputs } from './field-text.ts';
import { mountInputs } from './inputs-view.ts';
import type { InputsView } from './inputs-view.ts';
import { figureHref, limitationsHref } from './links.ts';
import { landingRows, takeoffRows } from './table-cells.ts';
import { landingLines, takeoffLines } from './table-lines.ts';
import { renderTable } from './tables.ts';
import type { HrefOf } from './tables.ts';

const LOAD_FAILED = 'The chart data could not be loaded.';

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`the page has no ${type.name} #${id}`);
  return node;
}

/** localStorage, or null where reading it throws (storage disabled). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function showNotes(notes: readonly string[]): void {
  byId('page-notes', HTMLElement).replaceChildren(
    ...notes.map((note) => {
      const p = document.createElement('p');
      p.className = 'page-note';
      p.textContent = note;
      return p;
    }),
  );
}

const today = (): string =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());

/** Neither the hash nor storage gave a state: the page starts from the defaults, shown as placeholders. */
function fromDefaults(hash: string, stored: string | null): boolean {
  return decodeState(hash).kind !== 'ok' && (stored === null || decodeState(stored).kind !== 'ok');
}

class ToldPage {
  private state: AppState = { inputs: DEFAULT_INPUTS, loadout: DEFAULT_LOADOUT };
  private readonly figures: FigureSet;
  private readonly drag: DragIndexView;
  private readonly inputs: InputsView;

  constructor(data: AppData) {
    this.figures = data.figures;
    const cat = buildCatalogue(data.figures);
    this.drag = mountDragIndex(
      byId('drag-index', HTMLTableElement),
      byId('drag-index-notes', HTMLElement),
      cat,
      (next) => {
        this.state = { ...this.state, loadout: next };
        this.recompute(true);
      },
    );
    this.inputs = mountInputs(document, this.drag.additionalInput, byId('derived', HTMLElement), () => {
      this.state = { ...this.state, inputs: this.inputs.read() };
      this.recompute(true);
    });
    byId('versions', HTMLElement).textContent =
      `Data version ${String(data.manifest.dataVersion)} · App version ${APP_VERSION} · ${today()}`;
  }

  /** The state from the hash, storage or the defaults, with its notes; fills every field. */
  load(): void {
    const stored = readStored(storage());
    const initial = initialState(location.hash, stored);
    const { inputs, loadout } = initial.state;
    this.state = { inputs: fromDefaults(location.hash, stored) ? blankDefaults(inputs) : inputs, loadout };
    showNotes(initial.notes);
    this.inputs.write(this.state.inputs);
    this.recompute(false);
  }

  recompute(save: boolean): void {
    const { state, figures } = this;
    const computed = computeInputs(state.inputs);
    const told = computeTold(figures, computed, state.loadout);
    const derived = deriveInputs(computed);
    const additionalOk = parseNumber(computed.additionalDragIndex).ok;

    this.drag.update(state.loadout, told.dragIndex, additionalOk);
    this.inputs.mark(unparsedFields(state.inputs, derived, additionalOk), told.rcrMarks.length > 0);
    this.inputs.derived(derivedLines(derived));
    const hrefOf: HrefOf = (figureId, view) => figureHref(state, figureId, view);
    renderTable(
      byId('takeoff-rows', HTMLTableSectionElement),
      byId('takeoff-lines', HTMLElement),
      [{ rows: takeoffRows(told, derived), view: 'takeoff' }],
      takeoffLines(told, derived, figures),
      hrefOf,
    );
    renderTable(
      byId('landing-rows', HTMLTableSectionElement),
      byId('landing-lines', HTMLElement),
      [
        { rows: landingRows(told, derived, 'normal'), view: 'normal' },
        { rows: landingRows(told, derived, 'heavy'), view: 'heavy' },
      ],
      landingLines(told, derived, figures),
      hrefOf,
    );
    byId('limitations-link', HTMLAnchorElement).href = limitationsHref(state);

    if (save) {
      const text = encodeState(state);
      history.replaceState(null, '', `#${text}`);
      writeStored(storage(), text);
    }
  }
}

async function start(): Promise<void> {
  const page = document.querySelector('.page');
  if (page instanceof HTMLElement) fitPage(page);
  let data: AppData;
  try {
    data = await loadData();
  } catch {
    showNotes([LOAD_FAILED]);
    return;
  }
  for (const node of document.querySelectorAll<HTMLElement>('[data-needs-data]')) node.hidden = false;
  const told = new ToldPage(data);
  told.load();
  window.addEventListener('hashchange', () => {
    told.load();
  });
}

void start();
