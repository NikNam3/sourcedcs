/**
 * Which typed fields get the grey dotted underline (TOLD 1.8): a filled field that does not parse or fails a physical
 * limit, decided from `deriveInputs`' result for the field, never from `parseNumber` alone. An empty field is never
 * underlined (empty is not an error; a defaulted one means its default). Pure: no DOM.
 */
import type { Derived, DerivedInputs } from '../../core/inputs/derive.ts';
import type { InputField, Inputs } from '../../core/inputs/inputs.ts';

/**
 * The filled fields some derived value names as not computing. The additional drag index is not a derived input:
 * `additionalOk` is its parse (`computeTold` reads it with `parseNumber`).
 */
export function unparsedFields(typed: Inputs, derived: DerivedInputs, additionalOk: boolean): ReadonlySet<InputField> {
  const named = new Set<InputField>();
  for (const value of Object.values(derived) as Derived<unknown>[]) {
    if (!value.ok) for (const field of value.fields) named.add(field);
  }
  if (!additionalOk) named.add('additionalDragIndex');
  return new Set([...named].filter((field) => typed[field].trim() !== ''));
}
