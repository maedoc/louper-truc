import { describe, it, expect } from 'vitest';

function computePeaks(buffer) {
  const BLOCK = 64;
  const n = buffer.getChannelData(0).length;
  const blocks = Math.ceil(n / BLOCK);
  const channels = buffer.numberOfChannels;
  const peaks = new Float32Array(blocks * 2);
  for (let i = 0; i < blocks; i++) {
    let min = 1, max = -1;
    const a = i * BLOCK;
    const b = Math.min(a + BLOCK, n);
    for (let c = 0; c < channels; c++) {
      const ch = buffer.getChannelData(c);
      for (let j = a; j < b; j++) {
        const v = ch[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }
  return peaks;
}

function makeMockBuffer(channels, length) {
  const data = [];
  for (let c = 0; c < channels; c++) {
    data.push(new Float32Array(length));
  }
  return {
    numberOfChannels: channels,
    getChannelData: (c) => data[c],
    length,
    sampleRate: 44100,
    duration: length / 44100,
  };
}

describe('computePeaks', () => {
  it('handles mono buffer', () => {
    const buf = makeMockBuffer(1, 128);
    buf.getChannelData(0)[0] = 0.5;
    buf.getChannelData(0)[64] = -0.3;
    const peaks = computePeaks(buf);
    expect(peaks.length).toBe(4);
    expect(peaks[1]).toBeCloseTo(0.5);
    expect(peaks[2]).toBeCloseTo(-0.3);
  });

  it('handles stereo buffer with max of channels', () => {
    const buf = makeMockBuffer(2, 64);
    buf.getChannelData(0)[0] = 0.2;
    buf.getChannelData(1)[0] = 0.8;
    const peaks = computePeaks(buf);
    expect(peaks[0]).toBeCloseTo(0.0);
    expect(peaks[1]).toBeCloseTo(0.8);
  });

  it('handles empty buffer', () => {
    const buf = makeMockBuffer(1, 0);
    const peaks = computePeaks(buf);
    expect(peaks.length).toBe(0);
  });

  it('handles partial last block', () => {
    const buf = makeMockBuffer(1, 100);
    buf.getChannelData(0)[0] = 0.5;
    buf.getChannelData(0)[99] = -0.7;
    const peaks = computePeaks(buf);
    expect(peaks.length).toBe(4);
  });
});
