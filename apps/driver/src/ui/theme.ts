import { BRAND, BRAND_INK } from '../config';

/**
 * SFF Taxi brand: yellow #FFC400 on near-black #111 (the rider app uses the same pair).
 * The driver app is dark: easy on the eyes at night, less glare in the car, cheaper on
 * OLED batteries, and yellow on #111 is 11.6:1. Every text/background pair here is at
 * least 4.5:1 (WCAG AA) — most far above — for reading in direct sunlight.
 */
export const colors = {
  brand: BRAND,
  /** Text/icons on brand-yellow surfaces. */
  onBrand: BRAND_INK,
  brandSoft: '#3a3000',
  background: BRAND_INK,
  surface: '#1d1d1f',
  surfaceRaised: '#2a2a2d',
  text: '#ffffff',
  muted: '#b4b4bb',
  border: '#46464c',
  success: '#34c759',
  onSuccess: '#06240f',
  successSoft: '#12331c',
  warning: '#ffb020',
  warningSoft: '#3b2a05',
  danger: '#ff5a4f',
  onDanger: '#2a0402',
  dangerSoft: '#3d1210',
  info: '#6cb6ff',
  infoSoft: '#0f2640',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

/** Buttons used while driving (one hand, a phone in a holder): at least this tall. */
export const TOUCH = 56;
