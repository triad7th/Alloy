@testable import AlloyAudio
import XCTest

/// PatchCommandQueue: the locked main → render-thread FIFO under the rompler
/// host. FIFO order, bounded drains with leftovers preserved, and no loss
/// under concurrent producers.
final class PatchCommandQueueTests: XCTestCase {
    private func noteOnMidi(_ command: PatchCommand) -> Int? {
        if case let .noteOn(midi, _, _) = command {
            return midi
        }
        return nil
    }

    func testDrainIsFifoAndBoundedWithLeftoversInOrder() {
        let queue = PatchCommandQueue()
        for midi in 1...5 {
            queue.push(.noteOn(midi: midi, velocity: 1, atFrame: 0))
        }
        XCTAssertEqual(queue.drain(max: 3).map(noteOnMidi), [1, 2, 3])
        XCTAssertEqual(queue.drain(max: 10).map(noteOnMidi), [4, 5])
    }

    func testDrainOnEmptyReturnsEmpty() {
        XCTAssertTrue(PatchCommandQueue().drain(max: 8).isEmpty)
    }

    func testConcurrentPushesLoseNoCommands() {
        let queue = PatchCommandQueue()
        DispatchQueue.concurrentPerform(iterations: 4) { lane in
            for i in 0..<1000 {
                queue.push(.noteOn(midi: lane, velocity: 1, atFrame: i))
            }
        }
        XCTAssertEqual(queue.drain(max: 4000).count, 4000)
        XCTAssertTrue(queue.drain(max: 1).isEmpty)
    }
}
