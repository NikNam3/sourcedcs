/** Element builders for the figure page: HTML and SVG elements with attributes and children. */

const SVG_NS = 'http://www.w3.org/2000/svg';

type Child = Node | string;
type Attrs = Readonly<Record<string, string | number>>;

function fill<E extends Element>(e: E, attrs: Attrs, children: readonly Child[]): E {
  for (const [name, value] of Object.entries(attrs)) e.setAttribute(name, String(value));
  e.append(...children);
  return e;
}

export function html<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  return fill(document.createElement(tag), attrs, children);
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: readonly Child[] = [],
): SVGElementTagNameMap[K] {
  return fill(document.createElementNS(SVG_NS, tag), attrs, children);
}
