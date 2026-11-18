import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { Role } from './auth.service';
import { SessionService } from './session.service';

const onServer = () => !isPlatformBrowser(inject(PLATFORM_ID));

/** Must be signed in (and have a valid role document). */
export const authGuard: CanActivateFn = async () => {
  if (onServer()) return true;
  const session = inject(SessionService);
  const router = inject(Router);
  await session.whenReady();
  return session.user() ? true : router.parseUrl('/login');
};

/** Login page is only for people who are not signed in. */
export const guestGuard: CanActivateFn = async () => {
  if (onServer()) return true;
  const session = inject(SessionService);
  const router = inject(Router);
  await session.whenReady();
  return session.user() ? router.parseUrl('/dashboard') : true;
};

/** Page is only for the roles listed in route.data['roles']. */
export const roleGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  if (onServer()) return true;
  const session = inject(SessionService);
  const router = inject(Router);
  await session.whenReady();
  if (!session.user()) return router.parseUrl('/login');
  const roles = (route.data['roles'] ?? []) as Role[];
  return session.canAccess(roles) ? true : router.parseUrl('/dashboard');
};
