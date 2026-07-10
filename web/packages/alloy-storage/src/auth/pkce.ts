function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const defaultRandom = (len: number): Uint8Array => crypto.getRandomValues(new Uint8Array(len));

/** 48 random bytes → 64 base64url chars (RFC 7636 §4.1 allows 43–128). */
export function generateCodeVerifier(random: (len: number) => Uint8Array = defaultRandom): string {
  return base64url(random(48));
}

/** S256 challenge: base64url(SHA-256(verifier)). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
