import { afterEach, describe, expect, it } from 'vitest';
import type { PluralForms } from './core';
import { dictionaries, liveTable, setLanguage, t } from './dictionary';

type Node = string | PluralForms | { [k: string]: Node };

/** Every dotted key of a dictionary with its leaf. */
function leaves(node: Node, prefix = ''): [string, string | PluralForms][] {
  if (typeof node === 'string' || 'other' in node) return [[prefix, node as string | PluralForms]];
  return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const forms = (leaf: string | PluralForms) =>
  typeof leaf === 'string' ? [leaf] : Object.values(leaf).filter((f): f is string => !!f);

afterEach(() => setLanguage('uz'));

describe('dictionaries', () => {
  const uz = new Map(leaves(dictionaries.uz as Node));
  const ru = new Map(leaves(dictionaries.ru as Node));

  it('have the same keys in both languages', () => {
    expect([...ru.keys()].filter((k) => !uz.has(k))).toEqual([]);
    expect([...uz.keys()].filter((k) => !ru.has(k))).toEqual([]);
  });

  it('have no empty texts', () => {
    const empty = [...uz, ...ru].filter(([, leaf]) => forms(leaf).some((f) => !f.trim()));
    expect(empty.map(([k]) => k)).toEqual([]);
  });

  it('use the same placeholders in every language and form', () => {
    const bad: string[] = [];
    for (const [key, uzLeaf] of uz) {
      const expected = placeholders(forms(uzLeaf)[0]!).join();
      const ruLeaf = ru.get(key)!;
      for (const f of forms(ruLeaf)) {
        if (placeholders(f).join() !== expected) bad.push(`${key}: ${f}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('are Russian in the Russian dictionary (Uzbek left as it was is caught)', () => {
    // a Russian text without Cyrillic is a brand or a code ("Payme", "SMS", "PDF"), never
    // an Uzbek sentence: Uzbek apostrophes and common words give one away
    const UZBEK =
      /[‘’]|\b(va|uchun|bilan|yoki|emas|kerak|safar|haydovchi|yo‘lovchi|buyurtma|narx|so‘m|daq|qiling|mumkin|bo‘ladi|topilmadi)\b/i;
    const suspect = [...ru].filter(
      ([key, leaf]) =>
        !/^common\.language\./.test(key) &&
        !/[А-Яа-яЁё]/.test(forms(leaf).join(' ')) &&
        UZBEK.test(forms(leaf).join(' ')),
    );
    expect(suspect.map(([k]) => k)).toEqual([]);
  });

  it('switch at once, label tables included', () => {
    const classes = liveTable({
      economy: 'common.classes.economy',
      minivan: 'common.classes.minivan',
    });
    expect(t('common.actions.save')).toBe('Saqlash');
    expect(classes.economy).toBe('Ekonom');
    expect(Object.keys(classes)).toEqual(['economy', 'minivan']);
    setLanguage('ru');
    expect(t('common.actions.save')).toBe('Сохранить');
    expect(classes.minivan).toBe('Минивэн');
    expect(Object.entries(classes)).toEqual([
      ['economy', 'Эконом'],
      ['minivan', 'Минивэн'],
    ]);
    expect('economy' in classes).toBe(true);
    expect((classes as Record<string, string>).missing).toBeUndefined();
  });
});
