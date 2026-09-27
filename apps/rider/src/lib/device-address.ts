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

/**
 * One address line from the phone's geocoder: street and number (else the place name),
 * district, city; repeated parts once. Android puts a plus code in `name` where it knows no
 * street ("FQVJ+FCW, Gulistan"), which is dropped. Null when nothing useful is left.
 */
export function deviceAddressLine(place: DevicePlace): string | null {
  const street = [place.street, place.streetNumber].filter(Boolean).join(' ');
  const name = place.name && !PLUS_CODE.test(place.name.trim()) ? place.name : null;
  const parts = [street || name, place.district, place.city ?? place.subregion].filter(
    (p): p is string => Boolean(p && p.trim() && !PLUS_CODE.test(p.trim())),
  );
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.length ? unique.join(', ') : null;
}
