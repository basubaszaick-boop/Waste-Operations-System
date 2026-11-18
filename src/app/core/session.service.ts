import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AppUser, AuthService, Role, SelfEditable } from './auth.service';
import { ActivityService } from './activity.service';

/** Holds the signed-in user (from Firebase Auth + Firestore users/{uid}). */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly auth = inject(AuthService);
  private readonly activity = inject(ActivityService);
  readonly user = signal<AppUser | null>(null);
  private readonly readyPromise: Promise<void>;

  readonly isAdmin = computed(() => this.user()?.role === 'admin');

  readonly roleLabel = computed(() => {
    const u = this.user();
    switch (u?.role) {
      case 'admin': return 'Administrator';
      case 'driver': return 'Driver';
      case 'barangay_head': return 'Barangay Head \u2022 ' + u.barangay;
      default: return '';
    }
  });

  readonly initials = computed(() => {
    const u = this.user();
    const n = u?.name?.trim() || u?.email || '?';
    return n.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  });

  /** CSS background for the avatar when the person has a photo. */
  readonly photoStyle = computed(() => {
    const p = this.user()?.photo;
    return p ? `url("${p}")` : null;
  });

  readonly firstName = computed(() => {
    const u = this.user();
    const n = u?.name?.trim() || u?.email?.split('@')[0] || '';
    return n.split(/\s+/)[0];
  });

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      // Resolves once Firebase has told us whether someone is signed in.
      this.readyPromise = new Promise<void>(resolve => {
        this.auth.watch(u => {
          this.user.set(u);
          resolve();
        });
      });
    } else {
      this.readyPromise = Promise.resolve();
    }
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  canAccess(roles: Role[]): boolean {
    const u = this.user();
    return !!u && roles.includes(u.role);
  }

  async login(email: string, password: string): Promise<AppUser> {
    const u = await this.auth.login(email, password);
    this.user.set(u);
    void this.activity.log(u, 'Signed in');
    void this.syncEmail(u);
    return u;
  }

  /** Older accounts have no e-mail stored in their profile; save it once so the admin can see it. */
  private async syncEmail(u: AppUser): Promise<void> {
    try {
      const fresh = await this.auth.saveOwnProfile(u.uid, { email: u.email });
      this.user.set(fresh);
    } catch { /* not critical */ }
  }

  /** Saves the person's own profile and refreshes the signed-in user everywhere. */
  async saveProfile(patch: SelfEditable): Promise<void> {
    const u = this.user();
    if (!u) throw new Error('Not signed in.');
    const fresh = await this.auth.saveOwnProfile(u.uid, patch);
    this.user.set(fresh);
  }

  changePassword(current: string, next: string): Promise<void> {
    return this.auth.changePassword(current, next);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    this.user.set(null);
  }
}
