/**
 * The runway rules (TOLD 1.7 "Rules", 1.2 item 3), each cited to its paragraph: MIL roll over 50 % (afterburner
 * required, AFMAN 11-2F-16V3 3.6.6), any takeoff roll over 80 % (3.6.3), landing roll over 80 % (3.18), RCR below 10
 * at the landing field (3.18), and a landing beyond one of Fig. B7-2 sheet 1's limit lines. "Over" and "below" are
 * strict. The exact and the conservative cell are checked on their own, so a conservative value can be marked while
 * the exact one is not. A cell that is OutOfChart has no runway used; a null limit verdict (not judged) marks nothing.
 */
import type { Cell } from '../ctx.ts';
import type { LimitVerdicts } from '../figures/b7-2.ts';
import type { Read } from '../result.ts';

import type { LandingSide } from './landing.ts';
import type { TakeoffSide } from './takeoff.ts';

export type RuleId = 'mil-roll-50' | 'takeoff-roll-80' | 'landing-roll-80' | 'landing-rcr-10' | 'b7-2-limit';

export interface RuleMark {
  readonly rule: RuleId;
  readonly paragraph: string;
  readonly cell: 'exact' | 'conservative';
  /** The runway used the mark cites, unrounded. */
  readonly percent?: number;
  /** The limit line a `b7-2-limit` mark is for. */
  readonly line?: keyof LimitVerdicts;
  /** The RCR input a `landing-rcr-10` mark on the input is for (`Told.rcrMarks`). */
  readonly field?: 'rcrDry' | 'rcrWet';
}

export const RULES: readonly { id: RuleId; paragraph: string }[] = Object.freeze([
  { id: 'mil-roll-50', paragraph: '3.6.6' },
  { id: 'takeoff-roll-80', paragraph: '3.6.3' },
  { id: 'landing-roll-80', paragraph: '3.18' },
  { id: 'landing-rcr-10', paragraph: '3.18' },
  { id: 'b7-2-limit', paragraph: 'Fig. B7-2 sh. 1' },
]);

const PARAGRAPH: Readonly<Record<RuleId, string>> = Object.freeze(
  Object.fromEntries(RULES.map((r) => [r.id, r.paragraph])) as Record<RuleId, string>,
);

/** MIL takeoff roll over this % of the runway: afterburner required (3.6.6). */
const MIL_ROLL_MAX_PCT = 50;
/** Any takeoff or landing roll over this % of the runway (3.6.3, 3.18). */
const ROLL_MAX_PCT = 80;
/** RCR below this at the landing field (3.18). */
export const RCR_MIN = 10;

const LIMIT_LINES: readonly (keyof LimitVerdicts)[] = Object.freeze(['brakeEnergy', 'mlgTire', 'nlgTire']);
const CELLS = ['exact', 'conservative'] as const;

/** distance / length × 100; not a rounding point. */
export function runwayUsedPct(distanceFt: number, runwayFt: number): number {
  return (distanceFt * 100) / runwayFt;
}

export function mark(rule: RuleId, cell: 'exact' | 'conservative', extra: Partial<RuleMark> = {}): RuleMark {
  return { rule, paragraph: PARAGRAPH[rule], cell, ...extra };
}

function percentOf(read: Read<number>, runwayFt: number): number | null {
  return read.ok ? runwayUsedPct(read.value, runwayFt) : null;
}

/** The marks on a takeoff column's distance cell, exact first. */
export function takeoffMarks(mode: 'mil' | 'ab', cell: Cell<TakeoffSide>, runwayFt: number): RuleMark[] {
  const marks: RuleMark[] = [];
  for (const which of CELLS) {
    const percent = percentOf(cell[which], runwayFt);
    if (percent === null) continue;
    if (mode === 'mil' && percent > MIL_ROLL_MAX_PCT) marks.push(mark('mil-roll-50', which, { percent }));
    if (percent > ROLL_MAX_PCT) marks.push(mark('takeoff-roll-80', which, { percent }));
  }
  return marks;
}

/**
 * The marks on a landing column's distance cell, exact first: the roll over 80 %, the RCR the column uses below 10,
 * and every limit line whose verdict in that cell's side data is `true`.
 */
export function landingMarks(cell: Cell<LandingSide>, runwayFt: number, rcr: number): RuleMark[] {
  const marks: RuleMark[] = [];
  for (const which of CELLS) {
    const percent = percentOf(cell[which], runwayFt);
    if (percent !== null && percent > ROLL_MAX_PCT) marks.push(mark('landing-roll-80', which, { percent }));
    if (rcr < RCR_MIN) marks.push(mark('landing-rcr-10', which));
    const limits = which === 'exact' ? cell.exactSide.limits : cell.conservativeSide.limits;
    if (limits === null) continue;
    for (const line of LIMIT_LINES) {
      if (limits[line] === true) marks.push(mark('b7-2-limit', which, { line }));
    }
  }
  return marks;
}
