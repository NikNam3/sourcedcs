/**
 * The TOLD tables in the DOM (TOLD 1.8): the rows `table-cells.ts` models, each with its "Fig." links, and the grey
 * lines `table-lines.ts` gives under the table, a reason's figure a link to its view. Rebuilt on every change.
 */
import type { FigureView } from './links.ts';
import type { RowModel } from './table-cells.ts';
import type { LineModel } from './table-lines.ts';

export type HrefOf = (figureId: string, view: FigureView) => string;

/** A table section: its rows and the figure view their links open. */
export interface RowGroup {
  readonly rows: readonly RowModel[];
  readonly view: FigureView;
}

const COLUMNS = 6;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  node.append(...children);
  return node;
}

function figureLink(label: string, href: string): HTMLAnchorElement {
  const a = el('a', 'figure-link', label);
  a.href = href;
  return a;
}

function rowElement(r: RowModel, view: FigureView, hrefOf: HrefOf): HTMLTableRowElement {
  if (r.kind === 'subheading') {
    const cell = el('td', '', `${r.title} · `, r.weight ?? el('span', 'no-value', '—'));
    cell.colSpan = COLUMNS;
    return el('tr', r.groupStart ? 'subheading group-start' : 'subheading', cell);
  }
  const links = r.figures.flatMap((id, i) => [...(i > 0 ? [' '] : []), figureLink(id, hrefOf(id, view))]);
  const cells = r.cells.map((c) => el('td', c.className, c.text));
  return el(
    'tr',
    r.groupStart ? 'group-start' : '',
    el('td', 'row-label', r.label),
    el('td', 'fig', ...links),
    ...cells,
  );
}

function lineElement(line: LineModel, hrefOf: HrefOf): HTMLParagraphElement {
  if (line.figure === null) return el('p', 'reason', line.text);
  return el('p', 'reason', figureLink(line.figure.label, hrefOf(line.figure.id, line.figure.view)), `: ${line.text}`);
}

export function renderTable(
  body: HTMLTableSectionElement,
  linesBox: HTMLElement,
  groups: readonly RowGroup[],
  lines: readonly LineModel[],
  hrefOf: HrefOf,
): void {
  body.replaceChildren(...groups.flatMap((g) => g.rows.map((r) => rowElement(r, g.view, hrefOf))));
  linesBox.replaceChildren(...lines.map((l) => lineElement(l, hrefOf)));
}
