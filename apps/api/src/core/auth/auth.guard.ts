import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Database } from '../db/database.js';
import { applySavedLanguage, currentLanguage, requestNamedLanguage } from '../i18n/language.js';
import { ADMIN_ONLY, type AuthenticatedRequest, type AuthUser, IS_PUBLIC } from './auth-context.js';
import { TokenService } from './tokens.js';

/**
 * Global guard. Every route needs a valid access token unless marked @Public();
 * a public route still gets the user when a valid token is sent. The user's
 * status and operator rights are re-read on each request, so blocking someone
 * takes effect at once rather than when their token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = req.get('authorization')?.split(' ') ?? [];

    const user = scheme === 'Bearer' && token ? await this.resolve(token) : null;
    if (isPublic) {
      if (user) req.user = user;
      return true;
    }
    if (!user) throw new UnauthorizedException();
    req.user = user;
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, targets) && !user.isAdmin) {
      throw new ForbiddenException('Faqat platforma operatorlari uchun');
    }
    return true;
  }

  private async resolve(token: string): Promise<AuthUser | null> {
    const userId = await this.tokens.verifyAccess(token);
    if (!userId) return null;
    const row = await this.db.kysely
      .selectFrom('users as u')
      .leftJoin('admins as a', 'a.user_id', 'u.id')
      .select(['u.id', 'u.phone', 'u.full_name', 'u.status', 'u.locale', 'a.user_id as adminId'])
      .where('u.id', '=', userId)
      .executeTakeFirst();
    if (!row || row.status !== 'active') return null;
    // the app's language travels with every request: remember it when it changes, so SMS
    // and push sent later (with no request to read) come in the same language; an old app
    // that names none gets the language last remembered for the account
    let locale = row.locale;
    if (requestNamedLanguage()) {
      const asked = currentLanguage();
      if (asked !== locale) {
        await this.db.kysely
          .updateTable('users')
          .set({ locale: asked })
          .where('id', '=', row.id)
          .execute();
        locale = asked;
      }
    } else {
      applySavedLanguage(locale);
    }
    return {
      userId: row.id,
      phone: row.phone,
      fullName: row.full_name,
      isAdmin: row.adminId !== null,
      locale,
    };
  }
}
