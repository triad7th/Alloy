// PatchEngine: polyphonic voice pool over a sample-position transport clock.
// Events are scheduled at absolute frames and applied sample-accurately:
// process() renders segment-wise up to each due event's exact offset, applies
// every event at that frame in schedule order, and continues. Rendering ADDS
// into the caller's buffer through one preallocated segment scratch, so the
// engine allocates only when voices start. Twin: PatchEngine.swift.

import { validatePatch, type Patch } from './patch.js';
import { Voice, type ZoneSetProvider } from './voice.js';

export type EngineEvent =
  | { frame: number; kind: 'noteOn'; midi: number; velocity: number }
  | { frame: number; kind: 'noteOff'; midi: number }
  | { frame: number; kind: 'allNotesOff' };

export interface PatchEngineOptions {
  /** Polyphony cap (default 64); at the cap a voice is stolen. */
  maxVoices?: number;
  zoneSetProvider?: ZoneSetProvider;
}

const DEFAULT_MAX_VOICES = 64;

/** Largest frames-per-process() call (hosts use 128); sizes the segment scratch. */
const MAX_BLOCK_FRAMES = 4096;

interface VoiceEntry {
  readonly midi: number;
  readonly voice: Voice;
  /** Transport frame the voice started at; drives steal priority. */
  readonly startFrame: number;
  /** Keyed up (noteOff/restrike/allNotesOff); stays pooled until silent. */
  released: boolean;
  /** Last render() return; false = silent and reapable. */
  alive: boolean;
}

export class PatchEngine {
  private patch: Patch | null = null;
  private voices: VoiceEntry[] = [];
  /** Pending events, sorted by frame; equal frames keep schedule order. */
  private queue: EngineEvent[] = [];
  private frameCount = 0;
  private readonly maxVoices: number;
  private readonly zoneSetProvider: ZoneSetProvider | undefined;
  /** Per-segment mix buffer; voices add into it, process() adds it into out. */
  private readonly scratch = new Float32Array(MAX_BLOCK_FRAMES);

  constructor(
    private readonly sampleRate: number,
    options?: PatchEngineOptions,
  ) {
    this.maxVoices = options?.maxVoices ?? DEFAULT_MAX_VOICES;
    this.zoneSetProvider = options?.zoneSetProvider;
  }

  /**
   * Throws on validatePatch errors (joined with '; '). New notes use the new
   * patch; sounding voices finish on the old one.
   */
  setPatch(patch: Patch): void {
    const errors = validatePatch(patch);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
    this.patch = patch;
  }

  /** Sample-position transport clock: frames rendered since construction. */
  get frame(): number {
    return this.frameCount;
  }

  /** Live pool entries (sounding + releasing, before reap). */
  get activeVoiceCount(): number {
    return this.voices.length;
  }

  /**
   * Schedule at an absolute frame. Events at frames already passed fire at
   * the start of the next process() block. Same-frame events fire in
   * schedule order (stable insert).
   */
  schedule(event: EngineEvent): void {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].frame > event.frame) {
      i--;
    }
    this.queue.splice(i, 0, event);
  }

  /** Renders the next `frames` samples ADDING into out[0..frames); advances the transport. */
  process(out: Float32Array, frames: number): void {
    if (frames > MAX_BLOCK_FRAMES) {
      throw new Error(`process frames ${frames} exceeds ${MAX_BLOCK_FRAMES}`);
    }
    let pos = 0;
    while (pos < frames) {
      while (this.queue.length > 0 && this.queue[0].frame <= this.frameCount + pos) {
        const event = this.queue[0];
        this.queue.shift();
        this.apply(event, this.frameCount + pos);
      }
      let end = frames;
      if (this.queue.length > 0) {
        const rel = this.queue[0].frame - this.frameCount;
        if (rel < end) {
          end = rel;
        }
      }
      this.renderSegment(out, pos, end - pos);
      pos = end;
    }
    this.frameCount += frames;
  }

  private apply(event: EngineEvent, currentFrame: number): void {
    switch (event.kind) {
      case 'noteOn':
        this.noteOn(event.midi, event.velocity, currentFrame);
        break;
      case 'noteOff':
        this.noteOff(event.midi);
        break;
      case 'allNotesOff':
        for (const entry of this.voices) {
          entry.voice.quickRelease();
          entry.released = true;
        }
        break;
    }
  }

  private noteOn(midi: number, velocity: number, currentFrame: number): void {
    if (this.patch === null) {
      return; // No patch loaded yet: note events are silently ignored.
    }
    const restruck = this.voices.find((e) => e.midi === midi && !e.released);
    if (restruck) {
      restruck.voice.quickRelease();
      restruck.released = true; // Stays pooled until silent.
    }
    if (this.voices.length >= this.maxVoices) {
      this.steal();
    }
    const voice = new Voice(this.patch, this.sampleRate, this.zoneSetProvider);
    voice.noteOn(midi, velocity);
    this.voices.push({ midi, voice, startFrame: currentFrame, released: false, alive: true });
  }

  /** Keys up the newest non-released entry for that midi (if any). */
  private noteOff(midi: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const entry = this.voices[i];
      if (entry.midi === midi && !entry.released) {
        entry.released = true;
        entry.voice.noteOff();
        return;
      }
    }
  }

  /**
   * At the cap: drop the earliest-started released entry, or the earliest
   * overall if none is released. A hard drop is acceptable for 1b; a
   * dying-voice fade list is a later refinement.
   */
  private steal(): void {
    let earliest = 0;
    let earliestReleased = -1;
    for (let i = 0; i < this.voices.length; i++) {
      const entry = this.voices[i];
      if (entry.startFrame < this.voices[earliest].startFrame) {
        earliest = i;
      }
      if (entry.released && (earliestReleased === -1 || entry.startFrame < this.voices[earliestReleased].startFrame)) {
        earliestReleased = i;
      }
    }
    this.voices.splice(earliestReleased !== -1 ? earliestReleased : earliest, 1);
  }

  /** Zero the scratch segment, have every voice add into it, add it into out; reap silent voices. */
  private renderSegment(out: Float32Array, offset: number, length: number): void {
    this.scratch.fill(0, 0, length);
    for (const entry of this.voices) {
      entry.alive = entry.voice.render(this.scratch, length);
    }
    for (let i = 0; i < length; i++) {
      out[offset + i] += this.scratch[i];
    }
    let kept = 0;
    for (const entry of this.voices) {
      if (entry.alive) {
        this.voices[kept] = entry;
        kept++;
      }
    }
    this.voices.length = kept;
  }
}

/** renderPatch block size — matches the 1b-ii host quantum. */
const RENDER_BLOCK_FRAMES = 128;

/**
 * Offline render harness — the golden-test and future bounce path. Fresh
 * engine, schedule all, process in 128-frame blocks (last block short),
 * return the full buffer.
 */
export function renderPatch(
  patch: Patch,
  events: readonly EngineEvent[],
  totalFrames: number,
  sampleRate: number,
  zoneSetProvider?: ZoneSetProvider,
): Float32Array {
  const engine = new PatchEngine(sampleRate, { zoneSetProvider });
  engine.setPatch(patch);
  for (const event of events) {
    engine.schedule(event);
  }
  const out = new Float32Array(totalFrames);
  for (let offset = 0; offset < totalFrames; offset += RENDER_BLOCK_FRAMES) {
    const n = Math.min(RENDER_BLOCK_FRAMES, totalFrames - offset);
    engine.process(out.subarray(offset, offset + n), n);
  }
  return out;
}
