import { type AdminDriver, DOCUMENT_KINDS } from '../api/types';
import { CLASSES, daysBetween, DOCUMENTS, fullYears, LICENCE_STATUS } from './format';

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
  minMinivanSeats: 6,
  maxMinivanSeats: 7,
  maxMinivanAgeYears: 8,
  maxBusinessAgeYears: 3,
  minBusinessRating: 4.8,
} as const;

/** The API's premium models for Biznes (apps/api/src/lib/driver-rules.ts isBusinessModel). */
export function isBusinessModel(make: string, model: string): boolean {
  return (
    /\b(mercedes|benz|bmw|lexus|audi|genesis|volvo|zeekr|lixiang|li auto)\b/i.test(make) ||
    /\b(malibu|tracker|tahoe|traverse|equinox|k5|k8|k9|sonata|grandeur|santa ?fe|palisade|sorento|camry|han|seal|tang|song plus|tiggo 8|exeed|hongqi)\b/i.test(
      `${make} ${model}`,
    )
  );
}

/** Age and AC rules per class beyond economy. */
const CLASS_AGE = {
  comfort: DRIVER_RULES.maxComfortAgeYears,
  minivan: DRIVER_RULES.maxMinivanAgeYears,
  business: DRIVER_RULES.maxBusinessAgeYears,
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
      v.class === 'minivan'
        ? {
            ok: v.seats >= DRIVER_RULES.minMinivanSeats && v.seats <= DRIVER_RULES.maxMinivanSeats,
            label: `Miniven: ${DRIVER_RULES.minMinivanSeats}–${DRIVER_RULES.maxMinivanSeats} yo‘lovchi o‘rindig‘i`,
            detail: `${v.seats} ta`,
          }
        : {
            ok: v.seats >= 1 && v.seats <= DRIVER_RULES.maxSeats,
            label: `Yo‘lovchi o‘rindiqlari ${DRIVER_RULES.maxSeats} tadan ko‘p emas`,
            detail: `${v.seats} ta`,
          },
    );
    if (v.class !== 'economy' && v.service !== 'cargo') {
      const name = CLASSES[v.class];
      const maxAge = CLASS_AGE[v.class];
      checks.push(
        {
          ok: year - v.year <= maxAge,
          label: `${name}: avtomobil ${maxAge} yildan eski emas`,
        },
        { ok: v.features.includes('ac'), label: `${name}: konditsioner bor` },
      );
    }
    if (v.class === 'business' && v.service !== 'cargo') {
      checks.push(
        {
          ok: isBusinessModel(v.make, v.model),
          label: 'Biznes: premium model (Malibu, Tracker Premier, K5, Sonata…)',
          detail: `${v.make} ${v.model}`,
        },
        {
          ok: d.priority.stars >= DRIVER_RULES.minBusinessRating,
          label: `Biznes: reyting kamida ${DRIVER_RULES.minBusinessRating}`,
          detail: String(d.priority.stars),
        },
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
