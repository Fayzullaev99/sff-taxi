import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

/** Who is calling, re-read from the database on every request. */
export interface AuthUser {
  userId: string;
  phone: string;
  fullName: string | null;
  isAdmin: boolean;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'auth:public';
export const ADMIN_ONLY = 'auth:admin';

/** Opts a route out of authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Platform operators only. */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user;
});

/** The signed-in user on a @Public() route, or undefined. */
export const OptionalUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return { ip: req.ip ?? null, userAgent: req.get('user-agent')?.slice(0, 500) ?? null };
});
