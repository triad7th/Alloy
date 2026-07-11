import { StorageError } from '../../core/errors.js';

const API = 'https://www.googleapis.com/drive/v3';

/** Fetch a publicly-shared Drive file WITHOUT sign-in — the receiving side
 *  of the Shareable capability (viewer pages have no signed-in user). The
 *  API key is the app's public, referrer-restricted key; Alloy stores no
 *  keys. 404 → notFound (sharing revoked or bad ref); 403 → auth (key
 *  invalid/restricted). */
export async function fetchSharedFile(
  nativeRef: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch.bind(globalThis)
): Promise<string> {
  let res: Response;
  try {
    // nativeRef arrives from viewer-page URLs (untrusted input); percent-encode
    // it like the API key so a crafted ref can't redirect the GET.
    res = await fetchFn(
      `${API}/files/${encodeURIComponent(nativeRef)}?alt=media&key=${encodeURIComponent(apiKey)}`
    );
  } catch (e) {
    throw new StorageError('unreachable', String(e));
  }
  if (!res.ok) throw StorageError.fromHttpStatus(res.status);
  return res.text();
}
