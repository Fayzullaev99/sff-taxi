/**
 * A car's colour: the fixed list of apps/api src/lib/vehicle-colour.ts, as operators pick it
 * (the panel is Uzbek). The API stores the code and names it in each rider's language; a car
 * registered before the list may carry text the list does not name (`colourCode` null).
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

export const COLOUR_LABELS: Record<VehicleColour, string> = {
  white: 'Oq',
  black: 'Qora',
  silver: 'Kumush',
  grey: 'Kulrang',
  blue: 'Ko‘k',
  dark_blue: 'To‘q ko‘k',
  light_blue: 'Havorang',
  red: 'Qizil',
  dark_red: 'To‘q qizil',
  green: 'Yashil',
  yellow: 'Sariq',
  orange: 'To‘q sariq',
  brown: 'Jigarrang',
  beige: 'Bej',
  purple: 'Binafsha',
  gold: 'Tillarang',
};

export function isVehicleColour(value: string | null | undefined): value is VehicleColour {
  return typeof value === 'string' && (VEHICLE_COLOURS as readonly string[]).includes(value);
}

/**
 * The options of the colour select: the list, and first the car's own text when the list
 * does not name it (so the editor opens on what the car has, not on a wrong colour).
 */
export function colourOptions(car: {
  colour: string;
  colourCode?: string | null;
}): { value: string; label: string }[] {
  const list = VEHICLE_COLOURS.map((c) => ({ value: c, label: COLOUR_LABELS[c] }));
  return isVehicleColour(car.colourCode)
    ? list
    : [{ value: car.colour, label: `${car.colour} (ro‘yxatda yo‘q)` }, ...list];
}

/** What the select shows as chosen: the code, else the car's own text. */
export function currentColour(car: { colour: string; colourCode?: string | null }): string {
  return isVehicleColour(car.colourCode) ? car.colourCode : car.colour;
}
