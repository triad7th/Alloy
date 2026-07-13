import Foundation

/// Byte-origin seam for pack loading: manifest + per-zone encoded bytes.
/// Network stays at the host edge (injected), so PackLoader's logic stays
/// testable offline. Twin of web src/pack/pack-source.ts (canonical).
public protocol PackSource {
    func fetchManifest() async throws -> PackManifest
    func fetchZone(_ file: String) async throws -> Data
}

/// Minimal fetch surface (inject `URLSession` or a test double).
public typealias FetchFn = (String) async throws -> Data

/// Pack fetched from a base URL/path: `${base}/manifest.json`, `${base}/<file>`.
public struct BasePathPackSource: PackSource {
    private let base: String
    private let fetchFn: FetchFn

    public init(base: String, fetchFn: @escaping FetchFn) {
        self.base = base
        self.fetchFn = fetchFn
    }

    public func fetchManifest() async throws -> PackManifest {
        let data = try await fetchFn("\(base)/manifest.json")
        let manifest = try JSONDecoder().decode(PackManifest.self, from: data)
        let errors = validateManifest(manifest)
        if !errors.isEmpty {
            throw PackSourceError.invalidManifest(errors)
        }
        return manifest
    }

    public func fetchZone(_ file: String) async throws -> Data {
        try await fetchFn("\(base)/\(file)")
    }
}

public enum PackSourceError: Error, Equatable {
    case invalidManifest([String])
}
