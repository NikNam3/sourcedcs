/**
 * The inputs the charts read, derived from what the pilot typed (TOLD 5.3, 1.7): pressure altitude, slope and the
 * wind components. A derived value that does not compute names the input fields it needs that did not parse.
 */
import type { InputField, Inputs } from './inputs.ts';
import type { Field, Wind } from './parse.ts';
import { parseNumber, parseWind } from './parse.ts';

export type Derived<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly fields: readonly InputField[] };

export interface DerivedInputs {
  paFt: Derived<number>;
  tempC: Derived<number>;
  takeoffGwLb: Derived<number>;
  landingGwLb: Derived<number>;
  cgPct: Derived<number>;
  /** From the steady wind; negative is a tailwind. */
  headwindKt: Derived<number>;
  /** From the gust when there is one; > 0 from the right of the runway heading. */
  crosswindKt: Derived<number>;
  gustKt: Derived<number | null>;
  /** Uphill positive. */
  slopePct: Derived<number>;
  runwayFt: Derived<number>;
  rcrDry: Derived<number>;
  rcrWet: Derived<number>;
}

/** ISA sea-level pressure, inHg (101,325 Pa). */
export const ISA_P0_INHG = 29.921;
/** ISA exponent R·L/g. */
export const ISA_INV = 0.190263;
/** Feet per unit of (1 − (p/p0)^ISA_INV): T0 / L in feet. */
const ISA_HEIGHT_FT = 145442;

/** The pilot's hand calculation from the altimeter setting; inHg lives only here. Not a model of the DCS altimeter. */
export function pressureAltitudeFt(fieldElevFt: number, altimeterInHg: number): number {
  return fieldElevFt + ISA_HEIGHT_FT * (1 - (altimeterInHg / ISA_P0_INHG) ** ISA_INV);
}

/** (far − near) / length × 100, uphill positive. */
export function slopePercent(nearElevFt: number, farElevFt: number, lengthFt: number): number {
  return ((farElevFt - nearElevFt) / lengthFt) * 100;
}

/** Headwind from the steady wind, crosswind (> 0 from the right) from the gust when there is one. */
export function windComponents(wind: Wind, headingDeg: number): { headwindKt: number; crosswindKt: number } {
  const angleRad = ((wind.directionDeg - headingDeg) * Math.PI) / 180;
  const crossSpeedKt = wind.gustKt ?? wind.speedKt;
  return { headwindKt: wind.speedKt * Math.cos(angleRad), crosswindKt: crossSpeedKt * Math.sin(angleRad) };
}

type Parsed<T> = { readonly field: InputField; readonly parsed: Field<T> };

function numberField(
  inputs: Inputs,
  field: InputField,
  within: (value: number) => boolean = () => true,
): Parsed<number> {
  const parsed = parseNumber(inputs[field]);
  return { field, parsed: parsed.ok && !within(parsed.value) ? { ok: false } : parsed };
}

/** The failed result: the fields among `parts` that did not parse. */
function notOk(...parts: readonly Parsed<unknown>[]): { readonly ok: false; readonly fields: readonly InputField[] } {
  return { ok: false, fields: parts.filter((part) => !part.parsed.ok).map((part) => part.field) };
}

function single<T>(part: Parsed<T>): Derived<T> {
  return part.parsed.ok ? part.parsed : notOk(part);
}

export function deriveInputs(inputs: Inputs): DerivedInputs {
  const length = numberField(inputs, 'lengthFt', (ft) => ft > 0);
  const heading = numberField(inputs, 'headingDeg', (deg) => deg >= 1 && deg <= 360);
  const altimeter = numberField(inputs, 'altimeterInHg', (inHg) => inHg > 0);
  const nearElev = numberField(inputs, 'nearElevFt');
  const farElev = numberField(inputs, 'farElevFt');
  const wind: Parsed<Wind> = { field: 'wind', parsed: parseWind(inputs.wind) };

  const a = altimeter.parsed;
  const n = nearElev.parsed;
  const f = farElev.parsed;
  const l = length.parsed;
  const h = heading.parsed;
  const w = wind.parsed;
  const components = w.ok && h.ok ? windComponents(w.value, h.value) : null;

  return {
    paFt: n.ok && a.ok ? { ok: true, value: pressureAltitudeFt(n.value, a.value) } : notOk(nearElev, altimeter),
    tempC: single(numberField(inputs, 'tempC')),
    takeoffGwLb: single(numberField(inputs, 'takeoffGwLb')),
    landingGwLb: single(numberField(inputs, 'landingGwLb')),
    cgPct: single(numberField(inputs, 'cgPct')),
    headwindKt: components === null ? notOk(wind, heading) : { ok: true, value: components.headwindKt },
    crosswindKt: components === null ? notOk(wind, heading) : { ok: true, value: components.crosswindKt },
    gustKt: w.ok ? { ok: true, value: w.value.gustKt } : notOk(wind),
    slopePct:
      n.ok && f.ok && l.ok
        ? { ok: true, value: slopePercent(n.value, f.value, l.value) }
        : notOk(nearElev, farElev, length),
    runwayFt: single(length),
    rcrDry: single(numberField(inputs, 'rcrDry')),
    rcrWet: single(numberField(inputs, 'rcrWet')),
  };
}
