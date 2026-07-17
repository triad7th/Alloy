import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  BrowserStorageBackend,
  createDriveStorage,
  isShareable,
  StorageError,
  type ShareStatus,
  type StorageRecordMeta,
} from '@allyworld/alloy-storage';

/** Fill these in to light up the Drive half of the demo:
 *  1. Google Cloud console → OAuth web client (code flow); add the harness
 *     origin (http://localhost:4510) as an authorized JS origin + redirect URI.
 *  2. Run the token service locally: `netlify dev` in services/google-oauth
 *     with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / ALLOWED_ORIGINS set in
 *     its .env (ALLOWED_ORIGINS=http://localhost:4510).
 *  Empty strings = the Drive card shows these setup steps instead. */
const GOOGLE_CLIENT_ID: string =
  '929183445053-ifjjaptf6g48orqj2eu8o06macrp752a.apps.googleusercontent.com';
const TOKEN_SERVICE_URL: string = 'http://localhost:8888';
const DRIVE_FOLDER = 'AlloyHarness';

/** Section 5: AlloyStorage. Local half exercises BrowserStorageBackend
 *  (IndexedDB) — records survive reloads. Drive half exercises the real
 *  OAuth code flow + DriveBackend once the constants above are set. */
@Component({
  selector: 'hx-storage-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <section class="demo">
      <h2 class="demo-title">Storage</h2>
      <p class="demo-caption">
        &#64;allyworld/alloy-storage from source. Left: BrowserStorageBackend (IndexedDB) — save,
        reload the page, and the records are still there. Right: DriveBackend behind the real
        Google OAuth code flow.
      </p>

      <div class="storage-grid">
        <div class="storage-card">
          <h3 class="storage-card-title">Local (IndexedDB)</h3>
          <label class="field">
            <span>id</span>
            <input [value]="recId()" (input)="recId.set(asInput($event).value)" />
          </label>
          <label class="field">
            <span>name</span>
            <input [value]="recName()" (input)="recName.set(asInput($event).value)" />
          </label>
          <label class="field">
            <span>payload</span>
            <textarea rows="3" [value]="recPayload()" (input)="recPayload.set(asArea($event).value)"></textarea>
          </label>
          <div class="btn-row">
            <button (click)="localSave()">Save</button>
            <button (click)="localLoad()">Load</button>
            <button (click)="localDelete()">Delete</button>
            <button (click)="localRefresh()">List</button>
          </div>
          <p class="status">{{ localStatus() }}</p>
          @if (localMetas().length > 0) {
            <table class="meta-table">
              <thead>
                <tr><th>id</th><th>name</th><th>updatedAt</th></tr>
              </thead>
              <tbody>
                @for (m of localMetas(); track m.id) {
                  <tr>
                    <td><code>{{ m.id }}</code></td>
                    <td>{{ m.name }}</td>
                    <td>{{ m.updatedAt | date: 'HH:mm:ss' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>

        <div class="storage-card">
          <h3 class="storage-card-title">Google Drive</h3>
          @if (!driveConfigured) {
            <p class="status">
              Not configured. Set <code>GOOGLE_CLIENT_ID</code> and
              <code>TOKEN_SERVICE_URL</code> in storage-section.component.ts — see the comment
              there for the two setup steps (OAuth web client + local token service).
            </p>
          } @else {
            <p class="status">auth: <code>{{ authState() }}</code></p>
            <div class="btn-row">
              @if (authState() !== 'signedIn') {
                <button (click)="driveSignIn()">Sign in with Google</button>
              } @else {
                <button (click)="driveSave()">Save record to Drive</button>
                <button (click)="driveRefresh()">List Drive folder</button>
                <button (click)="driveSignOut()">Sign out</button>
              }
            </div>
            @if (authState() === 'signedIn') {
              <div class="btn-row">
                <button (click)="shareRefresh()">Share status</button>
                <button (click)="shareToggle()">
                  {{ shareInfo()?.shared ? 'Unshare' : 'Share' }}
                </button>
              </div>
              @if (shareInfo(); as info) {
                @if (info.shared) {
                  <p class="status">shared — anyone with the link can view</p>
                  <div class="btn-row">
                    <input class="share-link" readonly [value]="driveLink(info.nativeRef)"
                      (focus)="asInput($event).select()" />
                    <button (click)="copyLink(info.nativeRef)">
                      {{ copied() ? 'Copied ✓' : 'Copy link' }}
                    </button>
                  </div>
                } @else {
                  <p class="status">not shared <code>{{ info.nativeRef }}</code></p>
                }
              }
            }
            <p class="status">{{ driveStatus() }}</p>
            @if (driveMetas().length > 0) {
              <table class="meta-table">
                <thead>
                  <tr><th>id</th><th>name</th><th>updatedAt</th></tr>
                </thead>
                <tbody>
                  @for (m of driveMetas(); track m.id) {
                    <tr>
                      <td><code>{{ m.id }}</code></td>
                      <td>{{ m.name }}</td>
                      <td>{{ m.updatedAt | date: 'HH:mm:ss' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          }
        </div>
      </div>
    </section>
  `,
  styles: `
    .storage-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1rem;
    }
    .storage-card {
      background: rgba(255, 255, 255, 0.04);
      border-radius: 12px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .storage-card-title {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 600;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.8rem;
      opacity: 0.9;
    }
    .field input,
    .field textarea {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      color: inherit;
      padding: 0.4rem 0.55rem;
      font: inherit;
      font-size: 0.85rem;
    }
    .btn-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .btn-row button {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      color: inherit;
      padding: 0.4rem 0.8rem;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .btn-row button:hover {
      background: rgba(255, 255, 255, 0.14);
    }
    .status {
      margin: 0;
      font-size: 0.8rem;
      opacity: 0.75;
      min-height: 1.1em;
    }
    .share-link {
      flex: 1;
      min-width: 200px;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      color: inherit;
      padding: 0.4rem 0.55rem;
      font-size: 0.8rem;
    }
    .meta-table {
      border-collapse: collapse;
      font-size: 0.8rem;
      width: 100%;
    }
    .meta-table th,
    .meta-table td {
      text-align: left;
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
  `,
})
export class StorageSectionComponent {
  private readonly local = new BrowserStorageBackend('harness');

  readonly recId = signal('settings');
  readonly recName = signal('settings.json');
  readonly recPayload = signal('{"theme":"dark","volume":0.8}');
  readonly localStatus = signal('');
  readonly localMetas = signal<StorageRecordMeta[]>([]);

  readonly driveConfigured = GOOGLE_CLIENT_ID !== '' && TOKEN_SERVICE_URL !== '';
  private readonly driveStorage = this.driveConfigured
    ? createDriveStorage({
        clientId: GOOGLE_CLIENT_ID,
        redirectUri: `${location.origin}/`,
        tokenServiceUrl: TOKEN_SERVICE_URL,
        folderPath: DRIVE_FOLDER,
      })
    : null;
  private readonly auth = this.driveStorage?.auth ?? null;
  private readonly drive = this.driveStorage?.backend ?? null;

  readonly authState = signal<'signedOut' | 'signedIn' | 'expired'>('signedOut');
  readonly driveStatus = signal('');
  readonly driveMetas = signal<StorageRecordMeta[]>([]);
  readonly shareInfo = signal<ShareStatus | null>(null);
  readonly copied = signal(false);
  private copyTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Drive's universal viewer link — works for any anyone-with-link file.
   *  Apps build their own link format (that's app policy); the harness uses
   *  Drive's so manual QA can verify sharing end-to-end in an incognito tab. */
  driveLink(nativeRef: string): string {
    return `https://drive.google.com/file/d/${nativeRef}/view`;
  }

  async copyLink(nativeRef: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.driveLink(nativeRef));
      this.copied.set(true);
      if (this.copyTimeout !== null) clearTimeout(this.copyTimeout);
      this.copyTimeout = setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* clipboard unavailable — the focused input still allows manual copy */
    }
  }

  constructor() {
    void this.localRefresh();
    if (this.auth) void this.finishRedirectIfPending();
  }

  asInput(e: Event): HTMLInputElement {
    return e.target as HTMLInputElement;
  }
  asArea(e: Event): HTMLTextAreaElement {
    return e.target as HTMLTextAreaElement;
  }

  async localSave(): Promise<void> {
    try {
      await this.local.write({
        id: this.recId(),
        name: this.recName(),
        updatedAt: Date.now(),
        payload: this.recPayload(),
      });
      this.localStatus.set(`saved '${this.recId()}'`);
      await this.localRefresh();
    } catch (e) {
      this.localStatus.set(this.describe(e));
    }
  }

  async localLoad(): Promise<void> {
    try {
      const rec = await this.local.read(this.recId());
      if (!rec) {
        this.localStatus.set(`no record '${this.recId()}'`);
        return;
      }
      this.recName.set(rec.name);
      this.recPayload.set(rec.payload);
      this.localStatus.set(`loaded '${rec.id}' (updated ${new Date(rec.updatedAt).toLocaleTimeString()})`);
    } catch (e) {
      this.localStatus.set(this.describe(e));
    }
  }

  async localDelete(): Promise<void> {
    try {
      await this.local.delete(this.recId());
      this.localStatus.set(`deleted '${this.recId()}'`);
      await this.localRefresh();
    } catch (e) {
      this.localStatus.set(this.describe(e));
    }
  }

  async localRefresh(): Promise<void> {
    try {
      this.localMetas.set(await this.local.list());
    } catch (e) {
      this.localStatus.set(this.describe(e));
    }
  }

  async driveSignIn(): Promise<void> {
    await this.auth?.beginSignIn(); // navigates away; completes on redirect
  }

  async driveSignOut(): Promise<void> {
    await this.auth?.signOut();
    this.syncAuthState();
    this.driveMetas.set([]);
    this.driveStatus.set('signed out');
  }

  async driveSave(): Promise<void> {
    if (!this.drive) return;
    try {
      await this.drive.write({
        id: this.recId(),
        name: this.recName(),
        updatedAt: Date.now(),
        payload: this.recPayload(),
      });
      this.driveStatus.set(`saved '${this.recId()}' to Drive:/${DRIVE_FOLDER}`);
      this.syncAuthState();
      await this.driveRefresh();
    } catch (e) {
      this.driveStatus.set(this.describe(e));
      this.syncAuthState();
    }
  }

  async driveRefresh(): Promise<void> {
    if (!this.drive) return;
    try {
      this.driveMetas.set(await this.drive.list());
      this.driveStatus.set(`listed Drive:/${DRIVE_FOLDER}`);
      this.syncAuthState();
    } catch (e) {
      this.driveStatus.set(this.describe(e));
      this.syncAuthState();
    }
  }

  async shareRefresh(): Promise<void> {
    if (!this.drive || !isShareable(this.drive)) return;
    try {
      this.shareInfo.set(await this.drive.shareStatus(this.recId()));
      this.driveStatus.set(this.shareInfo() ? 'share status refreshed' : 'record not on Drive yet');
    } catch (e) {
      this.driveStatus.set(this.describe(e));
      this.syncAuthState();
    }
  }

  async shareToggle(): Promise<void> {
    if (!this.drive || !isShareable(this.drive)) return;
    try {
      if (this.shareInfo()?.shared) {
        await this.drive.unshare(this.recId());
      } else {
        await this.drive.share(this.recId());
      }
      await this.shareRefresh();
    } catch (e) {
      this.driveStatus.set(this.describe(e));
      this.syncAuthState();
    }
  }

  /** Resume the code-flow redirect: exchange ?code=…&state=… if present. */
  private async finishRedirectIfPending(): Promise<void> {
    const params = new URL(location.href).searchParams;
    if (params.has('code') && params.has('state')) {
      const result = await this.auth!.completeSignIn(location.href);
      history.replaceState(null, '', location.pathname); // clean the URL
      this.driveStatus.set(
        result.outcome === 'success'
          ? 'signed in'
          : result.outcome === 'cancelled'
            ? 'sign-in cancelled'
            : `sign-in failed — ${result.reason}: ${result.detail}`
      );
    } else {
      // A prior session's refresh token may still be valid — probe silently.
      await this.auth!.accessToken();
    }
    this.syncAuthState();
  }

  private syncAuthState(): void {
    if (this.auth) this.authState.set(this.auth.state);
  }

  private describe(e: unknown): string {
    if (e instanceof StorageError) return `StorageError(${e.category}): ${e.message}`;
    return e instanceof Error ? e.message : String(e);
  }
}
