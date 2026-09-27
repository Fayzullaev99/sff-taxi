import { type AdminDriver, DOCUMENT_KINDS } from '../api/types';
import { daysBetween, DOCUMENTS, fullYears, LICENCE_STATUS } from './format';

/**
 * Resolution 200 rules as the API checks them on approval (apps/api/src/lib/driver-rules.ts),
 * shown to the operator as a checklist before they press "Tasdiqlash".
 */
export const DRIVER_RULES = {
  minAge: 21,
  minExperienceYears: 3,
  maxVehicleAgeYears: 15,
  maxComfortAgeYears: 5,
  maxSeats: 4,
} as const;

export interface Check {
  ok: boolean;
  label: string;
  detail?: string;
}

export function isVanType(make: string, model: string): boolean {
  return /\b(damas|labo)\b/i.test(`${make} ${model}`);
}

/** Every rule with whether the application meets it (the API refuses approval otherwise). */
export function approvalChecks(d: AdminDriver, today: string): Check[] {
  const age = fullYears(d.birthDate, today);
  const experience = fullYears(d.licence.issuedOn, today);
  const year = Number(today.slice(0, 4));
  const checks: Check[] = [
    {
      ok: d.birthDate <= today && age >= DRIVER_RULES.minAge,
      label: `Yoshi ${DRIVER_RULES.minAge} dan katta`,
      detail: `${age} yosh`,
    },
    {
      ok: d.licence.issuedOn <= today && experience >= DRIVER_RULES.minExperienceYears,
      label: `Staji ${DRIVER_RULES.minExperienceYears} yildan ko‘p`,
      detail: `${experience} yil`,
    },
    {
      ok: d.licence.categories.includes('B'),
      label: 'B toifali guvohnoma',
      detail: d.licence.categories.join(', '),
    },
    {
      ok: d.licenceCard.expiresOn >= today,
      label: 'Litsenziya kartochkasi amal qiladi',
      detail: `${d.licenceCard.expiresOn} gacha`,
    },
    {
      ok: d.licenceCard.verification === 'valid',
      label: 'Litsenziya kartochkasi reyestrda tasdiqlangan',
      detail: LICENCE_STATUS[d.licenceCard.verification],
    },
  ];
  const v = d.vehicle;
  if (!v) {
    checks.push({ ok: false, label: 'Avtomobil ma’lumotlari' });
  } else {
    checks.push(
      { ok: !isVanType(v.make, v.model), label: 'Furgon emas (Damas/Labo mumkin emas)' },
      {
        ok: v.year <= year + 1 && year - v.year <= DRIVER_RULES.maxVehicleAgeYears,
        label: `Avtomobil ${DRIVER_RULES.maxVehicleAgeYears} yildan eski emas`,
        detail: `${v.year} yil`,
      },
      {
        ok: v.seats >= 1 && v.seats <= DRIVER_RULES.maxSeats,
        label: `Yo‘lovchi o‘rindiqlari ${DRIVER_RULES.maxSeats} tadan ko‘p emas`,
        detail: `${v.seats} ta`,
      },
    );
    if (v.class === 'comfort') {
      checks.push(
        {
          ok: year - v.year <= DRIVER_RULES.maxComfortAgeYears,
          label: `Komfort: avtomobil ${DRIVER_RULES.maxComfortAgeYears} yildan eski emas`,
        },
        { ok: v.features.includes('ac'), label: 'Komfort: konditsioner bor' },
      );
    }
  }
  checks.push({
    ok: d.missingDocuments.length === 0,
    label: 'Barcha hujjatlar yuklangan',
    detail: d.missingDocuments.length
      ? `Yetishmaydi: ${d.missingDocuments.map((k) => DOCUMENTS[k]).join(', ')}`
      : `${DOCUMENT_KINDS.length} ta`,
  });
  const expired = d.documents.filter((doc) => doc.expiresOn && doc.expiresOn < today);
  checks.push({
    ok: expired.length === 0,
    label: 'Hujjatlar muddati o‘tmagan',
    detail: expired.length ? expired.map((doc) => DOCUMENTS[doc.kind]).join(', ') : undefined,
  });
  return checks;
}

/** A licence card or document that runs out soon deserves a warning (market analysis O3). */
export function expiryState(expiresOn: string | null, today: string): 'ok' | 'soon' | 'expired' {
  if (!expiresOn) return 'ok';
  const days = daysBetween(today, expiresOn);
  if (days < 0) return 'expired';
  return days <= 30 ? 'soon' : 'ok';
}

/** Whether a document URL can be shown as a picture (PDFs and others open in a new tab). */
export function isImageUrl(url: string): boolean {
  return !/\.pdf(\?|#|$)/i.test(url);
}

/** Whether a file is a picture: by its upload's type when known, else by the URL. */
export function isImageFile(contentType: string | null | undefined, url: string | null): boolean {
  if (contentType) return contentType.startsWith('image/');
  return url !== null && isImageUrl(url);
}

/** Why the API refused an approval (422 with one issue per unmet rule), as lines to show. */
export function approvalProblems(body: unknown): string[] {
  const issues = (body as { issues?: { message?: unknown }[] } | null)?.issues;
  if (!Array.isArray(issues)) return [];
  return [
    ...new Set(issues.map((i) => i.message).filter((m): m is string => typeof m === 'string')),
  ];
}
