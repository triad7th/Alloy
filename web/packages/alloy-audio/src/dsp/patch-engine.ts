// PatchEngine: polyphonic voice pool over a sample-position transport clock.
// Events are scheduled at absolute frames and applied sample-accurately:
// process() renders segment-wise up to each due event's exact offset, applies
// every event at that frame in schedule order, and continues. Voices stay
// mono; per segment the summed voice bus is copied to a stereo scratch pair
// at unity (insert-free ⇒ L === R === the old mono output), the patch's
// insert chain processes it in place, and the result ADDS into the caller's
// left/right buffers — all through preallocated scratches, so the engine
// allocates only when voices start (and in setPatch, the drain context,
// where the chain is rebuilt). Twin: PatchEngine.swift.

import { createInsert, type EffectUnit } from './effects/effect-types.js';
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
  /** Per-segment mono mix buffer; voices add into it. */
  private readonly scratch = new Float32Array(MAX_BLOCK_FRAMES);
  /** Per-segment stereo pair the insert chain processes in place. */
  private readonly scratchL = new Float32Array(MAX_BLOCK_FRAMES);
  private readonly scratchR = new Float32Array(MAX_BLOCK_FRAMES);
  /** Insert chain; rebuilt only in setPatch (see its doc comment). */
  private inserts: EffectUnit[] = [];

  constructor(
    private readonly sampleRate: number,
    options?: PatchEngineOptions,
  ) {
    this.maxVoices = Math.max(1, options?.maxVoices ?? DEFAULT_MAX_VOICES);
    this.zoneSetProvider = options?.zoneSetProvider;
  }

  /**
   * Throws on validatePatch errors (joined with '; '). New notes use the new
   * patch; sounding voices finish on the old one. The insert chain is
   * rebuilt here (the drain context — never in process) from the new patch;
   * it is one shared chain and effects are never reset on notes, so tails
   * ring across notes AND across setPatch: voices still sounding on the old
   * patch render through the NEW chain (hardware-like patch transition;
   * per-generation chains are an explicit non-goal).
   */
  setPatch(patch: Patch): void {
    const errors = validatePatch(patch);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
    this.patch = patch;
    this.inserts = (patch.inserts ?? []).map((spec) => createInsert(spec, this.sampleRate));
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

  /** Renders the next `frames` samples ADDING into left/right[0..frames); advances the transport. */
  process(left: Float32Array, right: Float32Array, frames: number): void {
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
      this.renderSegment(left, right, pos, end - pos);
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

  /**
   * Zero the mono scratch segment, have every voice add into it, copy it to
   * the stereo scratch pair at unity, run the insert chain in patch order,
   * add the pair into left/right; reap silent voices. The chain runs even
   * over voice-silent segments so effect tails keep ringing.
   */
  private renderSegment(left: Float32Array, right: Float32Array, offset: number, length: number): void {
    this.scratch.fill(0, 0, length);
    for (const entry of this.voices) {
      entry.alive = entry.voice.render(this.scratch, length);
    }
    for (let i = 0; i < length; i++) {
      this.scratchL[i] = this.scratch[i];
      this.scratchR[i] = this.scratch[i];
    }
    for (const insert of this.inserts) {
      insert.process(this.scratchL, this.scratchR, length);
    }
    for (let i = 0; i < length; i++) {
      left[offset + i] += this.scratchL[i];
      right[offset + i] += this.scratchR[i];
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
 * return the full stereo buffer pair.
 */
export function renderPatch(
  patch: Patch,
  events: readonly EngineEvent[],
  totalFrames: number,
  sampleRate: number,
  zoneSetProvider?: ZoneSetProvider,
): { left: Float32Array; right: Float32Array } {
  const engine = new PatchEngine(sampleRate, { zoneSetProvider });
  engine.setPatch(patch);
  for (const event of events) {
    engine.schedule(event);
  }
  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);
  for (let offset = 0; offset < totalFrames; offset += RENDER_BLOCK_FRAMES) {
    const n = Math.min(RENDER_BLOCK_FRAMES, totalFrames - offset);
    engine.process(left.subarray(offset, offset + n), right.subarray(offset, offset + n), n);
  }
  return { left, right };
}
