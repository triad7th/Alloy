import AlloyStorage
import SwiftUI

/// Fill these in to light up the Drive half of the demo: create an iOS-type
/// OAuth client in the Google Cloud console (no secret, no backend). The
/// redirect scheme is the reversed client id Google shows you, e.g.
/// "com.googleusercontent.apps.1234567890-abc". Empty strings = the Drive
/// card shows these setup steps instead.
private let googleClientID =
    "929183445053-vpi4bqqbhakoaan3tassdi5m0ng9aood.apps.googleusercontent.com"
private let googleRedirectScheme = "com.googleusercontent.apps.929183445053-vpi4bqqbhakoaan3tassdi5m0ng9aood"
private let driveScope = "https://www.googleapis.com/auth/drive.file"
private let driveFolder = "AlloyHarness"

/// Shared instances — GoogleAuth/DriveBackend hold token + folder caches, so
/// they must outlive SwiftUI view-struct re-creation.
private enum StorageDemo {
    static let local = LocalStorageBackend(collection: "harness")
    static let auth: GoogleAuth? = {
        guard !googleClientID.isEmpty, !googleRedirectScheme.isEmpty else { return nil }
        return GoogleAuth(config: GoogleAuthConfig(
            clientId: googleClientID,
            scope: driveScope,
            redirectScheme: googleRedirectScheme
        ))
    }()
    static let drive: DriveBackend? = auth.map {
        DriveBackend(client: DriveClient(auth: $0), folderPath: driveFolder)
    }
}

