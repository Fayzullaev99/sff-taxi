import type { Language } from '../core/i18n/language.js';

/**
 * A car's colour as riders look for it at the kerb: a fixed list with a code per colour
 * (`vehicles.colour` stores the code; migration 0029 mapped the free text written before),
 * shown in each person's language ("qora Malibu" / "чёрный Malibu"). The driver app and the
 * panel pick from the list; an API client that still sends free text gets it mapped when it
 * is one of these colours in either language (case, spaces and apostrophe variants apart)
 * and kept as written otherwise, so nothing a driver typed is lost.
 */

export const VEHICLE_COLOURS = [
  'white',
  'black',
  'silver',
  'grey',
  'blue',
  'dark_blue',
  'light_blue',
  'red',
  'dark_red',
  'green',
  'yellow',
  'orange',
  'brown',
  'beige',
  'purple',
  'gold',
] as const;

export type VehicleColour = (typeof VEHICLE_COLOURS)[number];

interface ColourInfo {
  uz: string;
  ru: string;
  /** Other spellings people write (lower case, a plain apostrophe): both languages. */
  aliases: readonly string[];
}

export const COLOUR_INFO: Record<VehicleColour, ColourInfo> = {
  white: { uz: 'oq', ru: 'белый', aliases: ['белая', 'white'] },
  black: { uz: 'qora', ru: 'чёрный', aliases: ['qara', 'черный', 'черная', 'чёрная', 'black'] },
  silver: {
    uz: 'kumush',
    ru: 'серебристый',
    aliases: ['kumushrang', 'kumush rang', 'серебристая', 'серебряный', 'серебро', 'silver'],
  },
  grey: { uz: 'kulrang', ru: 'серый', aliases: ['kul rang', 'серая', 'gray', 'grey'] },
  blue: { uz: "ko'k", ru: 'синий', aliases: ['kok', 'синяя', 'blue'] },
  dark_blue: {
    uz: "to'q ko'k",
    ru: 'тёмно-синий',
    aliases: ['toq kok', 'темно-синий', 'тёмно синий', 'темно синий', 'dark blue', 'navy'],
  },
  light_blue: {
    uz: 'havorang',
    ru: 'голубой',
    aliases: ['havo rang', 'moviy', 'голубая', 'light blue'],
  },
  red: { uz: 'qizil', ru: 'красный', aliases: ['красная', 'red'] },
  dark_red: {
    uz: "to'q qizil",
    ru: 'бордовый',
    aliases: ['toq qizil', 'bordo', 'бордовая', 'бордо', 'вишнёвый', 'вишневый', 'dark red'],
  },
  green: { uz: 'yashil', ru: 'зелёный', aliases: ['зеленый', 'зелёная', 'зеленая', 'green'] },
  yellow: { uz: 'sariq', ru: 'жёлтый', aliases: ['желтый', 'жёлтая', 'желтая', 'yellow'] },
  orange: {
    uz: "to'q sariq",
    ru: 'оранжевый',
    aliases: ['toq sariq', 'apelsin', 'apelsinrang', 'оранжевая', 'orange'],
  },
  brown: { uz: 'jigarrang', ru: 'коричневый', aliases: ['jigar rang', 'коричневая', 'brown'] },
  beige: { uz: 'bej', ru: 'бежевый', aliases: ['bejrang', 'бежевая', 'beige'] },
  purple: {
    uz: 'binafsha',
    ru: 'фиолетовый',
    aliases: ['binafsharang', 'binafsha rang', 'фиолетовая', 'сиреневый', 'purple'],
  },
  gold: {
    uz: 'tillarang',
    ru: 'золотистый',
    aliases: ['tilla rang', 'oltin', 'oltinrang', 'золотой', 'золотистая', 'gold'],
  },
};

export function isVehicleColour(value: unknown): value is VehicleColour {
  return typeof value === 'string' && value in COLOUR_INFO;
}

/** Lower case, one space, a plain apostrophe for every variant, a trailing "rang" dropped. */
export function normalizeColourText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ rang$/, '');
}

const BY_ALIAS: Map<string, VehicleColour> = new Map();
for (const code of VEHICLE_COLOURS) {
  const info = COLOUR_INFO[code];
  for (const alias of [code, info.uz, info.ru, ...info.aliases]) {
    BY_ALIAS.set(normalizeColourText(alias.replace(/_/g, ' ')), code);
    BY_ALIAS.set(normalizeColourText(alias), code);
  }
}

/** The code of a colour written in either language, or null for a colour not in the list. */
export function colourCode(text: string | null | undefined): VehicleColour | null {
  if (!text) return null;
  return BY_ALIAS.get(normalizeColourText(text)) ?? null;
}

/**
 * What to store for a colour an API client sent: the code when it names one of the list
 * (the apps send the code itself), else the text as written (trimmed).
 */
export function storedColour(text: string): string {
  return colourCode(text) ?? text.trim();
}

/** The colour of a stored value (a code, or older free text) in a language. */
export function colourText(stored: string, lang: Language): string {
  const code = colourCode(stored);
  return code ? COLOUR_INFO[code][lang] : stored;
}

/** The list for pickers, in a language: `{ code, label }` in the order above. */
export function colourChoices(lang: Language): { code: VehicleColour; label: string }[] {
  return VEHICLE_COLOURS.map((code) => ({ code, label: COLOUR_INFO[code][lang] }));
}

/** The names of a stored colour in both languages (the share page switches without a reload). */
export function colourNames(stored: string): { uz: string; ru: string } {
  return { uz: colourText(stored, 'uz'), ru: colourText(stored, 'ru') };
}
