/**
 * Isometric projection. World space is a square grid measured in tiles
 * (x grows to screen bottom-right, y grows to screen bottom-left).
 * Screen space is world pixels before camera zoom. Only rendering and
 * input-direction conversion touch screen space; all gameplay stays in world space.
 */
export const TILE_W = 64;
export const TILE_H = 32;
const HW = TILE_W / 2;
const HH = TILE_H / 2;

export function worldToScreenX(x: number, y: number): number {
  return (x - y) * HW;
}

export function worldToScreenY(x: number, y: number): number {
  return (x + y) * HH;
}

export function screenToWorld(sx: number, sy: number): { x: number; y: number } {
  return { x: (sx / HW + sy / HH) / 2, y: (sy / HH - sx / HW) / 2 };
}

/**
 * Converts a screen-space direction (joystick / WASD, y down) into a world-space
 * direction, keeping its magnitude. "Up" on screen moves the hero up on screen.
 */
export function screenDirToWorld(dx: number, dy: number): { x: number; y: number } {
  const mag = Math.min(1, Math.hypot(dx, dy));
  if (mag < 1e-6) return { x: 0, y: 0 };
  const w = screenToWorld(dx, dy);
  const l = Math.hypot(w.x, w.y);
  return { x: (w.x / l) * mag, y: (w.y / l) * mag };
}

/** Screen-space angle of a world-space direction (for rotating sprites). */
export function worldDirToScreenAngle(dx: number, dy: number): number {
  return Math.atan2((dx + dy) * HH, (dx - dy) * HW);
}

/** Depth key for painter's sorting of objects standing on the floor. */
export function depthOf(x: number, y: number): number {
  return 100 + (x + y) * 10;
}