/// AlloyStorage demo: LocalStorageBackend (Application Support JSON files —
/// records survive relaunches) and DriveBackend behind the real
/// ASWebAuthenticationSession OAuth flow.
struct StorageDemoView: View {
    @State private var recID = "settings"
    @State private var recName = "settings.json"
    @State private var payload = #"{"theme":"dark","volume":0.8}"#
    @State private var localStatus = ""
    @State private var localMetas: [StorageRecordMeta] = []
    @State private var authState = AuthState.signedOut
    @State private var driveStatus = ""
    @State private var driveMetas: [StorageRecordMeta] = []
    @State private var shareInfo: ShareStatus?
    @State private var linkCopied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            localCard
            driveCard
        }
        .task {
            await refreshLocal()
            if let auth = StorageDemo.auth {
                _ = await auth.accessToken() // silent resume from Keychain
                authState = auth.state
            }
        }
    }

    // MARK: local

    private var localCard: some View {
        card("Local (Application Support)") {
            fieldRow("id", text: $recID)
            fieldRow("name", text: $recName)
            fieldRow("payload", text: $payload)
            HStack(spacing: 8) {
                demoButton("Save") { await saveLocal() }
                demoButton("Load") { await loadLocal() }
                demoButton("Delete") { await deleteLocal() }
                demoButton("List") { await refreshLocal() }
            }
            statusText(localStatus)
            metaList(localMetas)
        }
    }

    private func saveLocal() async {
        do {
            _ = try await StorageDemo.local.write(record())
            localStatus = "saved '\(recID)' — quit and relaunch: it persists"
            await refreshLocal()
        } catch { localStatus = describe(error) }
    }

    private func loadLocal() async {
        do {
            guard let rec = try await StorageDemo.local.read(id: recID) else {
                localStatus = "no record '\(recID)'"
                return
            }
            recName = rec.name
            payload = rec.payload
            localStatus = "loaded '\(rec.id)'"
        } catch { localStatus = describe(error) }
    }

    private func deleteLocal() async {
        do {
            try await StorageDemo.local.delete(id: recID)
            localStatus = "deleted '\(recID)'"
            await refreshLocal()
        } catch { localStatus = describe(error) }
    }

    private func refreshLocal() async {
        do { localMetas = try await StorageDemo.local.list() } catch { localStatus = describe(error) }
    }

    // MARK: drive

    @ViewBuilder
    private var driveCard: some View {
        card("Google Drive") {
            if StorageDemo.auth == nil {
                Text(
                    "Not configured. Set googleClientID and googleRedirectScheme in "
                        + "StorageDemoView.swift (iOS-type OAuth client, no secret needed)."
                )
                .font(.footnote).foregroundStyle(.secondary)
            } else {
                Text("auth: \(authState.rawValue)").font(.footnote).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    if authState != .signedIn {
                        demoButton("Sign in with Google") { await signIn() }
                    } else {
                        demoButton("Save to Drive") { await saveDrive() }
                        demoButton("List Drive folder") { await refreshDrive() }
                        demoButton("Sign out") { signOut() }
                    }
                }
                if authState == .signedIn {
                    HStack(spacing: 8) {
                        demoButton("Share status") { await shareRefresh() }
                        demoButton(shareInfo?.shared == true ? "Unshare" : "Share") { await shareToggle() }
                    }
                    if let info = shareInfo {
                        if info.shared {
                            Text("shared — anyone with the link can view")
                                .font(.footnote).foregroundStyle(.secondary)
                            HStack(spacing: 8) {
                                Text(driveLink(info.nativeRef))
                                    .font(.footnote.monospaced())
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .textSelection(.enabled)
                                demoButton(linkCopied ? "Copied ✓" : "Copy link") {
                                    copyLink(info.nativeRef)
                                }
                            }
                        } else {
                            Text("not shared").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                statusText(driveStatus)
                metaList(driveMetas)
            }
        }
    }

    private func signIn() async {
        guard let auth = StorageDemo.auth else { return }
        let ok = await auth.signIn()
        authState = auth.state
        driveStatus = ok ? "signed in" : "sign-in failed / cancelled"
    }

    private func signOut() {
        StorageDemo.auth?.signOut()
        authState = StorageDemo.auth?.state ?? .signedOut
        driveMetas = []
        driveStatus = "signed out"
    }

    private func saveDrive() async {
        guard let drive = StorageDemo.drive else { return }
        do {
            _ = try await drive.write(record())
            driveStatus = "saved '\(recID)' to Drive:/\(driveFolder)"
            await refreshDrive()
        } catch {
            driveStatus = describe(error)
            authState = StorageDemo.auth?.state ?? .signedOut
        }
    }

    private func refreshDrive() async {
        guard let drive = StorageDemo.drive else { return }
        do {
            driveMetas = try await drive.list()
            driveStatus = "listed Drive:/\(driveFolder)"
        } catch {
            driveStatus = describe(error)
            authState = StorageDemo.auth?.state ?? .signedOut
        }
    }

    private func shareRefresh() async {
        guard let drive: any StorageBackend = StorageDemo.drive else { return }
        guard let shareable = drive as? any Shareable else { return }
        do {
            shareInfo = try await shareable.shareStatus(id: recID)
            driveStatus = shareInfo == nil ? "record not on Drive yet" : "share status refreshed"
        } catch {
            driveStatus = describe(error)
            authState = StorageDemo.auth?.state ?? .signedOut
        }
    }

    /// Drive's universal viewer link — works for any anyone-with-link file.
    /// Apps build their own link format (that's app policy); the harness uses
    /// Drive's so manual QA can verify sharing end-to-end in a browser.
    private func driveLink(_ nativeRef: String) -> String {
        "https://drive.google.com/file/d/\(nativeRef)/view"
    }

    private func copyLink(_ nativeRef: String) {
        let link = driveLink(nativeRef)
        #if canImport(UIKit)
            UIPasteboard.general.string = link
        #elseif canImport(AppKit)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(link, forType: .string)
        #endif
        linkCopied = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            linkCopied = false
        }
    }

    private func shareToggle() async {
        guard let drive: any StorageBackend = StorageDemo.drive else { return }
        guard let shareable = drive as? any Shareable else { return }
        do {
            if shareInfo?.shared == true {
                try await shareable.unshare(id: recID)
            } else {
                _ = try await shareable.share(id: recID)
            }
            await shareRefresh()
        } catch {
            driveStatus = describe(error)
            authState = StorageDemo.auth?.state ?? .signedOut
        }
    }

    // MARK: shared bits

    private func record() -> StorageRecord {
        StorageRecord(id: recID, name: recName, updatedAt: Date(), payload: payload)
    }

    private func describe(_ error: Error) -> String {
        if let e = error as? StorageError { return "StorageError(\(e.category.rawValue)): \(e.message)" }
        return error.localizedDescription
    }

    private func card(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.subheadline).bold().foregroundStyle(.white)
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
    }

    private func fieldRow(_ label: String, text: Binding<String>) -> some View {
        HStack(spacing: 8) {
            Text(label).font(.footnote).foregroundStyle(.secondary).frame(width: 60, alignment: .leading)
            TextField(label, text: text)
                .textFieldStyle(.plain)
                .font(.footnote.monospaced())
                .padding(6)
                .background(Color.black.opacity(0.3), in: RoundedRectangle(cornerRadius: 6))
        }
    }

    private func demoButton(_ label: String, action: @escaping () async -> Void) -> some View {
        Button(label) { Task { await action() } }
            .buttonStyle(.bordered)
            .font(.footnote)
    }

    private func statusText(_ text: String) -> some View {
        Text(text.isEmpty ? " " : text).font(.footnote).foregroundStyle(.secondary)
    }

    @ViewBuilder
    private func metaList(_ metas: [StorageRecordMeta]) -> some View {
        if !metas.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(metas, id: \.id) { m in
                    HStack(spacing: 8) {
                        Text(m.id).font(.footnote.monospaced())
                        Text(m.name).font(.footnote).foregroundStyle(.secondary)
                        Spacer()
                        Text(m.updatedAt, style: .time).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
