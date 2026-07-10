const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** POST x-www-form-urlencoded params to Google's token endpoint.
 *  Google rejections (invalid_grant etc.) surface as { status: 401 }. */
export async function exchange(params) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...params,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
    }).toString(),
  });
  const json = await res.json();
  if (!res.ok || json.error) return { status: 401, body: { error: json.error ?? 'exchange failed' } };
  return { status: 200, body: json };
}
