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

class AlloyPatchProcessor extends AudioWorkletProcessor {
  private readonly core: WorkletHostCore;

  constructor(options?: { processorOptions?: { maxVoices?: number } }) {
    super(options);
    this.core = new WorkletHostCore(sampleRate, currentFrame, options?.processorOptions);
    this.port.onmessage = (event: MessageEvent<WorkletInMessage>) => this.core.onMessage(event.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = outputs[0];
    const mono = channels[0];
    this.core.render(mono, mono.length, (reply) => this.port.postMessage(reply));
    for (let c = 1; c < channels.length; c++) {
      channels[c].set(mono);
    }
    return true;
  }
}

registerProcessor(WORKLET_PROCESSOR_NAME, AlloyPatchProcessor);
