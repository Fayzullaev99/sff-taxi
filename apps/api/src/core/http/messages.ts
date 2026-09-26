import { z } from 'zod';

/**
 * User-facing error text. Messages are written in Uzbek (the product's source
 * language); a message with values carries its template and parameters, so
 * the client can show it in the user's language with the values in the right
 * place: `{ message: "3 ta buyurtma ochiq…", key: "{0} ta buyurtma ochiq…", params: [3] }`.
 */
export function msg(template: string, ...params: (string | number)[]) {
  const message = template.replace(/\{(\d+)\}/g, (m, i: string) =>
    Number(i) < params.length ? String(params[Number(i)]) : m,
  );
  return { message, key: template, params };
}

/** Validation messages in Uzbek, for every schema in the API. */
export function useUzbekValidationMessages(): void {
  z.config({
    customError: (issue) => {
      switch (issue.code) {
        case 'invalid_type':
          return issue.input === undefined ? 'Majburiy maydon' : 'Noto‘g‘ri qiymat turi';
        case 'too_small':
          if (issue.origin === 'string') return `Kamida ${issue.minimum} ta belgi`;
          if (issue.origin === 'array') return `Kamida ${issue.minimum} ta element`;
          return `Kamida ${issue.minimum}`;
        case 'too_big':
          if (issue.origin === 'string') return `Ko‘pi bilan ${issue.maximum} ta belgi`;
          if (issue.origin === 'array') return `Ko‘pi bilan ${issue.maximum} ta element`;
          return `Ko‘pi bilan ${issue.maximum}`;
        case 'invalid_format':
          return 'Noto‘g‘ri format';
        case 'invalid_value':
          return 'Ruxsat etilmagan qiymat';
        case 'not_multiple_of':
          return 'Noto‘g‘ri qiymat';
        case 'unrecognized_keys':
          return 'Noma’lum maydon';
        default:
          return undefined; // custom messages from .refine() stay as written
      }
    },
  });
}
