// Shared fixture data for DSP twin tests (patch.spec.ts, voice.spec.ts).
// Not exported from the package barrel — test-only.

/** Two-layer patch (va + fm) exercising every field of the Task 2 schema. */
export const FIXTURE_PATCH_JSON = `{
  "schemaVersion": 1,
  "meta": { "id": "test.duo", "name": "Test Duo", "category": "melodic" },
  "layers": [
    {
      "keyRange": { "lowMidi": 0, "highMidi": 127 },
      "velRange": { "low": 0, "high": 1 },
      "generator": { "kind": "va", "va": { "shape": "saw", "unison": 3, "detuneCents": 18, "pulseWidth": 0.5 }, "seed": 7 },
      "tvf": { "mode": "lowpass", "cutoffHz": 900, "q": 0.9, "envAmountHz": 2200, "env": { "attack": 0.004, "decay": 0.18, "sustain": 0.25, "release": 0.2 }, "keyTrack": 0.5, "velAmountHz": 1200 },
      "tva": { "level": 0.8, "adsr": { "attack": 0.005, "decay": 0.3, "sustain": 0.7, "release": 0.25 }, "velCurve": 2 },
      "mod": { "lfo": { "shape": "sine", "rateHz": 5.5, "delay": 0.3, "fadeIn": 0.4 }, "toPitchCents": 8, "toCutoffHz": 0, "toAmpDepth": 0 }
    },
    {
      "keyRange": { "lowMidi": 48, "highMidi": 96 },
      "velRange": { "low": 0.5, "high": 1 },
      "generator": { "kind": "fm", "fm": { "operators": [ { "ratio": 1, "level": 1, "adsr": { "attack": 0.002, "decay": 0.6, "sustain": 0, "release": 0.3 } }, { "ratio": 14, "level": 0.4, "adsr": { "attack": 0.001, "decay": 0.08, "sustain": 0, "release": 0.05 } } ], "algorithm": { "routes": [ { "from": 1, "to": 0 } ], "carriers": [0] } } },
      "tva": { "level": 0.5, "adsr": { "attack": 0.002, "decay": 0.5, "sustain": 0.4, "release": 0.15 }, "velCurve": 1.5 }
    }
  ],
  "sends": { "reverb": 0.2, "delay": 0 }
}`;
