/// Why a sign-in failed — the phase, not user-facing copy.
public enum SignInFailureReason: String, Sendable {
  case configurationInvalid // bad auth URL / no auth UI available on this platform
  case stateMismatch // CSRF state check failed, or no code in the callback
  case exchangeFailed // token endpoint rejected or unreachable
  case vaultFailed // token persistence failed (Keychain)
}

/// Result of signIn (Apple) / completeSignIn (web). `cancelled` is a normal
/// outcome, not an error; `detail` is for developers (logs, status lines),
/// never end-user copy. Twin of core/sign-in-result.ts.
public enum SignInResult: Equatable, Sendable {
  case success
  case cancelled
  case failed(reason: SignInFailureReason, detail: String, status: Int?)
}
