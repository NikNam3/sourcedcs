/**
 * A rule mark as the grey line under its table (TOLD 1.8 "Rule lines"). A conservative-only mark says
 * "conservative" after the column name. A roll rule cites the mark's own `percent` ("—" if it has none; every roll mark
 * the core builds has one). `rcr` is the RCR for `landing-rcr-10`, whose mark carries no value (several are
 * joined, "RCR 8 / 6"), and is ignored otherwise. `b7-2-limit` names its line with the label printed on Fig. B7-2 sheet 1. No DOM.
 */
import type { FigureSet } from '../core/data/figure-set.ts';
import type { LimitVerdicts } from '../core/figures/b7-2.ts';
import type { RuleMark } from '../core/told/rules.ts';

import { DASH, formatPercent, formatThousands } from './format.ts';

export type ColumnName = 'MIL' | 'MAX AB' | 'normal dry' | 'normal wet' | 'heavyweight dry' | 'heavyweight wet';

const LIMIT_FIGURE = 'B7-2.sh1';
const LIMIT_PANEL: Readonly<Record<keyof LimitVerdicts, string>> = Object.freeze({
  brakeEnergy: 'brake_energy',
  mlgTire: 'mlg_tire',
  nlgTire: 'nlg_tire',
});
/** Words of a printed label kept in capitals; the rest are lower-cased, KTS becomes kt. */
const CAPITALS: ReadonlySet<string> = new Set(['MLG', 'NLG']);

/** "MAXIMUM BRAKE ENERGY LIMIT LINE" → "maximum brake energy limit"; "MLG TIRE … (225 KTS …)" → "MLG tire … kt". */
function limitName(label: string): string {
  return label
    .replace(/\s+LINE$/, '')
    .split(' ')
    .map((word) => {
      if (CAPITALS.has(word)) return word;
      if (word === 'KTS') return 'kt';
      return word.toLowerCase();
    })
    .join(' ');
}

function limitLabel(line: keyof LimitVerdicts | undefined, figures: FigureSet): string {
  if (line === undefined || !Object.hasOwn(figures, LIMIT_FIGURE)) return 'a limit line';
  const panel = figures[LIMIT_FIGURE]?.panels.find((p) => p.id === LIMIT_PANEL[line]);
  return panel?.type === 'limit_line' ? `the ${limitName(panel.label)}` : 'a limit line';
}

/** One RCR, or several joined with " / " (dry and wet both below 10, shown once: "RCR 8 / 6"). */
function rcrText(rcr: number | readonly number[] | null): string {
  if (rcr === null) return DASH;
  const values = typeof rcr === 'number' ? [rcr] : rcr;
  return values.length === 0 ? DASH : values.map((v) => formatThousands(v)).join(' / ');
}

function cite(paragraph: string): string {
  return paragraph.startsWith('Fig.') ? `(${paragraph})` : `(para. ${paragraph})`;
}

export function ruleLine(
  mark: RuleMark,
  column: ColumnName | null,
  rcr: number | readonly number[] | null,
  figures: FigureSet,
): string {
  const conservative = mark.cell === 'conservative';
  /** The column, "conservative" after it for a conservative-only mark; `fallback` when there is no column. */
  const subject = (fallback: string | null): string =>
    [column ?? fallback, conservative ? 'conservative' : null].filter((w) => w !== null).join(' ');
  const percentText = mark.percent === undefined ? DASH : formatPercent(mark.percent);
  const paragraph = cite(mark.paragraph);

  switch (mark.rule) {
    case 'mil-roll-50':
      return `${subject('MIL')} roll ${percentText} % of runway: over 50 %, afterburner takeoff required ${paragraph}`;
    case 'takeoff-roll-80': {
      const who = subject(null);
      return `${who === '' ? 'Takeoff' : who} roll ${percentText} % of runway: over 80 % ${paragraph}`;
    }
    case 'landing-roll-80': {
      const who = subject(null);
      return `Landing roll, ${who === '' ? '' : `${who}, `}${percentText} % of runway: over 80 % ${paragraph}`;
    }
    case 'landing-rcr-10':
      return `RCR ${rcrText(rcr)} at the landing field: below 10 ${paragraph}`;
    case 'b7-2-limit': {
      const who = subject(null);
      return `Landing${who === '' ? '' : `, ${who}`}: beyond ${limitLabel(mark.line, figures)} ${paragraph}`;
    }
  }
}
