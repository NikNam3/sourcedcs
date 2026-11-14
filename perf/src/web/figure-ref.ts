/**
 * A figure view's name, shared by the TOLD page's "Fig." links and the figure page (TOLD 1.8): the figure without
 * its sheet and the view. No DOM.
 */

/** takeoff: MIL and MAX AB together; normal, heavy: a landing weight, dry and wet together. */
export type View = 'takeoff' | 'normal' | 'heavy';

/** The figure a figure file belongs to: 'B2-6.sh2' → 'B2-6'; 'B2-3' unchanged. */
export const figureOf = (fileId: string): string => fileId.replace(/\.sh\d+$/, '');
