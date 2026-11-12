/**
 * The store menu (TOLD.md decisions of 29 Oct 2026, the approved board): a sheet of Fig. B1-1 laid over the page,
 * the stores allowed on one row grouped under the manual's headings, filtered by typing, the arrow keys to move,
 * Enter to take, Escape or a click outside to close.
 */
import { filterOptions, type MenuOption } from './dragindex-text.ts';

export type MenuKey = MenuOption['key'];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/**
 * Opens the menu in `host` (the picker cell) under `button`. `choose` gets the picked key after the menu has
 * closed. Returns the function that closes it without a choice.
 */
export function openStoreMenu(
  host: HTMLElement,
  button: HTMLButtonElement,
  stationText: string,
  options: readonly MenuOption[],
  current: MenuKey,
  choose: (key: MenuKey) => void,
): () => void {
  const search = el('input', { type: 'text', placeholder: 'Type to filter; arrow keys and Enter to take' });
  search.setAttribute('aria-label', `Filter stores at ${stationText}`);
  const list = el('ul', { role: 'listbox' });
  list.setAttribute('aria-label', `Stores at ${stationText}`);
  const foot = el(
    'div',
    { className: 'menu-foot' },
    `Fig. B1-1 stores for station ${stationText}. A store not listed: enter its drag index as Additional.`,
  );
  const menu = el('div', { className: 'store-menu' }, search, list, foot);
  let shown: MenuOption[] = [];
  let active = Math.max(
    options.findIndex((o) => o.key === current),
    0,
  );
  let open = true;

  const close = (): void => {
    if (!open) return;
    open = false;
    menu.remove();
    document.removeEventListener('mousedown', outside);
  };
  const take = (option: MenuOption): void => {
    close();
    choose(option.key);
  };
  function outside(e: MouseEvent): void {
    const target = e.target;
    if (target instanceof Node && (menu.contains(target) || button.contains(target))) return;
    close();
  }

  const paint = (): void => {
    shown = filterOptions(options, search.value);
    active = Math.min(active, Math.max(shown.length - 1, 0));
    list.replaceChildren();
    let group = '';
    shown.forEach((o, i) => {
      if (o.heading !== group) {
        group = o.heading;
        if (group !== '') list.append(el('li', { className: 'group', role: 'presentation', textContent: group }));
      }
      const li = el(
        'li',
        { role: 'option' },
        el('span', { textContent: o.text }),
        el('span', { textContent: o.rack }),
        el('span', { textContent: o.dragText }),
      );
      li.setAttribute('aria-selected', String(i === active));
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        take(o);
      });
      list.append(li);
    });
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };

  // The filter's typing is the menu's own: a page that recomputes on every bubbling `input` event would otherwise
  // call `update`, which closes the menu at the first letter.
  search.addEventListener('input', (e) => {
    e.stopPropagation();
    active = 0;
    paint();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') active = Math.min(active + 1, shown.length - 1);
    else if (e.key === 'ArrowUp') active = Math.max(active - 1, 0);
    else if (e.key === 'Enter') {
      // Swallowed, or the same keypress would press the store button that takes focus and reopen the menu.
      e.preventDefault();
      const option = shown[active];
      if (option !== undefined) take(option);
      return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
      button.focus();
      return;
    } else return;
    e.preventDefault();
    paint();
  });
  // A click in the menu keeps the focus in the filter; tabbing out of the menu closes it, as a click outside does.
  menu.addEventListener('mousedown', (e) => {
    if (e.target !== search) e.preventDefault();
  });
  menu.addEventListener('focusout', (e) => {
    const next = e.relatedTarget;
    if (!(next instanceof Node) || !menu.contains(next)) close();
  });
  document.addEventListener('mousedown', outside);

  host.append(menu);
  paint();
  search.focus();
  return close;
}
