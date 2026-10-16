import type { NextFunction, Request, Response } from 'express';
import { parseAcceptLanguage, runWithLanguage } from './language.js';

/**
 * Puts the request's language in scope for everything that handles it (guards, services,
 * the exception filter), read from `Accept-Language`. The apps send `uz` or `ru` on every
 * request; the operator panel sends `uz`; anything else means Uzbek, the default.
 */
export function languageMiddleware(req: Request, _res: Response, next: NextFunction): void {
  runWithLanguage(parseAcceptLanguage(req.headers['accept-language']), next);
}
