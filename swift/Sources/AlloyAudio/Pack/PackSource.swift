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
        try await fetchFn("\(base)/\(Self.encodeZonePath(file))")
    }

    /// Percent-encode each path segment of a manifest `file` entry.
    ///
    /// Zone filenames are content, not URLs, and real packs carry characters a
    /// URL parses as syntax — the piano pack's sharps are literally
    /// `D#4v12.m4a`, and an unencoded `#` is a FRAGMENT delimiter: the request
    /// silently becomes `<base>/D`, a static host answers with its index page,
    /// and the decoder then fails on markup. Encoding per segment (not the whole
    /// string) keeps `/` working for packs that nest zones in subdirectories.
    /// Twin: pack-source.ts (canonical).
    static func encodeZonePath(_ file: String) -> String {
        file.split(separator: "/", omittingEmptySubsequences: false)
            .map { segment in
                // .urlPathAllowed leaves `#` and `?` intact, which is exactly the
                // bug; subtract them so a segment can never introduce URL syntax.
                var allowed = CharacterSet.urlPathAllowed
                allowed.remove(charactersIn: "#?")
                return String(segment).addingPercentEncoding(withAllowedCharacters: allowed) ?? String(segment)
            }
            .joined(separator: "/")
    }
}

public enum PackSourceError: Error, Equatable {
    case invalidManifest([String])
}
