// Tuner scope history (cents over time). Written ~90×/s by the analysis handler and drawn on a
// canvas each frame, so it never goes through React.

export interface TrailPoint {
  c: number;
  t: number;
}

const MAX_AGE = 4500;
const pts: TrailPoint[] = [];

export const trail = {
  push(c: number, t: number) {
    // ~40 points/s is visually continuous at 44 px/s; denser just costs draw time.
    if (pts.length && t - pts[pts.length - 1].t < 24) return;
    pts.push({ c, t });
    while (pts.length && t - pts[0].t > MAX_AGE) pts.shift();
  },
  clear() {
    pts.length = 0;
  },
  points: pts as readonly TrailPoint[],
  MAX_AGE,
};
