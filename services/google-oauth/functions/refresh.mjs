import { handle } from './lib/cors.mjs';
import { exchange } from './lib/google.mjs';

export default async (request) =>
  handle(request, async (body) => {
    const { refreshToken } = body ?? {};
    if (!refreshToken) return { status: 400, body: { error: 'refreshToken required' } };
    const result = await exchange({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (result.status !== 200) return result;
    const { access_token, expires_in } = result.body;
    return { status: 200, body: { accessToken: access_token, expiresIn: expires_in } };
  });

export const config = { path: '/refresh' };
