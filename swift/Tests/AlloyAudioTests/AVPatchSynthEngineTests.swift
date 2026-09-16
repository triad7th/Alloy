@testable import AlloyAudio
import AVFoundation
import XCTest

private struct AdapterPackSource: PackSource {
    let fail: Bool
    func fetchManifest() async throws -> PackManifest {
        if fail { throw NSError(domain: "test-load", code: 1) }
        return try JSONDecoder().decode(PackManifest.self, from: Data("""
        {"schemaVersion":1,"id":"test","tier":"tiny","sampleRate":48000,"format":"m4a",
         "zoneSets":{"piano":{"layers":[{"topVelocity":1,"zones":[{"rootMidi":69,"file":"a.m4a","gain":1,"tuneCents":0}]}]}},"credits":[]}
        """.utf8))
    }

    func fetchZone(_: String) async throws -> Data {
        Data()
    }
}

private final class AdapterDecoder: SampleDecoder, @unchecked Sendable {
    private let lock = NSLock()
    private var mainThread = false
    var decodedOnMain: Bool {
        lock.withLock { mainThread }
    }

    func decode(_: Data) async throws -> DecodedPcm {
        lock.withLock { mainThread = Thread.isMainThread }
        let step = 2.0 * Double.pi * 440.0 / 48000.0
        let data: [Float] = (0 ..< 48000).map { Float(sin(step * Double($0))) * 0.5 }
        return DecodedPcm(sampleRate: 48000, data: data)
    }
}

final class AVPatchSynthEngineTests: XCTestCase {
    @MainActor
    func testOfflineFormatProducesStereoAndPanicSilenceAndDisposes() async throws {
        let av = AVAudioEngine()
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2))
        try av.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
        let decoder = AdapterDecoder()
        let loader = PackLoader(source: AdapterPackSource(fail: false), decoder: decoder)
        let patch = try JSONDecoder().decode(Patch.self, from: Data("""
        {"schemaVersion":1,"meta":{"id":"sample","name":"Sample","category":"melodic"},
         "layers":[{"keyRange":{"lowMidi":0,"highMidi":127},"velRange":{"low":0,"high":1},
         "generator":{"kind":"sample","zoneSetId":"piano","crossfade":0},
         "tva":{"level":1,"adsr":{"attack":0,"decay":0,"sustain":1,"release":0.1},"velCurve":1}}],"sends":{"reverb":0,"delay":0}}
        """.utf8))
        let synth = try await AVPatchSynthEngine.create(patch: patch, loader: loader, zoneSetIds: ["piano"], defaultVelocity: 0.7, engine: av)
        XCTAssertFalse(decoder.decodedOnMain)
        XCTAssertTrue(av.isRunning)
        let source = try XCTUnwrap(av.attachedNodes.first { $0 is AVAudioSourceNode })
        XCTAssertEqual(source.outputFormat(forBus: 0).sampleRate, 48000)
        XCTAssertEqual(source.outputFormat(forBus: 0).channelCount, 2)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096))
        let engine: any SynthEngine = synth
        engine.noteOn(midi: 69)
        XCTAssertEqual(try av.renderOffline(4096, to: buffer), .success)
        let left = try Array(UnsafeBufferPointer(start: XCTUnwrap(buffer.floatChannelData?[0]), count: 4096))
        let right = try Array(UnsafeBufferPointer(start: XCTUnwrap(buffer.floatChannelData?[1]), count: 4096))
        XCTAssertEqual(left, right)
        XCTAssertGreaterThan(try XCTUnwrap(left.map { abs($0) }.max()), 0.1)
        engine.allNotesOff()
        for _ in 0 ..< 3 {
            XCTAssertEqual(try av.renderOffline(4096, to: buffer), .success)
        }
        XCTAssertLessThan((0 ..< 4096).map { abs(buffer.floatChannelData![0][$0]) }.max()!, 0.00001)
        synth.dispose()
        synth.dispose()
        XCTAssertFalse(av.attachedNodes.contains(source))
        XCTAssertFalse(av.isRunning)
    }

    @MainActor
    func testConfigurationChangeWaitsForNextNoteToRestart() async throws {
        let av = AVAudioEngine()
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2))
        try av.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
        let patch = try JSONDecoder().decode(Patch.self, from: Data(fixturePatchJSON.utf8))
        let loader = PackLoader(source: AdapterPackSource(fail: false), decoder: AdapterDecoder())
        let synth = try await AVPatchSynthEngine.create(
            patch: patch, loader: loader, zoneSetIds: ["piano"], engine: av
        )
        defer { synth.dispose() }
        synth.noteOn(midi: 60)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096))
        XCTAssertEqual(try av.renderOffline(4096, to: buffer), .success)
        av.stop()

        NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: av)

        XCTAssertFalse(av.isRunning, "configuration recovery must wait for a playable gesture")
        synth.noteOn(midi: 61)
        XCTAssertTrue(av.isRunning, "the next note gesture restarts the engine")
        XCTAssertEqual(try av.renderOffline(4096, to: buffer), .success)
    }

    @MainActor
    func testFailedLoadLeavesNoSourceGraph() async throws {
        let av = AVAudioEngine()
        let before = av.attachedNodes
        let patch = try JSONDecoder().decode(Patch.self, from: Data(fixturePatchJSON.utf8))
        do {
            _ = try await AVPatchSynthEngine.create(patch: patch, loader: PackLoader(source: AdapterPackSource(fail: true), decoder: AdapterDecoder()), zoneSetIds: ["piano"], engine: av)
            XCTFail("expected load failure")
        } catch {
            XCTAssertEqual((error as NSError).domain, "test-load")
        }
        XCTAssertEqual(av.attachedNodes, before)
    }
}
