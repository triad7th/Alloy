import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Patch } from '@allyworld/alloy-audio';
import {
  BENCHMARK_VOICE_COST,
  GENERATOR_KINDS,
  INSERT_KINDS,
  MAX_INSERTS,
  MAX_LAYERS,
  addInsert,
  addLayer,
  addOperator,
  addPartial,
  getAt,
  moveInsert,
  removeInsert,
  removeLayer,
  removeOperator,
  removePartial,
  setAt,
  setGeneratorKind,
  setInsertKind,
  voiceCost,
  type GeneratorKind,
  type InsertKind,
} from './patch-edit.js';
import { describePatch, type ParamDescriptor } from './patch-schema.js';

/** Renders a Patch entirely from describePatch(). It knows nothing about the
 *  patch schema — add a field to the descriptor table and it appears here. */
@Component({
  selector: 'app-patch-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="editor">
      <header class="editor__bar">
        <span class="editor__cost" [class.editor__cost--heavy]="cost() > BENCHMARK_VOICE_COST">
          Voice cost {{ cost() }} &mdash; the CPU-benchmarked patch is {{ BENCHMARK_VOICE_COST }}
        </span>
      </header>

      @if (errors().length > 0) {
        <ul class="editor__errors">
          @for (error of errors(); track error) {
            <li>{{ error }}</li>
          }
        </ul>
      }

      <div class="editor__structure">
        <button type="button" [disabled]="patch().layers.length >= MAX_LAYERS" (click)="onAddLayer()">
          + Layer
        </button>
        @for (layer of patch().layers; track $index) {
          <span class="editor__chip">
            L{{ $index + 1 }}
            <select
              [value]="layer.generator.kind"
              (change)="onGeneratorKind($index, $any($event.target).value)"
            >
              @for (kind of GENERATOR_KINDS; track kind) {
                <option [value]="kind">{{ kind }}</option>
              }
            </select>
            @if (layer.generator.kind === 'fm') {
              <button type="button" (click)="onAddOperator($index)">+op</button>
              <button type="button" (click)="onRemoveOperator($index)">-op</button>
            }
            @if (layer.generator.kind === 'additive') {
              <button type="button" (click)="onAddPartial($index)">+partial</button>
              <button type="button" (click)="onRemovePartial($index)">-partial</button>
            }
            <button type="button" [disabled]="patch().layers.length <= 1" (click)="onRemoveLayer($index)">
              &times;
            </button>
          </span>
        }
      </div>

      <div class="editor__structure">
        <select #insertKind>
          @for (kind of INSERT_KINDS; track kind) {
            <option [value]="kind">{{ kind }}</option>
          }
        </select>
        <button
          type="button"
          [disabled]="(patch().inserts?.length ?? 0) >= MAX_INSERTS"
          (click)="onAddInsert($any(insertKind).value)"
        >
          + Insert
        </button>
        @for (insert of patch().inserts ?? []; track $index) {
          <span class="editor__chip">
            <select [value]="insert.kind" (change)="onInsertKind($index, $any($event.target).value)">
              @for (kind of INSERT_KINDS; track kind) {
                <option [value]="kind">{{ kind }}</option>
              }
            </select>
            <button type="button" [disabled]="$index === 0" (click)="onMoveInsert($index, $index - 1)">
              &uarr;
            </button>
            <button type="button" (click)="onRemoveInsert($index)">&times;</button>
          </span>
        }
      </div>

      @for (group of groups(); track group.title) {
        <section class="editor__group">
          <h4>{{ group.title }}</h4>
          @for (param of group.params; track param.path) {
            <label class="editor__param">
              <span class="editor__label">{{ param.label }}</span>
              @if (param.kind === 'number') {
                <input
                  type="range"
                  [min]="param.min ?? 0"
                  [max]="param.max ?? 1"
                  [step]="param.step ?? 0.01"
                  [value]="numberAt(param)"
                  (input)="onNumber(param, $any($event.target).value)"
                />
                <span class="editor__value">{{ numberAt(param) }}{{ param.unit ?? '' }}</span>
              } @else if (param.kind === 'enum') {
                <select [value]="valueAt(param)" (change)="onEnum(param, $any($event.target).value)">
                  @for (option of param.options ?? []; track option) {
                    <option [value]="option">{{ option }}</option>
                  }
                </select>
              } @else {
                <input
                  type="text"
                  [value]="valueAt(param)"
                  (change)="onText(param, $any($event.target).value)"
                />
              }
            </label>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .editor { display: flex; flex-direction: column; gap: 0.75rem; }
    .editor__bar { display: flex; justify-content: space-between; font-size: 0.8rem; opacity: 0.8; }
    .editor__cost--heavy { color: #d08a30; font-weight: 600; }
    .editor__errors { color: #d05050; font-size: 0.8rem; margin: 0; padding-left: 1rem; }
    .editor__structure { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
    .editor__chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.15rem 0.4rem;
      border: 1px solid currentColor; border-radius: 4px; font-size: 0.75rem; opacity: 0.9; }
    .editor__group { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 0.35rem; }
    .editor__group h4 { grid-column: 1 / -1; margin: 0.5rem 0 0; font-size: 0.8rem; text-transform: uppercase; opacity: 0.7; }
    .editor__param { display: grid; grid-template-columns: 6rem 1fr 4rem; align-items: center; gap: 0.4rem; font-size: 0.75rem; }
    .editor__value { text-align: right; font-variant-numeric: tabular-nums; opacity: 0.7; }
  `,
})
export class PatchEditorComponent {
  readonly patch = input.required<Patch>();
  readonly errors = input<readonly string[]>([]);
  readonly patchChange = output<Patch>();

  protected readonly GENERATOR_KINDS = GENERATOR_KINDS;
  protected readonly INSERT_KINDS = INSERT_KINDS;
  protected readonly MAX_LAYERS = MAX_LAYERS;
  protected readonly MAX_INSERTS = MAX_INSERTS;
  protected readonly BENCHMARK_VOICE_COST = BENCHMARK_VOICE_COST;

  protected readonly groups = computed(() => describePatch(this.patch()));
  protected readonly cost = computed(() => voiceCost(this.patch()));

  protected valueAt(param: ParamDescriptor): string {
    return String(getAt(this.patch(), param.path) ?? '');
  }

  protected numberAt(param: ParamDescriptor): number {
    return Number(getAt(this.patch(), param.path) ?? 0);
  }

  protected onNumber(param: ParamDescriptor, raw: string): void {
    this.patchChange.emit(setAt(this.patch(), param.path, Number(raw)));
  }

  protected onEnum(param: ParamDescriptor, raw: string): void {
    // Enum options are strings or numbers (phaser.stages is 4 | 8); a <select>
    // hands back a string either way, so restore the option's original type.
    const option = (param.options ?? []).find((o) => String(o) === raw) ?? raw;
    this.patchChange.emit(setAt(this.patch(), param.path, option));
  }

  protected onText(param: ParamDescriptor, raw: string): void {
    this.patchChange.emit(setAt(this.patch(), param.path, raw));
  }

  protected onAddLayer(): void {
    this.patchChange.emit(addLayer(this.patch()));
  }

  protected onRemoveLayer(index: number): void {
    this.patchChange.emit(removeLayer(this.patch(), index));
  }

  protected onGeneratorKind(index: number, kind: string): void {
    this.patchChange.emit(setGeneratorKind(this.patch(), index, kind as GeneratorKind));
  }

  protected onAddOperator(index: number): void {
    this.patchChange.emit(addOperator(this.patch(), index));
  }

  protected onRemoveOperator(index: number): void {
    const generator = this.patch().layers[index].generator;
    if (generator.kind !== 'fm') return;
    this.patchChange.emit(removeOperator(this.patch(), index, generator.fm.operators.length - 1));
  }

  protected onAddPartial(index: number): void {
    this.patchChange.emit(addPartial(this.patch(), index));
  }

  protected onRemovePartial(index: number): void {
    const generator = this.patch().layers[index].generator;
    if (generator.kind !== 'additive') return;
    this.patchChange.emit(removePartial(this.patch(), index, generator.partials.length - 1));
  }

  protected onAddInsert(kind: string): void {
    this.patchChange.emit(addInsert(this.patch(), kind as InsertKind));
  }

  protected onRemoveInsert(index: number): void {
    this.patchChange.emit(removeInsert(this.patch(), index));
  }

  protected onMoveInsert(from: number, to: number): void {
    this.patchChange.emit(moveInsert(this.patch(), from, to));
  }

  protected onInsertKind(index: number, kind: string): void {
    this.patchChange.emit(setInsertKind(this.patch(), index, kind as InsertKind));
  }
}
