/** Linear gain that brings the sample's peak to `target` (default 0.9). */
export function peakGain(samples, target = 0.9) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return peak > 0 ? target / peak : 1;
}

/** Group sources into ascending velocity layers and build a ZoneSetSpec-shaped
 *  object. `config.topVelocities` maps layerIndex -> inclusive top velocity
 *  bound (ascending). `config.loops` maps source name -> { loopStart, loopEnd }
 *  (omit a name for a one-shot). `config.target` is the peak-normalize target. */
export function assembleLayers(sources, config) {
  const { topVelocities, loops = {}, target = 0.9 } = config;
  const byLayer = new Map();
  for (const s of sources) {
    if (!byLayer.has(s.layerIndex)) byLayer.set(s.layerIndex, []);
    byLayer.get(s.layerIndex).push(s);
  }
  const layerIndices = [...byLayer.keys()].sort((a, b) => a - b);
  const layers = layerIndices.map((li) => {
    const zones = byLayer
      .get(li)
      .sort((a, b) => a.rootMidi - b.rootMidi)
      .map((s) => {
        const loop = loops[s.name];
        return {
          rootMidi: s.rootMidi,
          file: s.name.replace(/\.wav$/, '.m4a'),
          gain: peakGain(s.samples, target),
          tuneCents: 0,
          ...(loop ? { loopStart: loop.loopStart, loopEnd: loop.loopEnd } : {}),
        };
      });
    return { topVelocity: topVelocities[li], zones };
  });
  return { layers };
}
