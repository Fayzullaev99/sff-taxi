/**
 * How to address a driver in public (the trip board before booking, the shared trip link):
 * the given name only. Drivers register the official way, "Familiya Ism Otasining ismi"
 * ("Qodirov Sherzodbek Abdumalikovich"), so the first word is usually the surname — the
 * most identifying part, not the one to show. The given name is the first word that does
 * not look like a surname or a patronymic (-ov/-ev/-ova/-eva/-iy/-vich/-vna, qizi, o‘g‘li);
 * two words in either order ("Aziz Karimov", "Karimov Aziz") both give "Aziz".
 */
const SURNAME_OR_PATRONYMIC =
  /(ov|ev|yov|ova|eva|yova|iy|aya|vich|vna|qizi|o['‘’`]?g['‘’`]?li|ogli)$/i;

export function driverGivenName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return words.find((w) => !SURNAME_OR_PATRONYMIC.test(w)) ?? words[1] ?? words[0]!;
}
