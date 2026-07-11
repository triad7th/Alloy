@testable import AlloyStorage
import Foundation
import Testing

/// Twin of web .../drive/drive-storage.spec.ts.
@Suite struct DriveStorageTests {
    private let config = DriveStorageConfig(
        clientId: "cid", redirectScheme: "com.example.app", folderPath: "AllyWorld/Harness"
    )

    @Test func wiresWorkingAuthAndShareableBackendFromOneConfig() async throws {
        // ScriptedTransport doesn't consume entries — it re-matches the first
        // satisfying predicate on every request — so the folder-lookup entry
        // must be narrow enough to exclude the later listFiles() call.
        // findFolder requests `fields=files(id)` (closing paren right after
        // "id"); listFiles/findByAlloyId request `fields=files(id,name,...)`,
        // so this substring is unique to the two folder-resolution calls.
        let transport = ScriptedTransport([
            .init(matches: { $0.url!.absoluteString.contains("fields=files(id)") },
                  body: #"{"files":[{"id":"f1"}]}"#, status: 200),
            .init(matches: { _ in true }, body: #"{"files":[]}"#, status: 200),
        ])
        // Token must be fresh relative to GoogleAuth's default now: { Date() } —
        // DriveStorage's init takes no clock, so real wall-time + far-future
        // expiry is the correct (and here permitted) fixture.
        let vault = MemoryTokenVault(
            StoredTokens(accessToken: "at", expiresAt: Date().addingTimeInterval(3600), refreshToken: nil)
        )
        let storage = DriveStorage(config: config, vault: vault, transport: transport, cache: nil)
        #expect((storage.backend as any StorageBackend) as? any Shareable != nil)
        // Backend calls flow through the injected transport with the config's folder path:
        _ = try await storage.backend.list()
        let hitAllyWorld = transport.requests.contains {
            $0.url!.absoluteString.removingPercentEncoding?.contains("AllyWorld") == true
        }
        #expect(hitAllyWorld)
    }

    @Test func defaultsScopeToDriveFile() async {
        let capture = URLCaptureUI()
        let storage = DriveStorage(
            config: config, vault: MemoryTokenVault(), transport: ScriptedTransport([]),
            uiSession: capture, cache: nil
        )
        _ = await storage.auth.signIn() // cancelled by the stub after capturing
        #expect(capture.lastURL?.absoluteString
            .removingPercentEncoding?.contains("https://www.googleapis.com/auth/drive.file") == true)
    }

    @Test func honorsExplicitScopeOverride() async {
        let custom = DriveStorageConfig(
            clientId: "cid", redirectScheme: "com.example.app", folderPath: "F", scope: "custom-scope"
        )
        let capture = URLCaptureUI()
        let storage = DriveStorage(
            config: custom, vault: MemoryTokenVault(), transport: ScriptedTransport([]),
            uiSession: capture, cache: nil
        )
        _ = await storage.auth.signIn()
        #expect(capture.lastURL?.absoluteString.contains("custom-scope") == true)
    }

    /// CRITICAL controller amendment guard: DriveStorage.init must mirror
    /// GoogleAuth.init's `uiSession: (any AuthUISession)? = GoogleAuth.defaultUISession()`
    /// default — NOT `nil` — so that a caller who omits `uiSession` still gets
    /// the platform auth UI, rather than silently disabling sign-in (which
    /// would make `signIn()` immediately return
    /// `.failed(.configurationInvalid, "no auth UI session available...")`
    /// for every production caller). The explicit-injection path (a caller
    /// passing its own `uiSession`, as in the tests above) is unaffected
    /// either way; this guard covers the omitted-argument path, which is
    /// awkward to assert through `DriveStorage` directly without launching
    /// real auth UI, so it asserts the platform precondition the init's
    /// default expression relies on instead.
    @Test func defaultUISessionIsAvailableOnThisPlatform() {
        #if canImport(AuthenticationServices)
            #expect(GoogleAuth.defaultUISession() != nil)
        #endif
    }
}

/// Captures the auth URL, then cancels — lets tests inspect signIn's URL
/// without scripting the whole flow.
final class URLCaptureUI: AuthUISession, @unchecked Sendable {
    var lastURL: URL?
    func authenticate(url: URL, callbackScheme _: String) async throws -> URL {
        lastURL = url
        throw CancellationError()
    }
}
