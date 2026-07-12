// AudioWorklet shell around WorkletHostCore. Registered under
// WORKLET_PROCESSOR_NAME; apps load this module via
// ctx.audioWorklet.addModule(<url to dist/worklet/alloy-patch-processor.js>).
// Keep this file logic-free: everything testable lives in WorkletHostCore.
//
// Worklet modules are ES modules loaded by addModule() and executed in the
// AudioWorkletGlobalScope; the relative import below resolves against this
// module's own URL, not the page's, so it must stay a plain relative
// specifier (`../worklet-host-core.js`) — no bundling/rewriting at publish
// time, or the worklet will fail to load. The import graph continues into
// ../dsp/*.js, so apps must serve the package's ENTIRE dist/ tree with its
// layout preserved (see WorkletSynthHost.create's doc comment), not just
// this worklet/ directory.
import { WorkletHostCore, WORKLET_PROCESSOR_NAME, type WorkletInMessage } from '../worklet-host-core.js';

/**
 * The AudioWorklet render quantum is 128 frames today, but a future
 * renderSizeHint could raise it; size the single-channel fallback scratches
 * at the engine's 4096-frame block cap (WorkletHostCore.render's documented
 * limit) so a larger quantum can never read past the end of these buffers
 * and pull in NaN/garbage instead of silence.
 */
const MONO_SCRATCH_FRAMES = 4096;

class AlloyPatchProcessor extends AudioWorkletProcessor {
  private readonly core: WorkletHostCore;
  /** Preallocated fallback pair for single-channel outputs (no render-path allocation). */
  private readonly downmixL = new Float32Array(MONO_SCRATCH_FRAMES);
  private readonly downmixR = new Float32Array(MONO_SCRATCH_FRAMES);

  constructor(options?: { processorOptions?: { maxVoices?: number } }) {
    super(options);
    this.core = new WorkletHostCore(sampleRate, currentFrame, options?.processorOptions);
    this.port.onmessage = (event: MessageEvent<WorkletInMessage>) => this.core.onMessage(event.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = outputs[0];
    const postReply = (reply: unknown): void => this.port.postMessage(reply);
    // Channel mapping is the one permitted piece of shell logic (mirrored on
    // the Apple host's source-node shell): stereo outputs get L -> channel 0
    // and R -> channel 1 rendered directly into the (pre-zeroed) worklet
    // buffers; a single-channel output gets the (L+R)*0.5 downmix through
    // the preallocated scratch pair. Channels past the stereo pair stay at
    // the silence the worklet delivered them with.
    if (channels.length >= 2) {
      this.core.render(channels[0], channels[1], channels[0].length, postReply);
    } else {
      const mono = channels[0];
      // Guard against a quantum larger than the scratch pair (or the
      // engine's block cap): never render/read past either bound.
      const frames = Math.min(mono.length, MONO_SCRATCH_FRAMES);
      this.downmixL.fill(0);
      this.downmixR.fill(0);
      this.core.render(this.downmixL, this.downmixR, frames, postReply);
      for (let i = 0; i < frames; i++) {
        mono[i] = (this.downmixL[i] + this.downmixR[i]) * 0.5;
      }
    }
    return true;
  }
}

registerProcessor(WORKLET_PROCESSOR_NAME, AlloyPatchProcessor);
