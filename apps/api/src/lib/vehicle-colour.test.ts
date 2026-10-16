import { describe, expect, it } from 'vitest';
import {
  colourChoices,
  colourCode,
  colourNames,
  colourText,
  COLOUR_INFO,
  storedColour,
  VEHICLE_COLOURS,
} from './vehicle-colour.js';

describe('vehicle colours', () => {
  it('maps what drivers wrote, in either language and spelling, to a code', () => {
    expect(colourCode('oq')).toBe('white');
    expect(colourCode(' Oq ')).toBe('white');
    expect(colourCode('QORA')).toBe('black');
    expect(colourCode('белый')).toBe('white');
    expect(colourCode('Чёрный')).toBe('black');
    expect(colourCode('черный')).toBe('black');
    // every apostrophe Uzbek keyboards produce, and the word "rang" after the colour
    for (const s of ["ko'k", 'ko‘k', 'ko’k', 'koʻk', 'ko`k', 'kok', 'ko‘k rang']) {
      expect(colourCode(s), s).toBe('blue');
    }
    expect(colourCode('to‘q qizil')).toBe('dark_red');
    expect(colourCode('бордовый')).toBe('dark_red');
    expect(colourCode('kul rang')).toBe('grey');
    expect(colourCode('серебристый')).toBe('silver');
    // the codes themselves (what the apps send)
    for (const code of VEHICLE_COLOURS) expect(colourCode(code)).toBe(code);
    expect(colourCode('dark_blue')).toBe('dark_blue');
    // not a colour of the list: kept as text
    expect(colourCode('xameleon')).toBeNull();
    expect(colourCode('')).toBeNull();
    expect(colourCode(null)).toBeNull();
  });

  it('stores the code for a known colour and the text for anything else', () => {
    expect(storedColour('Qora')).toBe('black');
    expect(storedColour('  pushti ')).toBe('pushti');
  });

  it('shows a stored colour in each language, older free text as it is', () => {
    expect(colourText('black', 'uz')).toBe('qora');
    expect(colourText('black', 'ru')).toBe('чёрный');
    // a row migration 0029 could not map, or an older snapshot on a ride
    expect(colourText('oq', 'ru')).toBe('белый');
    expect(colourText('pushti', 'ru')).toBe('pushti');
    expect(colourNames('dark_red')).toEqual({ uz: 'to‘q qizil'.replace('‘', "'"), ru: 'бордовый' });
  });

  it('lists the colours for pickers in order, named in the language', () => {
    const uz = colourChoices('uz');
    expect(uz.map((c) => c.code)).toEqual([...VEHICLE_COLOURS]);
    expect(uz[0]).toEqual({ code: 'white', label: 'oq' });
    expect(colourChoices('ru').find((c) => c.code === 'yellow')?.label).toBe('жёлтый');
    // no alias points at two colours
    const seen = new Map<string, string>();
    for (const code of VEHICLE_COLOURS) {
      for (const alias of [
        COLOUR_INFO[code].uz,
        COLOUR_INFO[code].ru,
        ...COLOUR_INFO[code].aliases,
      ]) {
        const owner = seen.get(alias.toLowerCase());
        expect(owner === undefined || owner === code, alias).toBe(true);
        seen.set(alias.toLowerCase(), code);
      }
    }
  });
});
