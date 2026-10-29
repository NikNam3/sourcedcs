/**
 * Figure B2-5, Refusal Speed (Non-AB): sheet 1 dry concrete (RCR 23), sheet 2 wet concrete (RCR 18), sheet 3 snow
 * (RCR 8) and icy (RCR 4), each read by `refusalSpeed`. Sheets 1 and 2 print a decrement for the second RCR of their
 * runway kind; it applies to the read speed and is a correction, not a rounding point.
 */
import type { Ctx } from '../ctx.ts';
import type { FigureFile } from '../data/types.ts';
import { ok } from '../result.ts';
import type { Read } from '../result.ts';

import { refusalSpeed } from './refusal-speed.ts';
import type { RefusalInputs } from './refusal-speed.ts';

/** "FOR RCR=16 (DRY) DECREASE REFUSAL SPEED BY 4 KIAS FOR ALL GW'S." (sheet 1). */
const RCR16_DECREMENT_KT = 4;
/** "FOR RCR=12 (WET) DECREASE REFUSAL SPEED BY 9 KIAS FOR ALL GW'S." (sheet 2). */
const RCR12_DECREMENT_KT = 9;

function decreased(read: Read<number>, kt: number): Read<number> {
  return read.ok ? ok(read.value - kt) : read;
}

/** Sheet 1 (`B2-5.sh1`): ids `b2-5.sh1.runway`, `.wind`, `.slope`; RCR 16 is RCR 23 - 4 KIAS. */
export function refusalNonAbDry(
  ctx: Ctx,
  fig: FigureFile,
  i: RefusalInputs,
): { rcr23Kias: Read<number>; rcr16Kias: Read<number> } {
  const rcr23Kias = refusalSpeed(ctx, fig, 'b2-5.sh1', '', i);
  return { rcr23Kias, rcr16Kias: decreased(rcr23Kias, RCR16_DECREMENT_KT) };
}

/** Sheet 2 (`B2-5.sh2`): ids `b2-5.sh2.runway`, `.wind`, `.slope`; RCR 12 is RCR 18 - 9 KIAS. */
export function refusalNonAbWet(
  ctx: Ctx,
  fig: FigureFile,
  i: RefusalInputs,
): { rcr18Kias: Read<number>; rcr12Kias: Read<number> } {
  const rcr18Kias = refusalSpeed(ctx, fig, 'b2-5.sh2', '', i);
  return { rcr18Kias, rcr12Kias: decreased(rcr18Kias, RCR12_DECREMENT_KT) };
}

/** Sheet 3 (`B2-5.sh3`): the snow chart (ids `b2-5.sh3.snow.*`), then the icy chart (`b2-5.sh3.icy.*`). */
export function refusalNonAbSnowIcy(
  ctx: Ctx,
  fig: FigureFile,
  i: RefusalInputs,
): { rcr8Kias: Read<number>; rcr4Kias: Read<number> } {
  return {
    rcr8Kias: refusalSpeed(ctx, fig, 'b2-5.sh3', 'snow', i),
    rcr4Kias: refusalSpeed(ctx, fig, 'b2-5.sh3', 'icy', i),
  };
}
