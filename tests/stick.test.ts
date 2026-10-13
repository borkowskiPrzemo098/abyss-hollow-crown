import { describe, expect, it } from 'vitest';
import { STICK_RADIUS, stickVector } from '../src/input/stick';

const speed = (dx: number, dy: number) => {
  const o = stickVector(dx, dy);
  return Math.hypot(o.x, o.y);
};

describe('virtual joystick', () => {
  it('is still inside the dead zone', () => {
    expect(speed(3, 0)).toBe(0);
  });

  it('reaches full speed well before the edge of the ring', () => {
    expect(speed(STICK_RADIUS * 0.5, 0)).toBeCloseTo(1, 6);
  });

  it('keeps full speed when the thumb slides far outside the ring (regression)', () => {
    for (const k of [1, 1.5, 2, 4, 10]) {
      expect(speed(STICK_RADIUS * k, 0), `at ${k}× radius`).toBeCloseTo(1, 6);
      expect(speed(STICK_RADIUS * k * 0.6, STICK_RADIUS * k * 0.8)).toBeCloseTo(1, 6);
    }
  });

  it('keeps the knob on the ring and moves the base by the overshoot', () => {
    const o = stickVector(STICK_RADIUS * 3, 0);
    expect(o.knobX).toBeCloseTo(STICK_RADIUS, 6);
    expect(o.baseShiftX).toBeCloseTo(STICK_RADIUS * 2, 6);
    const inside = stickVector(STICK_RADIUS * 0.5, 0);
    expect(inside.baseShiftX).toBe(0);
  });

  it('points where the thumb points', () => {
    const o = stickVector(-30, 40);
    expect(Math.atan2(o.y, o.x)).toBeCloseTo(Math.atan2(40, -30), 9);
  });
});
