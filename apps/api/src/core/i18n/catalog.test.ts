import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VALIDATION_MESSAGES } from '../http/messages.js';
import { QUICK_REPLIES } from '../../lib/chat.js';
import { REASON_LABELS } from '../../lib/reasons.js';
import { CLASS_INFO } from '../../lib/ride-classes.js';
import { COMPLAINT_LABELS } from '../../modules/complaints/complaints.module.js';
import { RU } from './ru.js';

/**
 * Every text the API writes for people has a Russian entry: the messages of exceptions and
 * `msg()`, `tr()` templates, `message:` fields, zod custom messages, and the label tables.
 * The extraction is by shape (same as how the texts are written in this codebase); a new
 * kind of call site must be added here, or the text has no translation and nobody notices.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Not written for riders or drivers: operator configuration, providers' own protocols. */
const SKIP_FILES = [
  'config/env.ts',
  'core/clock/',
  'core/sms/',
  'core/observability/',
  'modules/payments/payme.service.ts',
  'modules/payments/click.service.ts',
  'core/i18n/',
];

const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/y;

interface Found {
  text: string;
  where: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** A template literal's `${…}` parts become `{0}`, `{1}`…: the shape the catalog is keyed by. */
function asTemplate(quote: string, body: string): string {
  let n = 0;
  const text = quote === '`' ? body.replace(/\$\{[^}]*\}/g, () => `{${n++}}`) : body;
  return text.replace(/\\(['"`])/g, '$1');
}

/** The string literal at `pos` (after whitespace), or null. */
function literalAt(src: string, pos: number): { text: string; end: number } | null {
  let i = pos;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  LITERAL.lastIndex = i;
  const m = LITERAL.exec(src);
  return m ? { text: asTemplate(m[1]!, m[2]!), end: LITERAL.lastIndex } : null;
}

/** The text between the parenthesis at `open` and its match (string literals skipped). */
function balanced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      LITERAL.lastIndex = i;
      if (LITERAL.exec(src)) {
        i = LITERAL.lastIndex - 1;
        continue;
      }
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/** Literals that are arguments or ternary branches (not `x === 'cargo'` comparisons). */
function argumentLiterals(span: string): string[] {
  const out: string[] = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(span))) {
    const before = span.slice(0, m.index).trimEnd();
    const prev = before.at(-1) ?? '(';
    if (!['(', '?', ':', ','].includes(prev)) continue;
    out.push(asTemplate(m[1]!, m[2]!));
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

export function collectTexts(root: string): Found[] {
  const found: Found[] = [];
  for (const file of sourceFiles(root)) {
    const rel = relative(root, file).replace(/\\/g, '/');
    if (SKIP_FILES.some((s) => rel.startsWith(s))) continue;
    const src = stripComments(readFileSync(file, 'utf8'));
    const add = (text: string, kind: string) => found.push({ text, where: `${rel} (${kind})` });
    // new XxxException('…') | new XxxException(msg('…', …)) | new XxxException(c ? '…' : '…')
    for (const m of src.matchAll(/new\s+\w+Exception\(/g)) {
      const span = balanced(src, m.index + m[0].length - 1);
      if (!span.trim() || span.trim().startsWith('{')) continue; // object body: `message:`
      for (const t of argumentLiterals(span)) add(t, 'exception');
    }
    // msg('…', …) and tr('…', …): templates
    for (const m of src.matchAll(/\b(?:msg|tr)\(/g)) {
      const lit = literalAt(src, m.index + m[0].length);
      if (lit) add(lit.text, 'template');
    }
    // message: '…' | message: c ? '…' : '…'
    for (const m of src.matchAll(/\bmessage:\s*/g)) {
      const at = m.index + m[0].length;
      const lit = literalAt(src, at);
      if (lit) {
        add(lit.text, 'message');
        continue;
      }
      const tern =
        /^[^'"`;\n]*\?\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*:\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/.exec(
          src.slice(at, at + 400),
        );
      if (tern) {
        add(asTemplate(tern[1]!, tern[2]!), 'message');
        add(asTemplate(tern[3]!, tern[4]!), 'message');
      }
    }
    // zod: .refine(fn, '…'), .regex(re, '…'), .min(n, '…'), .max(n, '…'), z.iso.date('…')
    for (const m of src.matchAll(/\.(refine|regex|min|max|includes|length|date|int)\(/g)) {
      const span = balanced(src, m.index + m[0].length - 1);
      if (m[1] === 'date') {
        const lit = literalAt(span, 0);
        if (lit) add(lit.text, 'zod');
        continue;
      }
      let depth = 0;
      let lastComma = -1;
      for (let i = 0; i < span.length; i++) {
        const c = span[i];
        if (c === "'" || c === '"' || c === '`') {
          LITERAL.lastIndex = i;
          if (LITERAL.exec(span)) {
            i = LITERAL.lastIndex - 1;
            continue;
          }
        }
        if ('([{'.includes(c!)) depth++;
        else if (')]}'.includes(c!)) depth--;
        else if (c === ',' && depth === 0) lastComma = i;
      }
      if (lastComma < 0) continue;
      const lit = literalAt(span, lastComma + 1);
      if (lit && span.slice(lit.end).trim() === '') add(lit.text, 'zod');
    }
  }
  // identifiers and formats ("HH:MM", "cargo_s") are not texts for people
  return found.filter((f) => /[a-z‘’]/.test(f.text) && /[A-Za-z‘’]{2}/.test(f.text));
}

describe('Russian catalog', () => {
  it('has every text the code writes for people', () => {
    const missing = new Map<string, string[]>();
    for (const f of collectTexts(SRC)) {
      if (RU[f.text] !== undefined) continue;
      missing.set(f.text, [...(missing.get(f.text) ?? []), f.where]);
    }
    const report = [...missing.entries()]
      .map(([text, where]) => `${JSON.stringify(text)}  // ${[...new Set(where)].join(', ')}`)
      .join('\n');
    expect(report, 'add these to src/core/i18n/ru.ts').toBe('');
  });

  it('has the generated validation messages and the label tables', () => {
    const texts = [
      ...Object.values(VALIDATION_MESSAGES),
      ...Object.values(QUICK_REPLIES.rider),
      ...Object.values(QUICK_REPLIES.driver),
      ...Object.values(REASON_LABELS).flatMap((t) => Object.values(t)),
      ...Object.values(COMPLAINT_LABELS),
      ...Object.values(CLASS_INFO).flatMap((c) => [c.label, c.description]),
    ];
    expect(texts.filter((t) => RU[t] === undefined)).toEqual([]);
  });

  it('keeps the placeholders of every template', () => {
    const bad = Object.entries(RU).filter(([uz, ru]) => {
      const holes = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort();
      return holes(uz).join() !== holes(ru).join();
    });
    expect(bad).toEqual([]);
  });

  it('is Russian, not Uzbek left as it was', () => {
    const untranslated = Object.entries(RU).filter(([uz, ru]) => uz === ru);
    expect(untranslated).toEqual([]);
    const latinOnly = Object.entries(RU).filter(([, ru]) => !/[А-Яа-яЁё]/.test(ru));
    expect(latinOnly).toEqual([]);
  });
});
