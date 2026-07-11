import Foundation

/// The receiving side of the Shareable capability: fetch a publicly-shared
/// Drive file WITHOUT sign-in (viewer pages have no signed-in user). The
/// API key is the app's public, referrer-restricted key; Alloy stores no
/// keys. 404 → notFound (sharing revoked or bad ref); 403 → auth (key
/// invalid/restricted). Caseless-enum namespace, twin of drive-public.ts.
public enum DrivePublic {
  public static func fetchSharedFile(
    nativeRef: String,
    apiKey: String,
    transport: any HTTPTransport = URLSessionTransport()
  ) async throws -> String {
    // nativeRef arrives from viewer-page URLs (untrusted input); percent-encode
    // it like the API key so a crafted ref can't redirect the GET.
    let encodedRef =
      nativeRef.addingPercentEncoding(withAllowedCharacters: PercentEncoding.encodeURIComponentAllowed)
      ?? nativeRef
    let encodedKey =
      apiKey.addingPercentEncoding(withAllowedCharacters: PercentEncoding.encodeURIComponentAllowed)
      ?? apiKey
    let url = URL(string:
      "https://www.googleapis.com/drive/v3/files/\(encodedRef)?alt=media&key=\(encodedKey)")!
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await transport.send(URLRequest(url: url))
    } catch let e as StorageError {
      throw e
    } catch {
      throw StorageError(category: .unreachable, message: String(describing: error))
    }
    guard (200..<300).contains(response.statusCode) else {
      throw StorageError.fromHTTPStatus(response.statusCode)
    }
    return String(decoding: data, as: UTF8.self)
  }
}
