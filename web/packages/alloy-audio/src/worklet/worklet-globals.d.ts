// AudioWorkletGlobalScope globals — not in TS dom lib. This file is ambient
// (no imports/exports) so tsc merges these declarations into the global
// scope for every file in the package; only alloy-patch-processor.ts (the
// worklet module) actually runs in a context where they exist at runtime.
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, ctor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;
declare const currentFrame: number;
