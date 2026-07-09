import { describe, it, expect } from 'vitest';
import { midiToFrequency, midiToNoteName, isBlackKey } from './pitch.js';

describe('pitch', () => {
  it('maps A4 (69) to 440 Hz', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
  });

  it('maps one octave up to double frequency', () => {
    expect(midiToFrequency(81)).toBeCloseTo(880, 6);
  });

  it('names middle C (60) as C4 and 69 as A4', () => {
    expect(midiToNoteName(60)).toBe('C4');
    expect(midiToNoteName(69)).toBe('A4');
    expect(midiToNoteName(61)).toBe('C#4');
  });

  it('identifies black keys by pitch class', () => {
    expect(isBlackKey(61)).toBe(true); // C#4
    expect(isBlackKey(60)).toBe(false); // C4
    expect(isBlackKey(66)).toBe(true); // F#4
  });
});
