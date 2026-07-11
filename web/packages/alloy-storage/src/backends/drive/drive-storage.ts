import { GoogleAuth, type GoogleAuthDeps } from '../../auth/google-auth.js';
import { DriveBackend } from './drive-backend.js';
import { DriveClient } from './drive-client.js';

const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface DriveStorageConfig {
  clientId: string;
  redirectUri: string;
  tokenServiceUrl: string;
  /** Folder path find-or-created from the Drive root, e.g. 'AllyWorld/AllyClock'. */
  folderPath: string;
  /** Defaults to drive.file — the app sees only files it created. */
  scope?: string;
}

/** Injection seams, forwarded to the underlying pieces (tests, custom transports). */
export interface DriveStorageDeps {
  auth?: GoogleAuthDeps;
  fetchFn?: typeof fetch;
  cache?: Storage | null;
}

export interface DriveStorage {
  auth: GoogleAuth;
  backend: DriveBackend;
}

/** One-call wiring of the Drive stack: GoogleAuth → DriveClient → DriveBackend.
 *  The client is internal plumbing; apps keep the two objects they use.
 *  Sugar, not a seal — the individual constructors remain public. */
export function createDriveStorage(
  config: DriveStorageConfig,
  deps: DriveStorageDeps = {}
): DriveStorage {
  const auth = new GoogleAuth(
    {
      clientId: config.clientId,
      scope: config.scope ?? DEFAULT_SCOPE,
      redirectUri: config.redirectUri,
      tokenServiceUrl: config.tokenServiceUrl,
    },
    deps.auth ?? {}
  );
  const client = deps.fetchFn ? new DriveClient(auth, deps.fetchFn) : new DriveClient(auth);
  const backend =
    deps.cache === undefined
      ? new DriveBackend(client, config.folderPath)
      : new DriveBackend(client, config.folderPath, deps.cache);
  return { auth, backend };
}
