/**
 * The TOLD page's input fields (TOLD 1.8): reads and writes them as typed, the RCR field as "dry / wet" over the two
 * `rcrDry` and `rcrWet` inputs, the Additional drag index from the builder's own field. It marks a field with the
 * grey dotted underline (`unparsed`), the RCR field red (`alert`) for RCR below 10 at the landing field, and writes
 * the derived line under section II.
 */
import type { InputField, Inputs } from '../../core/inputs/inputs.ts';

import { joinRcr, splitRcr } from './field-text.ts';

export interface InputsView {
  /** Every field as typed. */
  read(): Inputs;
  /** Fills every field (on load and on a pasted link); typing never calls it, so the caret stays. */
  write(inputs: Inputs): void;
  mark(unparsed: ReadonlySet<InputField>, rcrAlert: boolean): void;
  derived(lines: readonly string[]): void;
}

/** The fields with their own input; RCR dry and wet share one, Additional is the builder's. */
const PLAIN: readonly InputField[] = [
  'takeoffGwLb',
  'landingGwLb',
  'cgPct',
  'runway',
  'headingDeg',
  'lengthFt',
  'nearElevFt',
  'farElevFt',
  'altimeterInHg',
  'tempC',
  'wind',
];

function fieldInput(root: ParentNode, name: string): HTMLInputElement {
  const input = root.querySelector(`input[data-field="${name}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`the page has no input "${name}"`);
  return input;
}

export function mountInputs(
  root: ParentNode,
  additional: HTMLInputElement,
  derivedBox: HTMLElement,
  onInput: () => void,
): InputsView {
  const plain = new Map(PLAIN.map((field) => [field, fieldInput(root, field)] as const));
  const rcr = fieldInput(root, 'rcr');
  const all = [...plain.values(), rcr, additional];
  for (const input of all) {
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('input', onInput);
  }
  const text = (field: InputField): string => plain.get(field)?.value ?? '';

  return {
    read(): Inputs {
      const { dry, wet } = splitRcr(rcr.value);
      return {
        takeoffGwLb: text('takeoffGwLb'),
        landingGwLb: text('landingGwLb'),
        cgPct: text('cgPct'),
        additionalDragIndex: additional.value,
        runway: text('runway'),
        headingDeg: text('headingDeg'),
        lengthFt: text('lengthFt'),
        nearElevFt: text('nearElevFt'),
        farElevFt: text('farElevFt'),
        altimeterInHg: text('altimeterInHg'),
        tempC: text('tempC'),
        wind: text('wind'),
        rcrDry: dry,
        rcrWet: wet,
      };
    },
    write(inputs: Inputs): void {
      for (const [field, input] of plain) input.value = inputs[field];
      rcr.value = joinRcr(inputs.rcrDry.trim(), inputs.rcrWet.trim());
      additional.value = inputs.additionalDragIndex;
    },
    mark(unparsed: ReadonlySet<InputField>, rcrAlert: boolean): void {
      for (const [field, input] of plain) input.classList.toggle('unparsed', unparsed.has(field));
      rcr.classList.toggle('unparsed', unparsed.has('rcrDry') || unparsed.has('rcrWet'));
      rcr.classList.toggle('alert', rcrAlert);
      additional.classList.toggle('unparsed', unparsed.has('additionalDragIndex'));
    },
    derived(lines: readonly string[]): void {
      derivedBox.replaceChildren(
        ...lines.map((line) => {
          const span = document.createElement('span');
          span.textContent = line;
          return span;
        }),
      );
    },
  };
}
