// Export a tuned patch out of the workbench and back in.
//
// toTypeScript() IS the bridge to phase 4b: the factory bank is authored by
// pasting this output into factory-bank.ts. If the emitter is lossy, the bank
// silently differs from the sound the user approved — which is why
// patch-serialize.spec.ts evaluates every emitted literal back and compares it
// to the original, for every generator and insert kind.
import { validatePatch, type Patch } from '@allyworld/alloy-audio';

const INDENT = '  ';

/** JS identifiers can be bare keys; anything else must be quoted. */
function formatKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function formatValue(value: unknown, depth: number): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';

  const pad = INDENT.repeat(depth + 1);
  const closePad = INDENT.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${pad}${formatValue(item, depth + 1)},`);
    return `[\n${items.join('\n')}\n${closePad}]`;
  }

  // Drop undefined-valued keys: an optional field that is absent must stay
  // absent, not become `tvf: undefined` (which is not even valid in a literal
  // the way the engine expects, and would not deep-equal the original).
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([k, v]) => `${pad}${formatKey(k)}: ${formatValue(v, depth + 1)},`);
  return `{\n${lines.join('\n')}\n${closePad}}`;
}

/** The bare object literal — valid TypeScript AND valid JavaScript. */
export function toTypeScriptLiteral(patch: Patch): string {
  return formatValue(patch, 0);
}

/** A paste-ready `export const <name>: Patch = { ... };` for 4b's factory bank. */
export function toTypeScript(patch: Patch, constName: string): string {
  return `export const ${constName}: Patch = ${toTypeScriptLiteral(patch)};\n`;
}

export function toJson(patch: Patch): string {
  return JSON.stringify(patch, null, 2);
}

/** Never throws: bad input is a user typo, not a crash. */
export function fromJson(text: string): { patch: Patch } | { errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { errors: [`not valid JSON: ${(error as Error).message}`] };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { errors: ['not a patch object'] };
  }
  let errors: string[];
  try {
    errors = validatePatch(parsed as Patch);
  } catch (error) {
    return { errors: [`not a valid patch: ${(error as Error).message}`] };
  }
  if (errors.length > 0) return { errors };
  return { patch: parsed as Patch };
}
