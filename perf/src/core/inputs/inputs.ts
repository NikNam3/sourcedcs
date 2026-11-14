/**
 * The TOLD page's inputs, every field as the pilot typed it (TOLD 1.7). Parsing and the derived values are
 * `parse.ts` and `derive.ts`; the loadout is not here, it is passed beside these.
 */
export interface Inputs {
  takeoffGwLb: string;
  landingGwLb: string;
  cgPct: string;
  additionalDragIndex: string;
  /** The runway's name, e.g. "22L"; shown, never parsed. */
  runway: string;
  /** Magnetic. */
  headingDeg: string;
  lengthFt: string;
  /** Near-end threshold, where the roll starts: pressure altitude is taken here. */
  nearElevFt: string;
  farElevFt: string;
  altimeterInHg: string;
  tempC: string;
  /** Magnetic, `ddd/ss` or `ddd/ssGgg`. */
  wind: string;
  rcrDry: string;
  rcrWet: string;
}

export type InputField = keyof Inputs;

export const DEFAULT_INPUTS: Inputs = {
  takeoffGwLb: '',
  landingGwLb: '',
  cgPct: '35',
  additionalDragIndex: '0',
  runway: '',
  headingDeg: '',
  lengthFt: '',
  nearElevFt: '',
  farElevFt: '',
  altimeterInHg: '',
  tempC: '',
  wind: '',
  rcrDry: '23',
  rcrWet: '18',
};
