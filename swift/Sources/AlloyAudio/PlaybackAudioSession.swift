#if os(iOS)
    import AVFoundation

    /// Native equivalent of independent Web Audio playback. All live synth
    /// adapters share this policy so loading or recovering one cannot silence
    /// another app's backing track. Offline rendering owns no device session.
    enum PlaybackAudioSession {
        static func activate(for engine: AVAudioEngine) throws {
            guard !engine.isInManualRenderingMode else { return }
            let session = AVAudioSession.sharedInstance()
            if session.category != .playback || session.mode != .default ||
                session.categoryOptions != [.mixWithOthers]
            {
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            }
            try session.setActive(true)
        }
    }
#endif
