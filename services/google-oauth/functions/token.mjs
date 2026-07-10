import { handle } from './lib/cors.mjs';
import { exchange } from './lib/google.mjs';

export default async (request) =>
  handle(request, async (body) => {
    const { code, codeVerifier, redirectUri } = body ?? {};
    if (!code || !codeVerifier || !redirectUri) {
      return { status: 400, body: { error: 'code, codeVerifier, redirectUri required' } };
    }
    const result = await exchange({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });
    if (result.status !== 200) return result;
    const { access_token, refresh_token, expires_in } = result.body;
    return {
      status: 200,
      body: { accessToken: access_token, refreshToken: refresh_token, expiresIn: expires_in },
    };
  });

export const config = { path: '/token' };
