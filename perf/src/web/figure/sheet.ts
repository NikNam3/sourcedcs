/**
 * One sheet of a figure view (TOLD 1.8 "The figure page"): its heading, the page image with the exact paths and the
 * circled letters drawn over it in SVG, the legend, the key, and the reason lines of the paths that stopped on it.
 * The overlay's viewBox is the image in PDF points, so the stroke widths and the letter radius of perf.css are PDF
 * points (MIL solid 1.8, MAX AB dashed 1.6 (5 3), letters radius 5).
 */
import type { FigureFile } from '../../core/data/types.ts';
import { figureLabel } from '../format.ts';
import { pageImageUrl } from '../load.ts';

import { html, svg } from './dom.ts';
import { markRuns } from './geometry.ts';
import type { Px, Run } from './geometry.ts';
import { sheetLetters } from './letters.ts';
import type { KeyRow } from './letters.ts';
import type { ViewPath } from './views.ts';

/** A letter sits this far right and up of the point it names (PDF points), clear of the line. */
const LETTER_OFFSET_PT: Px = [7, -6];
const LETTER_RADIUS_PT = 5;

const PATH_CLASS: Readonly<Record<ViewPath['style'], string>> = { solid: 'path-mil', dashed: 'path-max-ab' };

export interface SheetInput {
  readonly fig: FigureFile;
  /** "Takeoff", "Landing, normal weight". */
  readonly caption: string;
  readonly paths: readonly ViewPath[];
  /** Reason lines for this sheet, already built. */
  readonly reasons: readonly HTMLElement[];
  /** Grey lines under the key. */
  readonly notes: readonly string[];
  /** The page link of a figure that gives a value (B2-1). */
  readonly figureHref: (figure: string) => string;
}

function overlay(fig: FigureFile, drawn: readonly { path: ViewPath; runs: Run[] }[]): SVGSVGElement {
  const [left, top, right, bottom] = fig.image.clipPt;
  const k = fig.image.pxPerPt;
  const pt = ([x, y]: Px): string => `${String(x / k)},${String(y / k)}`;
  const labels = drawn.map(({ path }) => `${path.label} ${path.style}`).join(', ');
  const root = svg('svg', {
    class: 'figure-overlay',
    viewBox: `0 0 ${String(right - left)} ${String(bottom - top)}`,
    role: 'img',
    'aria-label': labels === '' ? 'No computed path' : `Computed path: ${labels}`,
  });
  for (const { path, runs } of drawn) {
    for (const run of runs) {
      root.append(svg('polyline', { class: PATH_CLASS[path.style], points: run.points.map(pt).join(' ') }));
    }
  }
  const { letters } = sheetLetters(
    fig.id,
    drawn.map((d) => d.runs),
  );
  for (const { letter, at } of letters) {
    const cx = at[0] / k + LETTER_OFFSET_PT[0];
    const cy = at[1] / k + LETTER_OFFSET_PT[1];
    root.append(
      svg('g', { class: 'figure-letter' }, [
        svg('circle', { cx, cy, r: LETTER_RADIUS_PT }),
        svg('text', { x: cx, y: cy + 2.8 }, [letter]),
      ]),
    );
  }
  return root;
}

function legend(drawn: readonly { path: ViewPath }[]): HTMLElement {
  return html(
    'div',
    { class: 'figure-legend' },
    drawn.map(({ path }) =>
      html('span', {}, [
        svg('svg', { width: 36, height: 6, 'aria-hidden': 'true' }, [
          svg('line', { class: PATH_CLASS[path.style], x1: 0, y1: 3, x2: 36, y2: 3 }),
        ]),
        path.label,
      ]),
    ),
  );
}

function keyTable(rows: readonly KeyRow[], labels: readonly string[], href: SheetInput['figureHref']): HTMLElement {
  const head =
    labels.length > 1
      ? [html('thead', {}, [html('tr', {}, [html('th'), ...labels.map((l) => html('th', { class: 'num' }, [l]))])])]
      : [];
  const body = html(
    'tbody',
    {},
    rows.map((row, i) => {
      const label: (Node | string)[] = [`${row.circled} ${row.label}`];
      if (row.from !== null) {
        label.push(' ', html('a', { class: 'figure-link', href: href(row.from) }, [`from ${row.from}`]));
      }
      // Every result is bold; the ink rule sits above the first of them.
      const cls = row.result ? (rows.findIndex((r) => r.result) === i ? 'total' : 'result') : '';
      return html('tr', cls === '' ? {} : { class: cls }, [
        html('td', {}, label),
        ...row.values.map((v) => html('td', { class: 'num' }, [v])),
      ]);
    }),
  );
  return html('table', { class: 'figure-key' }, [...head, body]);
}

export function renderSheet(input: SheetInput): HTMLElement {
  const { fig } = input;
  const drawn = input.paths
    .map((path) => {
      const marks = path.marks.filter((m) => m.figure === fig.id);
      return { path, runs: markRuns(fig, marks, path.stoppedOn.includes(fig.id)) };
    })
    .filter((d) => d.runs.length > 0);
  const [left, top, right, bottom] = fig.image.clipPt;
  const k = fig.image.pxPerPt;

  const section = html('section', { class: 'section figure-sheet' }, [
    html('h2', { class: 'section-heading' }, [`Fig. ${figureLabel(fig.id)} · ${fig.title}`]),
    html('p', { class: 'figure-caption' }, [`${input.caption} · page ${fig.printedPage}`]),
    html('div', { class: 'figure' }, [
      html('img', {
        class: 'figure-image',
        src: pageImageUrl(fig),
        width: Math.round((right - left) * k),
        height: Math.round((bottom - top) * k),
        alt: `Figure ${figureLabel(fig.id)}, ${fig.title}`,
      }),
      overlay(fig, drawn),
    ]),
  ]);
  if (drawn.length > 0) {
    section.append(legend(drawn));
    const { rows } = sheetLetters(
      fig.id,
      drawn.map((d) => d.runs),
    );
    if (rows.length > 0) {
      section.append(
        keyTable(
          rows,
          drawn.map((d) => d.path.label),
          input.figureHref,
        ),
      );
    }
  }
  section.append(...input.notes.map((text) => html('p', { class: 'reason' }, [text])), ...input.reasons);
  return section;
}
