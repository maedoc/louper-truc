import { describe, it, expect, beforeEach } from 'vitest';
import { clampViewStart, s } from '../state.js';

describe('clampViewStart', () => {
  beforeEach(() => {
    s.duration = 100;
    s.cssW = 50;
    s.zoom = 1;
  });

  it('clamps to 0', () => {
    expect(clampViewStart(-1)).toBe(0);
  });

  it('clamps to max viewable start', () => {
    expect(clampViewStart(200)).toBe(50);
  });

  it('returns value within bounds', () => {
    expect(clampViewStart(25)).toBe(25);
  });
});
