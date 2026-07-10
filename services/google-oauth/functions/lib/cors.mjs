/** Origin allowlist from ALLOWED_ORIGINS (comma-separated). Returns CORS
 *  headers for an allowed origin, or null for a disallowed one. */
export function corsHeaders(request) {
  const origin = request.headers.get('origin') ?? '';
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim());
  if (!allowed.includes(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

/** Shared preflight/deny/parse plumbing; onBody does the real work. */
export async function handle(request, onBody) {
  const cors = corsHeaders(request);
  if (!cors) return new Response('forbidden origin', { status: 403 });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: cors });
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('invalid JSON', { status: 400, headers: cors });
  }
  const result = await onBody(body);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
