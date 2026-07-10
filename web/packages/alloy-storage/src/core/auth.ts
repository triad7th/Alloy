export type AuthState = 'signedOut' | 'signedIn' | 'expired';

/** Auth seam for cloud backends. Implementations own token acquisition;
 *  backends only ever ask for a bearer token. */
export interface AuthProvider {
  /** A currently-valid access token, or null (signed out / refresh failed). */
  accessToken(): Promise<string | null>;
  readonly state: AuthState;
}
