/** What the phone's own geocoder returns (expo-location `reverseGeocodeAsync`), in part. */
export interface DevicePlace {
  name?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  district?: string | null;
  city?: string | null;
  subregion?: string | null;
}

/** A Google "plus code" such as "FQVJ+FCW" (or "8GRPFQVJ+FCW"): meaningless to riders. */
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,3}$/i;

/** Cyrillic text: a phone in Russian names "улица Увайсий"; drivers read Uzbek (Latin). */
const CYRILLIC = /[Ѐ-ӿ]/;

/** English administrative words a phone in English adds, in Uzbek. */
const ENGLISH_WORDS: [RegExp, string][] = [
  [/\s+District$/i, ' tumani'],
  [/\s+Region$/i, ' viloyati'],
  [/\s+Province$/i, ' viloyati'],
];

/**
 * One part of an address a driver can read, or null: plus codes and Cyrillic dropped
 * ("FQVJ+FCW", "улица Увайсий"), "Bayaut District" -> "Bayaut tumani".
 */
function cleanPart(part: string | null | undefined): string | null {
  let p = part?.trim();
  if (!p || PLUS_CODE.test(p) || CYRILLIC.test(p)) return null;
  // "FQVJ+FCW Guliston": the code in front of a name
  p = p
    .split(/\s+/)
    .filter((w) => !PLUS_CODE.test(w))
    .join(' ');
  for (const [re, uz] of ENGLISH_WORDS) p = p.replace(re, uz);
  return p || null;
}

function joinParts(parts: (string | null | undefined)[]): string | null {
  const clean = parts.map(cleanPart).filter((p): p is string => p !== null);
  const unique = clean.filter((p, i) => clean.indexOf(p) === i);
  return unique.length ? unique.join(', ') : null;
}

/**
 * One address line from the phone's geocoder: street and number (else the place name),
 * district, city; repeated parts once. Android puts a plus code in `name` where it knows no
 * street ("FQVJ+FCW, Gulistan"), which is dropped, and so is anything in Cyrillic. Null when
 * nothing useful is left.
 */
export function deviceAddressLine(place: DevicePlace): string | null {
  const street = [place.street, place.streetNumber].filter(Boolean).join(' ');
  return joinParts([
    cleanPart(street) ?? place.name,
    place.district,
    place.city ?? place.subregion,
  ]);
}

/** The API's reverse geocoding (GET /v1/geo/reverse, lang uz) as one line, plus codes out. */
export function apiAddressLine(
  address: { title: string; subtitle: string | null } | null | undefined,
): string | null {
  if (!address) return null;
  return joinParts([...address.title.split(','), ...(address.subtitle ?? '').split(',')]);
}

/**
 * The address text sent with an order (and shown to the driver): the API's Uzbek address;
 * the phone's own geocoder only when the API gave nothing; null when neither has a readable
 * one — the landmark and the pin carry the place then (never coordinates or a plus code).
 */
export async function chooseAddress(
  api: { title: string; subtitle: string | null } | null | undefined,
  device: () => Promise<DevicePlace | null | undefined>,
): Promise<string | null> {
  const fromApi = apiAddressLine(api);
  if (fromApi) return fromApi;
  try {
    const place = await device();
    return place ? deviceAddressLine(place) : null;
  } catch {
    return null;
  }
}
