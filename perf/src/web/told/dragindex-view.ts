/**
 * The drag index builder (TOLD.md 1.8 and the decisions of 29 Oct 2026; the approved board perf-told.html): one
 * row per station pair, then 5, 5L, 5R, each with its store picker, count, suspension and split or join. The view
 * keeps no state of its own and computes nothing: an edit goes out through `onChange`, the page recomputes and
 * calls `update` with the new loadout and its drag index. The rows' texts come from the pure `dragindex-rows.ts`.
 */
import type { Catalogue } from '../../core/dragindex/catalogue.ts';
import type { DragIndex, Loadout } from '../../core/dragindex/loadout.ts';
import { capacity } from '../../core/dragindex/racks.ts';
import { notesText, rowModels, totalText, type RowModel } from './dragindex-rows.ts';
import { menuOptions } from './dragindex-text.ts';
import { join, setCount, setStore, setSuspension, split } from './loadout-edit.ts';
import { openStoreMenu } from './store-menu.ts';

export interface DragIndexView {
  update(loadout: Loadout, drag: DragIndex, additionalOk: boolean): void;
  /** The Additional field (stores not in Fig. B1-1), made once: the page reads it and marks it unparsed. */
  readonly additionalInput: HTMLInputElement;
}

const DASH = '—';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const num = (text: string): HTMLTableCellElement => el('td', { className: 'num', textContent: text });
const blank = (): HTMLTableCellElement[] => [num(''), num(''), num('')];
const focusKey = (kind: string, m: RowModel): string => `${kind}:${m.row.stations[0] ?? String(m.index)}`;

function header(table: HTMLTableElement): void {
  if (table.tHead !== null) return;
  const cells = ['Sta.', 'Store', 'No.', 'Each', 'DI'].map((text, i) =>
    el('th', { textContent: text, className: i > 1 ? 'num' : '' }),
  );
  table.createTHead().append(el('tr', {}, ...cells));
}

