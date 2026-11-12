/**
 * A path mark (TOLD 1.8, "Path geometry"): where the exact path entered and left one panel it read, every value in
 * the panel's own chart units (the numbers its `axes` transforms take), exactly the numbers passed to and returned
 * from its `read/` block. `figure` is the figure file id (`B2-5.sh1`), `panel` the panel id. A panel that returned
 * OutOfChart is not marked, nor a guideline panel skipped for a zero target, nor a limit line or a table read: they
 * are not a chart path. The figure page lays out each kind; geometry is not the core's job.
 */
import type { GuidelinePanel } from '../data/types.ts';

interface MarkBase {
  readonly figure: string;
  readonly panel: string;
}

export type PathMark =
  | (MarkBase & {
      readonly kind: 'curve_family';
      readonly input: number;
      readonly param: number;
      readonly output: number;
    })
  | (MarkBase & { readonly kind: 'single_curve'; readonly input: number; readonly output: number })
  | (MarkBase & { readonly kind: 'scale_pair'; readonly from: number; readonly to: number })
  | (MarkBase & {
      readonly kind: 'guideline_panel';
      readonly family: string;
      readonly baseline: number;
      readonly entry: number;
      readonly target: number;
      readonly exit: number;
    });

/** The mark of a guideline panel read that moved `entry` to `exit` along `family`, from the baseline to `target`. */
export function guidelineMark(
  figure: string,
  p: GuidelinePanel,
  family: string,
  entry: number,
  target: number,
  exit: number,
): PathMark {
  return { kind: 'guideline_panel', figure, panel: p.id, family, baseline: p.baseline, entry, target, exit };
}
