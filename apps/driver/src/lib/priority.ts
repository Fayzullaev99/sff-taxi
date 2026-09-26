/**
 * The priority score (0-100) explained to the driver: the API computes it
 * (apps/api src/lib/priority.ts) and sends its parts; this turns them into points, plain
 * words and the one thing that would raise it most. Fairness is the promise: the score
 * only breaks ties between drivers whose road ETAs are within a minute of the best; the
 * nearest driver otherwise always gets the offer.
 */

export const WEIGHTS = { acceptance: 0.4, reliability: 0.3, rating: 0.3 } as const;
export type PartKey = keyof typeof WEIGHTS;

export interface PriorityParts {
  score: number;
  /** 0..1 */
  acceptance: number;
  /** 0..1 */
  reliability: number;
  /** 0..1 (stars mapped from 1..5) */
  rating: number;
  stars: number;
}

export interface PartView {
  key: PartKey;
  title: string;
  /** e.g. "82%" or "4.8 ★" */
  value: string;
  /** Points this part adds to the score, and the most it could. */
  points: number;
  maxPoints: number;
  explain: string;
  improve: string;
}

const TEXT: Record<PartKey, { title: string; explain: string; improve: string }> = {
  acceptance: {
    title: 'Qabul qilish',
    explain:
      'Sizga kelgan takliflarning qanchasini qabul qildingiz. Rad etish va 15 soniyada javob bermaslik uni pasaytiradi.',
    improve:
      'Liniyada bo‘lganingizda takliflarni qabul qiling; dam olmoqchi bo‘lsangiz liniyadan chiqing.',
  },
  reliability: {
    title: 'Ishonchlilik',
    explain:
      'Qabul qilgan buyurtmani oxirigacha bajarish. Qabul qilib bekor qilish uni pasaytiradi (yo‘lovchi chiqmagan holat bundan mustasno).',
    improve: 'Bajara olmaydigan buyurtmani qabul qilmang — rad etish bekor qilishdan yaxshiroq.',
  },
  rating: {
    title: 'Yo‘lovchilar bahosi',
    explain: 'Yo‘lovchilar qo‘ygan yulduzlar o‘rtachasi.',
    improve: 'Toza salon, xushmuomalalik, xavfsiz haydash va tez yetib kelish bahoni oshiradi.',
  },
};

const percent = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The parts with whole points that add up to the API's score (largest remainders get the
 * rounding), so the screen's arithmetic always checks out.
 */
export function priorityParts(p: PriorityParts): PartView[] {
  const keys = Object.keys(WEIGHTS) as PartKey[];
  const raw = keys.map((k) => WEIGHTS[k] * p[k] * 100);
  const points = raw.map(Math.floor);
  let left = Math.max(0, Math.min(keys.length, p.score - points.reduce((s, x) => s + x, 0)));
  const byRemainder = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r) }))
    .sort((a, b) => b.rem - a.rem);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    points[i]! += 1;
    left--;
  }
  return keys.map((key, i) => ({
    key,
    ...TEXT[key],
    value: key === 'rating' ? `${p.stars.toFixed(1)} ★` : percent(p[key]),
    points: Math.min(points[i]!, Math.round(WEIGHTS[key] * 100)),
    maxPoints: Math.round(WEIGHTS[key] * 100),
  }));
}

/** The part with the most points left to gain: what to work on first. */
export function biggestGain(p: PriorityParts): PartView | null {
  const parts = priorityParts(p)
    .map((x) => ({ x, gap: x.maxPoints - WEIGHTS[x.key] * p[x.key] * 100 }))
    .sort((a, b) => b.gap - a.gap);
  const top = parts[0];
  return top && top.gap >= 1 ? top.x : null;
}

export type ScoreLevel = 'high' | 'good' | 'low';

export function scoreLevel(score: number): { level: ScoreLevel; label: string } {
  if (score >= 85) return { level: 'high', label: 'A’lo' };
  if (score >= 65) return { level: 'good', label: 'Yaxshi' };
  return { level: 'low', label: 'Past' };
}
