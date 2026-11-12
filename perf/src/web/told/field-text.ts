/**
 * The TOLD page's typed text → the core's `Inputs` (TOLD 1.8 "The TOLD page"). The state keeps every field as typed;
 * only the copy given to `computeTold` is normalised: thousands separators stripped ("37,240" → "37240"), the wind's
 * spaces removed ("230 / 08 G15" → "230/08G15"), and an empty field with a default (CG, additional drag index, RCR
 * dry and wet) given that default. RCR is one field on the page, "dry / wet". Pure: no DOM.
 */
import { DEFAULT_INPUTS } from '../../core/inputs/inputs.ts';
import type { InputField, Inputs } from '../../core/inputs/inputs.ts';

/** The fields whose empty value means the default; the page shows the default as the placeholder. */
export const DEFAULTED: readonly InputField[] = Object.freeze(['cgPct', 'additionalDragIndex', 'rcrDry', 'rcrWet']);

/** Fields that are not numbers: the runway's name (never parsed) and the wind. */
const TEXT_FIELDS: ReadonlySet<InputField> = new Set(['runway', 'wind']);

/** "37,240" → "37240". */
export const plainNumber = (text: string): string => text.replaceAll(',', '');

/** "230 / 08 G15" → "230/08G15". */
export const plainWind = (text: string): string => text.replace(/\s+/g, '');

/** The RCR field "dry / wet": split at the first `/`, each part trimmed; an empty part means its default. */
export function splitRcr(text: string): { dry: string; wet: string } {
  const at = text.indexOf('/');
  if (at < 0) return { dry: text.trim(), wet: '' };
  return { dry: text.slice(0, at).trim(), wet: text.slice(at + 1).trim() };
}

/** The RCR field's text for the two parts; `splitRcr` gives them back. */
export function joinRcr(dry: string, wet: string): string {
  if (wet === '') return dry;
  return dry === '' ? `/ ${wet}` : `${dry} / ${wet}`;
}

/** The copy of the typed inputs `computeTold` gets. */
export function computeInputs(typed: Inputs): Inputs {
  const out: Inputs = { ...typed };
  for (const field of Object.keys(typed) as InputField[]) {
    const text = typed[field];
    if (DEFAULTED.includes(field) && text.trim() === '') out[field] = DEFAULT_INPUTS[field];
    else if (field === 'wind') out[field] = plainWind(text);
    else if (!TEXT_FIELDS.has(field)) out[field] = plainNumber(text);
  }
  return out;
}

/** The inputs with every defaulted field empty: a page that starts from the defaults shows them as placeholders. */
export function blankDefaults(inputs: Inputs): Inputs {
  const out: Inputs = { ...inputs };
  for (const field of DEFAULTED) out[field] = '';
  return out;
}
