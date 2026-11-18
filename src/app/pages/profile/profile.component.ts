import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ActivityService } from '../../core/activity.service';
import { Prefs } from '../../core/auth.service';
import { friendlyError } from '../../core/auth-errors';
import { ActivityEntry } from '../../core/models';
import { SessionService } from '../../core/session.service';
import { WasteStore } from '../../core/waste.store';

type Tab = 'info' | 'security' | 'prefs' | 'activity';
interface Msg { text: string; ok: boolean; }

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html'
})
export class ProfileComponent implements OnInit {
  readonly session = inject(SessionService);
  readonly store = inject(WasteStore);
  private readonly activity = inject(ActivityService);
  private readonly router = inject(Router);

  readonly tab = signal<Tab>('info');
  readonly tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'info', label: 'Personal Info', icon: '☺' },
    { id: 'security', label: 'Security', icon: '🔒' },
    { id: 'prefs', label: 'Preferences', icon: '⚙' },
    { id: 'activity', label: 'My Activity', icon: '☰' }
  ];

  // ----- personal info -----
  form = { name: '', phone: '', address: '', bio: '', position: '', vehicle: '' };
  readonly infoBusy = signal(false);
  readonly infoMsg = signal<Msg | null>(null);

  // ----- photo -----
  readonly photoBusy = signal(false);
  readonly photoMsg = signal<Msg | null>(null);

  /** Show a photo message, then let it fade away after a few seconds. */
  private flashPhoto(m: Msg): void {
    this.photoMsg.set(m);
    setTimeout(() => this.photoMsg.set(null), 4000);
  }

  // ----- password -----
  pw = { current: '', next: '', confirm: '' };
  readonly showPw = signal(false);
  readonly pwBusy = signal(false);
  readonly pwMsg = signal<Msg | null>(null);

  // ----- preferences -----
  readonly prefMsg = signal<Msg | null>(null);
  readonly prefList: { key: keyof Prefs; title: string; text: string; roles: string[] }[] = [
    { key: 'notifyToday', title: "Today's collections", text: "Show today's collections and overdue ones.", roles: ['admin', 'driver', 'barangay_head'] },
    { key: 'notifyUpcoming', title: 'Upcoming collections', text: 'Show collections planned in the next 3 days.', roles: ['admin', 'driver', 'barangay_head'] },
    { key: 'notifyCancelled', title: 'Cancelled collections', text: 'Show collections that were cancelled.', roles: ['admin', 'driver', 'barangay_head'] },
    { key: 'notifyConcerns', title: 'Resident concerns', text: 'Show concerns that are not yet resolved.', roles: ['barangay_head'] }
  ];

  // ----- activity -----
  readonly entries = signal<ActivityEntry[]>([]);
  readonly entriesLoading = signal(false);
  readonly entriesError = signal('');

  readonly user = this.session.user;
  readonly roleName = computed(() => {
    switch (this.user()?.role) {
      case 'admin': return 'Administrator';
      case 'driver': return 'Driver';
      default: return 'Barangay Head';
    }
  });

  /** Three small numbers on the profile card; each one is a link to the page behind it. */
  readonly highlights = computed(() => {
    const u = this.user();
    if (!u) return [];
    const s = this.store;
    if (u.role === 'admin') {
      return [
        { label: 'Schedules', value: s.schedules().length, link: '/schedules' },
        { label: 'Accounts', value: s.users().length, link: '/personnel' },
        { label: 'Today', value: s.todayOf(s.schedules()).length, link: '/records' }
      ];
    }
    if (u.role === 'driver') {
      const mine = s.myTeamSchedules;
      return [
        { label: 'Today', value: s.todayOf(mine).length, link: '/dashboard' },
        { label: 'Upcoming', value: s.upcomingOf(mine).length, link: '/records' },
        { label: 'Completed', value: mine.filter(x => x.status === 'Completed').length, link: '/records' }
      ];
    }
    return [
      { label: 'Upcoming', value: s.upcomingOf(s.visibleSchedules).length, link: '/schedules' },
      { label: 'Open concerns', value: s.pendingConcerns, link: '/concerns' },
      { label: 'Completed', value: s.completedCount, link: '/schedules' }
    ];
  });

  readonly strength = computed(() => {
    const p = this.pwValue();
    let score = 0;
    if (p.length >= 8) score++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
    if (/\d/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    if (p.length < 6) score = Math.min(score, 1);
    return score;
  });
  readonly strengthLabel = computed(() => (this.pwValue() ? ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][this.strength()] : ''));
  private readonly pwValue = signal('');

  ngOnInit(): void {
    this.resetForm();
  }

  private resetForm(): void {
    const u = this.user();
    if (!u) return;
    this.form = { name: u.name, phone: u.phone, address: u.address, bio: u.bio, position: u.position, vehicle: u.vehicle };
    this.infoMsg.set(null);
  }

  setTab(t: Tab): void {
    this.tab.set(t);
    if (t === 'activity' && this.entries().length === 0) this.loadActivity();
  }

  go(path: string): void {
    this.router.navigateByUrl(path);
  }

  // ---------- personal info ----------
  get dirty(): boolean {
    const u = this.user();
    if (!u) return false;
    const f = this.form;
    return f.name !== u.name || f.phone !== u.phone || f.address !== u.address || f.bio !== u.bio
      || f.position !== u.position || f.vehicle !== u.vehicle;
  }

  async saveInfo(): Promise<void> {
    const f = this.form;
    const name = f.name.trim();
    const phone = f.phone.trim();
    if (name.length < 2) return this.infoMsg.set({ ok: false, text: 'Please enter your full name.' });
    if (phone && !/^09\d{9}$/.test(phone))
      return this.infoMsg.set({ ok: false, text: 'Mobile number must look like 09171234567.' });

    this.infoBusy.set(true);
    try {
      const patch: Record<string, string> = {
        name, phone, address: f.address.trim(), bio: f.bio.trim(), position: f.position.trim()
      };
      if (this.user()?.role === 'driver') patch['vehicle'] = f.vehicle.trim().toUpperCase();
      await this.session.saveProfile(patch);
      this.resetForm();
      this.infoMsg.set({ ok: true, text: 'Profile saved.' });
      void this.activity.log(this.user(), 'Updated profile details');
    } catch (e) {
      this.infoMsg.set({ ok: false, text: friendlyError(e) });
    } finally {
      this.infoBusy.set(false);
    }
  }

  // ---------- photo ----------
  async onPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return this.flashPhoto({ ok: false, text: 'Please choose an image file (JPG or PNG).' });
    if (file.size > 8 * 1024 * 1024) return this.flashPhoto({ ok: false, text: 'That image is too large. Choose one under 8 MB.' });
    this.photoBusy.set(true);
    try {
      const dataUrl = await this.squareThumbnail(file, 192);
      await this.session.saveProfile({ photo: dataUrl });
      this.flashPhoto({ ok: true, text: 'Profile photo updated.' });
      void this.activity.log(this.user(), 'Changed profile photo');
    } catch (e) {
      this.flashPhoto({ ok: false, text: friendlyError(e) });
    } finally {
      this.photoBusy.set(false);
    }
  }

  async removePhoto(): Promise<void> {
    this.photoBusy.set(true);
    try {
      await this.session.saveProfile({ photo: '' });
      this.flashPhoto({ ok: true, text: 'Profile photo removed.' });
      void this.activity.log(this.user(), 'Removed profile photo');
    } catch (e) {
      this.flashPhoto({ ok: false, text: friendlyError(e) });
    } finally {
      this.photoBusy.set(false);
    }
  }

  /** Crops the picture to a centred square and shrinks it so it is small enough to store in Firestore. */
  private squareThumbnail(file: File, size: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); return reject(new Error('Could not process the image.')); }
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
      img.src = url;
    });
  }

  // ---------- password ----------
  onNewPassword(v: string): void {
    this.pw.next = v;
    this.pwValue.set(v);
  }

  async changePassword(): Promise<void> {
    const { current, next, confirm } = this.pw;
    if (!current) return this.pwMsg.set({ ok: false, text: 'Enter your current password.' });
    if (next.length < 6) return this.pwMsg.set({ ok: false, text: 'New password must be at least 6 characters.' });
    if (next !== confirm) return this.pwMsg.set({ ok: false, text: 'The new passwords do not match.' });
    if (next === current) return this.pwMsg.set({ ok: false, text: 'Choose a password different from the current one.' });

    this.pwBusy.set(true);
    try {
      await this.session.changePassword(current, next);
      this.pw = { current: '', next: '', confirm: '' };
      this.pwValue.set('');
      this.pwMsg.set({ ok: true, text: 'Password changed. Use the new password next time you sign in.' });
      void this.activity.log(this.user(), 'Changed password');
    } catch (e) {
      this.pwMsg.set({ ok: false, text: friendlyError(e) });
    } finally {
      this.pwBusy.set(false);
    }
  }

  async signOut(): Promise<void> {
    await this.session.logout();
    this.store.clearData();
    await this.router.navigateByUrl('/login');
  }

  // ---------- preferences ----------
  prefsFor(): typeof this.prefList {
    const role = this.user()?.role ?? 'driver';
    return this.prefList.filter(p => p.roles.includes(role));
  }

  async togglePref(key: keyof Prefs, value: boolean): Promise<void> {
    const u = this.user();
    if (!u) return;
    try {
      await this.session.saveProfile({ prefs: { ...u.prefs, [key]: value } });
      this.prefMsg.set({ ok: true, text: 'Preference saved. Your notifications are updated.' });
    } catch (e) {
      this.prefMsg.set({ ok: false, text: friendlyError(e) });
    }
  }

  // ---------- activity ----------
  async loadActivity(): Promise<void> {
    const u = this.user();
    if (!u) return;
    this.entriesLoading.set(true);
    this.entriesError.set('');
    try {
      this.entries.set(await this.activity.mine(u.email));
    } catch (e) {
      this.entriesError.set(friendlyError(e));
    } finally {
      this.entriesLoading.set(false);
    }
  }
}
