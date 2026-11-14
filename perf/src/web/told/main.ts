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
import { encodeState } from '../state/hash.ts';
import type { AppState } from '../state/hash.ts';
import { initialState } from '../state/initial.ts';
import { readStored, writeStored } from '../state/storage.ts';
import { versionLine } from '../version.ts';
import { browserStorage } from '../browser-storage.ts';
import { computeInputs } from '../inputs.ts';

import { derivedLines } from './derived-line.ts';
import { mountDragIndex } from './dragindex-view.ts';
import type { DragIndexView } from './dragindex-view.ts';
import { unparsedFields } from './field-check.ts';
import { mountInputs } from './inputs-view.ts';
import type { InputsView } from './inputs-view.ts';
import { figureHref, limitationsHref } from './links.ts';
import { landingRows, takeoffRows } from './table-cells.ts';
import { missingLines } from './missing-line.ts';
import { landingLines, takeoffLines } from './table-lines.ts';
import { renderTable } from './tables.ts';
import type { HrefOf } from './tables.ts';

const LOAD_FAILED = 'The chart data could not be loaded.';

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`the page has no ${type.name} #${id}`);
  return node;
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
    byId('versions', HTMLElement).textContent = versionLine(data.manifest.dataVersion, new Date());
  }

  /**
   * The state from the hash, storage or the defaults, with its notes; fills every field. A state from the hash or
   * storage is written back once to both, so an opened link becomes the stored state. A page from the defaults
   * (its defaulted fields empty, shown as placeholders) writes nothing until the first change.
   */
  load(): void {
    const initial = initialState(location.hash, readStored(browserStorage()));
    this.state = initial.state;
    showNotes(initial.notes);
    this.inputs.write(this.state.inputs);
    this.recompute(initial.source !== 'defaults');
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
      [...missingLines([told.takeoff.mil, told.takeoff.ab], state.inputs), ...takeoffLines(told, derived, figures)],
      hrefOf,
    );
    renderTable(
      byId('landing-rows', HTMLTableSectionElement),
      byId('landing-lines', HTMLElement),
      [
        { rows: landingRows(told, derived, 'normal'), view: 'normal' },
        { rows: landingRows(told, derived, 'heavy'), view: 'heavy' },
      ],
      [
        ...missingLines(
          [told.landing.normal.dry, told.landing.normal.wet, told.landing.heavy.dry, told.landing.heavy.wet],
          state.inputs,
        ),
        ...landingLines(told, derived, figures),
      ],
      hrefOf,
    );
    byId('limitations-link', HTMLAnchorElement).href = limitationsHref(state);

    if (save) {
      const text = encodeState(state);
      history.replaceState(null, '', `#${text}`);
      writeStored(browserStorage(), text);
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
