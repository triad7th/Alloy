const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** POST x-www-form-urlencoded params to Google's token endpoint.
 *  Google rejections (invalid_grant etc., 4xx or an error body) surface as
 *  { status: 401 }; Google 5xx, non-JSON bodies, and network failures as
 *  { status: 502 } so clients can retry instead of dropping tokens. */
export async function exchange(params) {
  let res;
  let json;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...params,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
      }).toString(),
    });
    json = await res.json();
  } catch {
    return { status: 502, body: { error: 'google unreachable' } };
  }
  if (res.status >= 500) return { status: 502, body: { error: 'google unavailable' } };
  if (!res.ok || json.error) return { status: 401, body: { error: json.error ?? 'exchange failed' } };
  return { status: 200, body: json };
}
