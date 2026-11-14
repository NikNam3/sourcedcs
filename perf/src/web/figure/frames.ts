/**
 * Where each chart panel is drawn on its page (PDF points), and on which edge each scaled axis is printed: copied from
 * the extraction specs (`extraction/specs/<id>.yaml`, each panel's `frame` and each axis's `edge`), which the chart
 * data does not carry. The figure view needs them for a path's ends: a path enters at the input axis's edge and leaves
 * at the output axis's edge. `tests/web-frames.test.ts` keeps this table equal to the specs. No DOM.
 */

export type Edge = 'left' | 'right' | 'top' | 'bottom';

export interface Frame {
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
}

export interface FigureFrames {
  /** The edge each scaled axis is printed on, by quantity name. */
  readonly edges: Readonly<Record<string, Edge>>;
  /** Each panel's frame, by panel id. */
  readonly panels: Readonly<Record<string, Frame>>;
}

/** By figure file id, for every figure a TOLD chain reads. */
export const FRAMES: Readonly<Record<string, FigureFrames>> = {
  'B2-1': {
    edges: { tof_mil: 'bottom', tof_ab: 'bottom', temperature: 'left' },
    panels: {
      pa: { x: [167.9, 508.3], y: [125.5, 636] },
      ab: { x: [153.6, 489.2], y: [636, 666.9] },
    },
  },
  'B2-2': {
    edges: { gross_weight: 'bottom', takeoff_speed: 'left' },
    panels: {
      speed: { x: [94.3, 548.1], y: [272.2, 555.8] },
    },
  },
  'B2-3': {
    edges: { distance: 'bottom', takeoff_factor: 'left', cg: 'left', drag_index: 'left', slope: 'left', wind: 'left' },
    panels: {
      gw: { x: [104, 536.2], y: [136.3, 352.4] },
      cg: { x: [104, 536.2], y: [363.3, 435.4] },
      di: { x: [104, 536.2], y: [446.4, 518.5] },
      slope: { x: [104, 536.2], y: [529.4, 601.5] },
      wind: { x: [104, 536.2], y: [612.4, 684.5] },
    },
  },
  'B2-4': {
    edges: {
      takeoff_factor: 'left',
      accel_check_speed: 'bottom',
      gross_weight: 'left',
      drag_index: 'left',
      wind: 'left',
      slope: 'left',
    },
    panels: {
      distance: { x: [109.1, 534.6], y: [143.3, 285.1] },
      gw: { x: [109.1, 534.6], y: [297.5, 496.1] },
      di: { x: [109.1, 534.6], y: [508.4, 550.9] },
      wind: { x: [109.1, 534.6], y: [563.4, 620] },
      slope: { x: [109.1, 534.6], y: [632.4, 675] },
    },
  },
  'B2-5.sh1': {
    edges: { takeoff_factor: 'right', refusal_speed: 'right', wind: 'bottom', slope: 'bottom' },
    panels: {
      gw: { x: [71, 287.1], y: [518.3, 698.4] },
      runway: { x: [71, 287.1], y: [199.7, 487.8] },
      wind: { x: [335.6, 407.7], y: [199.7, 487.8] },
      slope: { x: [456.5, 510.6], y: [199.7, 487.8] },
    },
  },
  'B2-5.sh2': {
    edges: { takeoff_factor: 'right', refusal_speed: 'right', wind: 'bottom', slope: 'bottom' },
    panels: {
      gw: { x: [83.6, 227.7], y: [516.8, 696.9] },
      runway: { x: [83.6, 227.7], y: [194.3, 482.4] },
      wind: { x: [304.6, 376.6], y: [194.3, 482.4] },
      slope: { x: [448.9, 502.9], y: [194.3, 482.4] },
    },
  },
  'B2-5.sh3': {
    edges: { takeoff_factor: 'right', refusal_speed: 'right', wind: 'bottom', slope: 'bottom' },
    panels: {
      gw_snow: { x: [56.8, 200.9], y: [516.7, 696.8] },
      runway_snow: { x: [56.8, 200.9], y: [199.4, 487.6] },
      gw_icy: { x: [233.7, 341.8], y: [516.7, 696.8] },
      runway_icy: { x: [233.7, 341.8], y: [199.4, 487.6] },
      wind: { x: [372.5, 444.5], y: [199.4, 487.6] },
      slope: { x: [471.6, 525.7], y: [199.4, 487.6] },
    },
  },
  'B2-6.sh1': {
    edges: { takeoff_factor: 'right', refusal_speed: 'right', wind: 'bottom', slope: 'bottom' },
    panels: {
      gw: { x: [88.8, 268.8], y: [487.6, 703.7] },
      runway: { x: [88.8, 268.8], y: [185, 473.2] },
      wind: { x: [319.9, 392], y: [185, 473.2] },
      slope: { x: [443.8, 497.8], y: [185, 473.2] },
    },
  },
  'B2-6.sh2': {
    edges: { takeoff_factor: 'right', refusal_speed: 'right', wind: 'bottom', slope: 'bottom' },
    panels: {
      gw: { x: [90.1, 234.2], y: [487, 703.1] },
      runway: { x: [90.1, 234.2], y: [184.4, 472.5] },
      wind: { x: [302.3, 374.4], y: [184.4, 472.5] },
      slope: { x: [442.5, 496.6], y: [184.4, 472.5] },
    },
  },
  'B2-6.sh3': {
    edges: { takeoff_factor: 'right', refusal_speed: 'right', wind: 'bottom', slope: 'bottom' },
    panels: {
      gw_snow: { x: [69.4, 177.5], y: [487.4, 703.6] },
      runway_snow: { x: [69.4, 177.5], y: [190.5, 478.7] },
      gw_icy: { x: [202.1, 310.1], y: [487.4, 703.6] },
      runway_icy: { x: [202.1, 310.1], y: [190.5, 478.7] },
      wind: { x: [347.9, 419.9], y: [190.5, 478.7] },
      slope: { x: [458.2, 512.2], y: [190.5, 478.7] },
    },
  },
  'B7-1': {
    edges: { gross_weight: 'bottom', airspeed: 'left' },
    panels: {
      final_approach: { x: [103.1, 542.7], y: [254.3, 566.4] },
      touchdown: { x: [103.1, 542.7], y: [254.3, 566.4] },
    },
  },
  'B7-2.sh1': {
    edges: { pressure_altitude: 'left', ground_roll: 'right' },
    panels: {
      temp: { x: [100, 525.4], y: [179, 405.9] },
      gw: { x: [100, 525.4], y: [405.9, 689.6] },
      brake_energy: { x: [100, 525.4], y: [405.9, 689.6] },
      mlg_tire: { x: [100, 525.4], y: [405.9, 689.6] },
      nlg_tire: { x: [100, 525.4], y: [405.9, 689.6] },
    },
  },
  'B7-2.sh2': {
    edges: { uncorrected_roll: 'left', ground_roll: 'bottom', wind: 'left', slope: 'left' },
    panels: {
      rcr_dry: { x: [142.1, 482.5], y: [200, 540.3] },
      rcr_wet: { x: [142.1, 482.5], y: [200, 540.3] },
      wind: { x: [142.1, 482.5], y: [551.1, 607.9] },
      slope: { x: [142.1, 482.5], y: [618.6, 661.2] },
    },
  },
};
