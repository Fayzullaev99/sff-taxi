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

/**
 * The generated validation messages, as templates: the exception filter renders them in
 * the request's language by shape (src/core/i18n), so each has a catalog entry.
 */
export const VALIDATION_MESSAGES = {
  required: 'Majburiy maydon',
  type: 'Noto‘g‘ri qiymat turi',
  minLength: 'Kamida {0} ta belgi',
  minItems: 'Kamida {0} ta element',
  min: 'Kamida {0}',
  maxLength: 'Ko‘pi bilan {0} ta belgi',
  maxItems: 'Ko‘pi bilan {0} ta element',
  max: 'Ko‘pi bilan {0}',
  format: 'Noto‘g‘ri format',
  value: 'Ruxsat etilmagan qiymat',
  multiple: 'Noto‘g‘ri qiymat',
  unknownKey: 'Noma’lum maydon',
} as const;

const fill = (template: string, value: unknown) => template.replace('{0}', String(value));

/** Validation messages in Uzbek, for every schema in the API. */
export function useUzbekValidationMessages(): void {
  const M = VALIDATION_MESSAGES;
  z.config({
    customError: (issue) => {
      switch (issue.code) {
        case 'invalid_type':
          return issue.input === undefined ? M.required : M.type;
        case 'too_small':
          if (issue.origin === 'string') return fill(M.minLength, issue.minimum);
          if (issue.origin === 'array') return fill(M.minItems, issue.minimum);
          return fill(M.min, issue.minimum);
        case 'too_big':
          if (issue.origin === 'string') return fill(M.maxLength, issue.maximum);
          if (issue.origin === 'array') return fill(M.maxItems, issue.maximum);
          return fill(M.max, issue.maximum);
        case 'invalid_format':
          return M.format;
        case 'invalid_value':
          return M.value;
        case 'not_multiple_of':
          return M.multiple;
        case 'unrecognized_keys':
          return M.unknownKey;
        default:
          return undefined; // custom messages from .refine() stay as written
      }
    },
  });
}
