import { Injectable, Signal, computed, signal } from '@angular/core';

interface BusyEntry {
  id: number;
  label: string | null;
}

/**
 * Ref-counted blocking busy state. Apps call `begin()`/`while()` from
 * anywhere; the visual lives in BusyHostComponent (placed once via
 * <app-overlays>). The overlay shows while any begin() is unreleased, so
 * overlapping operations do not flicker.
 */
@Injectable({ providedIn: 'root' })
export class AlloyBusy {
  private nextId = 0;
  private readonly entries = signal<BusyEntry[]>([]);

  /** True while any begin() is unreleased. */
  readonly active: Signal<boolean> = computed(() => this.entries().length > 0);

  /** Most recent unreleased label, or null when none carries one. */
  readonly label: Signal<string | null> = computed(() => {
    const entries = this.entries();
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].label !== null) return entries[i].label;
    }
    return null;
  });

  /** Show the overlay until the returned release fn runs. Releasing twice is a no-op. */
  begin(label?: string): () => void {
    const id = this.nextId++;
    this.entries.update((list) => [...list, { id, label: label ?? null }]);
    return () => this.entries.update((list) => list.filter((e) => e.id !== id));
  }

  /** Hold the overlay for the lifetime of `work`; releases on resolve and reject. */
  async while<T>(work: Promise<T>, label?: string): Promise<T> {
    const release = this.begin(label);
    try {
      return await work;
    } finally {
      release();
    }
  }
}
