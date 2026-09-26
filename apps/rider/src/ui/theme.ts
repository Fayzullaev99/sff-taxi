import type { TextStyle } from 'react-native';

/**
 * SFF Taxi brand: taxi yellow #FFC400 with near-black #111 (the classic taxi pair, and
 * distinct from SFF Eats' red). Yellow is a fill only — text on it is always #111
 * (contrast 12:1); yellow text on white would be unreadable, so links use a dark amber.
 */
export const colors = {
  brand: '#FFC400',
  /** Fills behind dark text (primary buttons, the pickup pin). */
  brandStrong: '#FFC400',
  brandPressed: '#E6AF00',
  /** Brand-coloured text on light backgrounds (links): dark amber, AA contrast (5.9:1). */
  brandText: '#7A5600',
  brandSoft: '#FFF5D1',
  ink: '#111111',
  inkPressed: '#2C2C2E',
  text: '#111111',
  textMuted: '#636366',
  textFaint: '#A1A1A6',
  /** Placeholder text: lighter than muted, still readable on the grey inputs. */
  placeholder: '#86868B',
  onBrand: '#111111',
  onInk: '#FFFFFF',
  bg: '#FFFFFF',
  surface: '#F3F3F5',
  surfacePressed: '#E7E7EA',
  border: '#E3E3E8',
  success: '#17875A',
  successSoft: '#E6F5EE',
  warning: '#A8650A',
  warningSoft: '#FDF3E2',
  danger: '#D1352B',
  dangerStrong: '#C62828',
  dangerSoft: '#FDECEA',
  info: '#2F6FDB',
  infoSoft: '#EAF1FD',
  overlay: 'rgba(0,0,0,0.45)',
  skeleton: '#ECECEF',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

/** 4-point spacing scale. */
export const space = (n: number) => n * 4;

export const type = {
  h1: { fontSize: 26, lineHeight: 32, fontWeight: '800' },
  h2: { fontSize: 21, lineHeight: 27, fontWeight: '700' },
  h3: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  smallStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
  /** The car's plate: large, spaced, readable from a step away. */
  plate: { fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: 1.5 },
  price: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  bar: {
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
} as const;
