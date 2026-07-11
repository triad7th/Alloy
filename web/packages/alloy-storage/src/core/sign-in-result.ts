/** Why a sign-in failed — the phase, not user-facing copy. */
export type SignInFailureReason =
  | 'configurationInvalid' // bad auth URL / missing or corrupt pending-session entry / no auth UI
  | 'stateMismatch' // CSRF state check failed, or no code in the callback
  | 'exchangeFailed' // token endpoint rejected or unreachable
  | 'vaultFailed'; // token persistence failed (IndexedDB / Keychain)

/** Result of completeSignIn (web) / signIn (Apple). `cancelled` is a normal
 *  outcome, not an error; `detail` is for developers (logs, status lines),
 *  never end-user copy. */
export type SignInResult =
  | { outcome: 'success' }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; reason: SignInFailureReason; detail: string; status?: number };
