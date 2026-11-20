import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivityService } from '../../core/activity.service';
import { AppUser, AuthService, Role } from '../../core/auth.service';
import { SessionService } from '../../core/session.service';
import { friendlyError } from '../../core/auth-errors';
import { normalizePH } from '../../core/phone';
import { WasteStore } from '../../core/waste.store';

type RoleFilter = 'all' | Role;

@Component({
  selector: 'app-personnel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './personnel.component.html'
})
export class PersonnelComponent {
  readonly store = inject(WasteStore);
  readonly session = inject(SessionService);
  private readonly auth = inject(AuthService);
  private readonly activity = inject(ActivityService);

  readonly query = signal('');
  readonly roleFilter = signal<RoleFilter>('all');
  readonly message = signal<{ text: string; ok: boolean } | null>(null);

  readonly filters: { id: RoleFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'admin', label: 'Admins' },
    { id: 'driver', label: 'Drivers' },
    { id: 'barangay_head', label: 'Barangay Heads' }
  ];

  countOf(f: RoleFilter): number {
    const list = this.store.users();
    return f === 'all' ? list.length : list.filter(u => u.role === f).length;
  }

  readonly shown = computed(() => {
    const q = this.query().toLowerCase().trim();
    const r = this.roleFilter();
    return this.store.users().filter(u =>
      (r === 'all' || u.role === r) &&
      (!q || [u.name, u.email, u.phone, u.barangay, u.team].some(v => v.toLowerCase().includes(q)))
    );
  });

  /** Team names already used in schedules, offered as suggestions when assigning a driver. */
  get teamNames(): string[] {
    return [...new Set(this.store.schedules().map(s => s.team.trim()).filter(Boolean))].sort();
  }

  roleLabel(r: Role): string {
    return r === 'admin' ? 'Admin' : r === 'driver' ? 'Driver' : 'Barangay Head';
  }

  initialsOf(u: AppUser): string {
    return (u.name || u.email || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  isMe(u: AppUser): boolean {
    return u.uid === this.session.user()?.uid;
  }

  // ---------- manage an account ----------
  editing: AppUser | null = null;
  editForm = { name: '', role: 'driver' as Role, barangay: '', team: '', active: true, phone: '', smsNumber: '', smsDeviceId: '' };
  readonly editBusy = signal(false);
  readonly editError = signal('');

  openEdit(u: AppUser): void {
    this.editing = u;
    this.editForm = { name: u.name, role: u.role, barangay: u.barangay, team: u.team, active: u.active, phone: u.phone, smsNumber: u.smsNumber, smsDeviceId: u.smsDeviceId };
    this.editError.set('');
  }

  async saveEdit(): Promise<void> {
    const u = this.editing;
    if (!u) return;
    const f = this.editForm;
    if (f.name.trim().length < 2) return this.editError.set('Please enter the full name.');
    if (f.role === 'barangay_head') {
      const problem = this.checkSms(f, u.uid);
      if (problem) return this.editError.set(problem);
    }
    this.editBusy.set(true);
    this.editError.set('');
    try {
      const patch: Record<string, unknown> = {
        name: f.name.trim(),
        barangay: f.role === 'barangay_head' ? f.barangay.trim() : '',
        team: f.role === 'driver' ? f.team.trim() : ''
      };
      if (f.role === 'barangay_head') {
        patch['phone'] = normalizePH(f.phone);
        patch['smsNumber'] = normalizePH(f.smsNumber);
        patch['smsDeviceId'] = f.smsDeviceId.trim();
      }
      if (!this.isMe(u)) {
        patch['role'] = f.role;
        patch['active'] = f.active;
      }
      await this.auth.updateUser(this.session.user(), u.uid, patch);
      void this.activity.log(this.session.user(), 'Updated an account', `${f.name.trim()} (${this.roleLabel(f.role)})`);
      if (f.role === 'barangay_head' && f.smsDeviceId.trim()) this.store.forgetSmsDevice(f.smsDeviceId.trim());
      this.editing = null;
      this.store.loadUsers();
      this.message.set({ ok: true, text: `Saved changes for ${f.name.trim()}.` });
    } catch (e) {
      this.editError.set(friendlyError(e));
    } finally {
      this.editBusy.set(false);
    }
  }

  /** Checks the SMS fields of a Barangay Head. Returns an error text, or '' when everything is fine. */
  private checkSms(f: { phone: string; smsNumber: string; smsDeviceId: string; barangay: string }, selfUid: string): string {
    if (!f.barangay.trim()) return 'A Barangay Head must be assigned to a barangay.';
    if (f.phone.trim() && !normalizePH(f.phone)) return 'The official cellphone number must look like 09171234567.';
    if (f.smsNumber.trim() && !normalizePH(f.smsNumber)) return 'The SMS receiving number must look like 09171234567.';
    const others = this.store.users().filter(x => x.uid !== selfUid && x.role === 'barangay_head' && x.active);
    const device = f.smsDeviceId.trim();
    if (device && others.some(x => x.smsDeviceId === device))
      return 'That gateway phone is already linked to another Barangay Head.';
    const num = normalizePH(f.smsNumber);
    if (num && others.some(x => x.smsNumber === num))
      return 'That SMS receiving number is already used by another Barangay Head.';
    return '';
  }

  /** Quick pick: fill the gateway device id from a phone the system has already seen. */
  useDevice(deviceId: string, target: 'edit' | 'new'): void {
    if (target === 'edit') { this.editForm.smsDeviceId = deviceId; this.editError.set(''); }
    else { this.staffForm.smsDeviceId = deviceId; this.staffMessage.set(''); }
  }

  /** One-click activate / deactivate from the table. */
  async toggleActive(u: AppUser): Promise<void> {
    if (this.isMe(u)) return;
    const next = !u.active;
    if (!confirm(`${next ? 'Reactivate' : 'Deactivate'} the account of ${u.name || u.email}?`)) return;
    try {
      await this.auth.updateUser(this.session.user(), u.uid, { active: next });
      void this.activity.log(this.session.user(), next ? 'Reactivated an account' : 'Deactivated an account', u.name || u.email);
      this.store.loadUsers();
      this.message.set({ ok: true, text: `${u.name || u.email} is now ${next ? 'active' : 'deactivated'}.` });
    } catch (e) {
      this.message.set({ ok: false, text: friendlyError(e) });
    }
  }

  // ---------- create a staff account ----------
  showAdd = false;
  staffForm = { name: '', email: '', password: '', role: 'driver' as Role, barangay: '', team: '', phone: '', smsNumber: '', smsDeviceId: '' };
  readonly staffBusy = signal(false);
  readonly staffMessage = signal('');
  readonly staffError = signal(false);

  async createStaffAccount(): Promise<void> {
    this.staffMessage.set('');
    if (this.staffForm.role === 'barangay_head') {
      const problem = this.checkSms(this.staffForm, '');
      if (problem) { this.staffError.set(true); this.staffMessage.set(problem); return; }
    }
    this.staffBusy.set(true);
    try {
      await this.auth.createStaff(this.session.user(), {
        ...this.staffForm, phone: normalizePH(this.staffForm.phone), smsNumber: normalizePH(this.staffForm.smsNumber)
      });
      if (this.staffForm.role === 'barangay_head' && this.staffForm.smsDeviceId.trim()) this.store.forgetSmsDevice(this.staffForm.smsDeviceId.trim());
      this.staffError.set(false);
      this.staffMessage.set('Account created for ' + this.staffForm.email.trim() + '.');
      void this.activity.log(this.session.user(), 'Created an account', `${this.staffForm.name.trim()} (${this.roleLabel(this.staffForm.role)})`);
      this.staffForm = { name: '', email: '', password: '', role: 'driver', barangay: '', team: '', phone: '', smsNumber: '', smsDeviceId: '' };
      this.store.loadUsers();
    } catch (e: any) {
      this.staffError.set(true);
      this.staffMessage.set(friendlyError(e));
    } finally {
      this.staffBusy.set(false);
    }
  }
}