export function mountDragIndex(
  table: HTMLTableElement,
  notes: HTMLElement,
  cat: Catalogue,
  onChange: (next: Loadout) => void,
): DragIndexView {
  header(table);
  const rows = table.tBodies[0] ?? table.createTBody();
  const additionalInput = el('input', { placeholder: '0', inputMode: 'decimal', autocomplete: 'off' });
  additionalInput.setAttribute('aria-label', 'Additional drag index');
  const totalCell = num(DASH);
  const totalRow = el(
    'tr',
    { className: 'total' },
    el('td'),
    el('td', { textContent: 'Drag index' }),
    num(''),
    num(''),
    totalCell,
  );
  const foot = table.createTBody();
  foot.append(
    el(
      'tr',
      { className: 'station-start' },
      el('td', { textContent: DASH }),
      el('td', { textContent: 'Additional (stores not in Fig. B1-1)' }),
      num(''),
      num(''),
      el('td', { className: 'num' }, additionalInput),
    ),
    totalRow,
  );

  let current: Loadout = [];
  let closeMenu = (): void => undefined;
  let pendingFocus: string | null = null;
  const edit = (next: Loadout, focus: string): void => {
    pendingFocus = focus;
    onChange(next);
  };

  function stationCell(m: RowModel): HTMLTableCellElement {
    const cell = el('td', {}, m.label);
    if (m.action === null) return cell;
    const [a] = m.row.stations;
    const pair = m.action === 'split' ? m.label : `${String(a)}, ${current[m.index + 1]?.stations.join(', ') ?? ''}`;
    const action = el('button', { type: 'button', className: 'station-action', textContent: m.action });
    const label = m.action === 'split' ? `Different stores on ${pair}` : `Same store on ${pair}`;
    action.setAttribute('aria-label', label);
    action.title = label;
    action.dataset.focus = focusKey('action', m);
    action.addEventListener('click', () => {
      edit(m.action === 'split' ? split(current, m.index) : join(current, m.index), focusKey('action', m));
    });
    cell.append(action);
    return cell;
  }

  function storeCell(m: RowModel): HTMLTableCellElement {
    const cell = el('td', { className: 'picker' });
    const button = el('button', { type: 'button', textContent: m.storeText });
    if (m.empty) button.classList.add('empty');
    if (m.problem) button.classList.add('unparsed');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-label', `Store at ${m.label}: ${m.storeText}`);
    button.dataset.focus = focusKey('store', m);
    button.addEventListener('click', () => {
      closeMenu();
      closeMenu = openStoreMenu(cell, button, m.label, menuOptions(cat, m.row.stations), m.row.storeKey, (key) => {
        if (key === m.row.storeKey) button.focus();
        else edit(setStore(current, m.index, key), focusKey('store', m));
      });
    });
    cell.append(button);
    return cell;
  }

  function countCell(m: RowModel, count: { readonly value: number; readonly max: number }): HTMLTableCellElement {
    const valid = Number.isInteger(count.value) && count.value >= 1 && count.value <= count.max;
    if (count.max < 1 || (count.max === 1 && valid)) return num(String(count.value));
    const select = el('select', { className: 'count' });
    select.setAttribute('aria-label', `Number of stores at ${m.label}`);
    select.dataset.focus = focusKey('count', m);
    // A count the picker does not offer (from a link) is shown as it is, so picking any offered count changes it.
    if (!valid)
      select.append(el('option', { value: '', textContent: String(count.value), selected: true, disabled: true }));
    for (let n = 1; n <= count.max; n += 1) {
      select.append(el('option', { value: String(n), textContent: String(n), selected: n === count.value }));
    }
    select.addEventListener('change', () => {
      const n = Number(select.value);
      let next = setCount(current, m.index, n);
      // A picked suspension that cannot carry the new count goes back to the default, which picks one that can.
      const s = m.row.suspension;
      const known = s !== null && m.suspension?.options.includes(s) === true;
      if (known && capacity(s) * m.row.stations.length < n) next = setSuspension(next, m.index, null);
      edit(next, focusKey('count', m));
    });
    return el('td', { className: 'num picker' }, select);
  }

  function suspensionRow(m: RowModel, s: NonNullable<RowModel['suspension']>): HTMLTableRowElement {
    let cell: HTMLTableCellElement;
    if (s.options.length > 1) {
      const select = el('select');
      select.setAttribute('aria-label', `Suspension at ${m.label}`);
      select.dataset.focus = focusKey('susp', m);
      for (const name of s.options) {
        select.append(el('option', { value: name, textContent: `on ${name}`, selected: name === s.chosen }));
      }
      select.addEventListener('change', () => {
        edit(setSuspension(current, m.index, select.value), focusKey('susp', m));
      });
      cell = el(
        'td',
        { className: 'picker' },
        el('span', { className: 'chosen', textContent: `on ${s.chosen}` }),
        select,
      );
    } else {
      cell = el('td', { textContent: `on ${s.chosen}` });
    }
    return el('tr', { className: 'suspension' }, el('td'), cell, num(s.countText), num(s.eachText), num(s.dragText));
  }

  function rowsOf(m: RowModel): HTMLTableRowElement[] {
    // An empty station does not print, the first of a split pair (with its "join") included.
    const tr = el('tr', { className: m.empty ? 'station-start empty-station' : 'station-start' }, stationCell(m));
    tr.append(storeCell(m));
    if (m.count === null) tr.append(...blank());
    else tr.append(countCell(m, m.count), num(m.eachText), num(m.dragText));
    const out = [tr];
    if (m.variant !== null) {
      out.push(el('tr', {}, el('td'), el('td', { className: 'variant', textContent: m.variant }), ...blank()));
    }
    if (m.suspension !== null) out.push(suspensionRow(m, m.suspension));
    return out;
  }

  function update(loadout: Loadout, drag: DragIndex, additionalOk: boolean): void {
    closeMenu();
    const active = document.activeElement;
    const keep = active instanceof HTMLElement && rows.contains(active) ? (active.dataset.focus ?? null) : null;
    const focus = pendingFocus ?? keep;
    pendingFocus = null;
    current = loadout;
    const basic = String(cat.basic.subsonic);
    rows.replaceChildren(
      el(
        'tr',
        {},
        el('td', { textContent: DASH }),
        el('td', { textContent: 'BASIC AIRCRAFT (INCL. TIP AIM-9)' }),
        num('1'),
        num(basic),
        num(basic),
      ),
      ...rowModels(cat, loadout, drag).flatMap(rowsOf),
    );
    const total = totalText(drag, additionalOk);
    if (total === null) {
      totalCell.replaceChildren(el('span', { className: 'no-value', textContent: DASH }));
    } else if (total.conservative === null) {
      totalCell.replaceChildren(total.exact);
    } else {
      totalCell.replaceChildren(
        el('span', { className: 'exact', textContent: total.exact }),
        ' / ',
        el('span', { className: 'cons', textContent: total.conservative }),
      );
    }
    notes.textContent = notesText(loadout, drag);
    if (focus !== null) {
      const target = [...rows.querySelectorAll<HTMLElement>('[data-focus]')].find((e) => e.dataset.focus === focus);
      target?.focus();
    }
  }

  return { update, additionalInput };
}
