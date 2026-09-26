/** Same normalisation as the API: "90 123 45 67", "998901234567" -> "+998901234567". */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[\s\-()]/g, '');
  if (/^\+998\d{9}$/.test(digits)) return digits;
  if (/^998\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\d{9}$/.test(digits)) return `+998${digits}`;
  return input.trim();
}

export function isUzPhone(input: string): boolean {
  return /^\+998\d{9}$/.test(normalizePhone(input));
}

/** "+998901234567" -> "+998 90 123 45 67" */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}
