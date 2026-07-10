import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'secret';
process.env.ALLOWED_ORIGINS = 'https://score.example,https://clock.example';

const { default: token } = await import('../functions/token.mjs');
const { default: refresh } = await import('../functions/refresh.mjs');
const { handle } = await import('../functions/lib/cors.mjs');

function req(path, { method = 'POST', origin = 'https://score.example', body } = {}) {
  return new Request(`https://oauth.example${path}`, {
    method,
    headers: { origin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function mockGoogle(response, status = 200) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(response), { status });
  };
  return calls;
}

test('token: exchanges a code, forwarding secret and PKCE verifier', async () => {
  const calls = mockGoogle({ access_token: 'at', refresh_token: 'rt', expires_in: 3599 });
  const res = await token(req('/token', { body: { code: 'c1', codeVerifier: 'v1', redirectUri: 'https://score.example/cb' } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { accessToken: 'at', refreshToken: 'rt', expiresIn: 3599 });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://score.example');
  const sent = new URLSearchParams(calls[0].init.body);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(sent.get('grant_type'), 'authorization_code');
  assert.equal(sent.get('code'), 'c1');
  assert.equal(sent.get('code_verifier'), 'v1');
  assert.equal(sent.get('client_secret'), 'secret');
});

test('refresh: exchanges a refresh token', async () => {
  mockGoogle({ access_token: 'at2', expires_in: 3599 });
  const res = await refresh(req('/refresh', { body: { refreshToken: 'rt' } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { accessToken: 'at2', expiresIn: 3599 });
});

test('rejects a disallowed origin with 403', async () => {
  mockGoogle({});
  const res = await token(req('/token', { origin: 'https://evil.example', body: { code: 'c' } }));
  assert.equal(res.status, 403);
});

test('maps a Google rejection to 401', async () => {
  mockGoogle({ error: 'invalid_grant' }, 400);
  const res = await refresh(req('/refresh', { body: { refreshToken: 'stale' } }));
  assert.equal(res.status, 401);
});

test('handles OPTIONS preflight with 204 + CORS headers', async () => {
  const res = await token(req('/token', { method: 'OPTIONS' }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://score.example');
  assert.equal(res.headers.get('access-control-allow-headers'), 'content-type');
  assert.equal(res.headers.get('vary'), 'Origin');
});

test('an onBody throw maps to 500 with no leaked error details, keeping CORS headers', async () => {
  const res = await handle(req('/whatever', { body: { anything: true } }), async () => {
    throw new Error('boom: some internal detail');
  });
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://score.example');
  const body = await res.json();
  assert.deepEqual(body, { error: 'internal error' });
});

test('rejects a missing/invalid body with 400', async () => {
  mockGoogle({});
  const res = await token(req('/token', { body: {} }));
  assert.equal(res.status, 400);
});

test('maps a Google 5xx to 502, keeping CORS headers', async () => {
  mockGoogle({}, 503);
  const res = await refresh(req('/refresh', { body: { refreshToken: 'rt' } }));
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://score.example');
});

test('maps a thrown fetch to 502, keeping CORS headers', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  const res = await refresh(req('/refresh', { body: { refreshToken: 'rt' } }));
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://score.example');
});

test('rejects a missing origin when ALLOWED_ORIGINS is unset with 403', async () => {
  const saved = process.env.ALLOWED_ORIGINS;
  delete process.env.ALLOWED_ORIGINS;
  try {
    mockGoogle({});
    const res = await token(
      new Request('https://oauth.example/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' }),
      }),
    );
    assert.equal(res.status, 403);
  } finally {
    process.env.ALLOWED_ORIGINS = saved;
  }
});
