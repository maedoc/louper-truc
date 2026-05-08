import { describe, it, expect } from 'vitest';

function parseSpeed(val) {
  return parseFloat(val) || 1;
}

function parseZoom(val) {
  return parseFloat(val) || 1;
}

function parseScrub(val) {
  return parseFloat(val) || 0;
}

describe('parseFloat guards', () => {
  it('parses valid speed', () => {
    expect(parseSpeed('0.5')).toBeCloseTo(0.5);
  });
  it('defaults invalid speed to 1', () => {
    expect(parseSpeed('abc')).toBe(1);
    expect(parseSpeed('')).toBe(1);
    expect(parseSpeed(NaN)).toBe(1);
  });
  it('parses valid zoom', () => {
    expect(parseZoom('50')).toBe(50);
  });
  it('defaults invalid zoom to 1', () => {
    expect(parseZoom('bad')).toBe(1);
  });
  it('parses valid scrub', () => {
    expect(parseScrub('30.5')).toBeCloseTo(30.5);
  });
  it('defaults invalid scrub to 0', () => {
    expect(parseScrub('')).toBe(0);
  });
});
