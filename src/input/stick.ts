/**
 * Virtual joystick maths, kept free of the DOM so it can be unit-tested.
 */
export const STICK_RADIUS = 52;
export const DEAD_ZONE = 0.12;
/**
 * Stick travel (fraction of the radius) at which the hero reaches full speed.
 * Beyond it — including anywhere outside the ring — speed is always 100%.
 */
export const FULL_SPEED_AT = 0.45;

export interface StickOutput {
  /** Movement vector (screen space), magnitude 0..1. */
  x: number;
  y: number;
  /** Knob offset from the base, clamped to the ring (px). */
  knobX: number;
  knobY: number;
  /** How far the base must follow the finger so the knob stays on the ring (px). */
  baseShiftX: number;
  baseShiftY: number;
}

/**
 * Converts a finger offset from the joystick base into a movement vector.
 * Direction comes from the finger; speed depends only on travel *inside* the
 * ring, so a thumb that drifts past the edge never slows the hero down.
 * (The old code clamped the knob but divided by the unclamped distance, so
 * speed fell as 1/distance once the thumb left the ring.)
 */
export function stickVector(dx: number, dy: number): StickOutput {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: 0, knobX: 0, knobY: 0, baseShiftX: 0, baseShiftY: 0 };
  const ux = dx / len;
  const uy = dy / len;
  const travel = Math.min(1, len / STICK_RADIUS);
  const over = Math.max(0, len - STICK_RADIUS);
  const mag = travel < DEAD_ZONE ? 0 : Math.min(1, (travel - DEAD_ZONE) / (FULL_SPEED_AT - DEAD_ZONE));
  return {
    x: ux * mag,
    y: uy * mag,
    knobX: ux * Math.min(len, STICK_RADIUS),
    knobY: uy * Math.min(len, STICK_RADIUS),
    baseShiftX: ux * over,
    baseShiftY: uy * over,
  };
}
