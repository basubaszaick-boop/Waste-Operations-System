import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { WasteApiService } from '../services/waste-api.service';
import { ActivityService } from './activity.service';
import { AppUser, AuthService } from './auth.service';
import { ActivityEntry, AppNotification, Concern, ConcernStatus, Schedule, Status } from './models';
import { SessionService } from './session.service';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Today as YYYY-MM-DD in the local time zone (schedule dates are stored the same way). */
export function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Shared data and actions used by the page components.
 * Values that change after an async call are signals so the screen refreshes.
 */
@Injectable({ providedIn: 'root' })
export class WasteStore {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly api = inject(WasteApiService);
  private readonly session = inject(SessionService);
  private readonly auth = inject(AuthService);
  private readonly activity = inject(ActivityService);

  // SIGNALS (updated asynchronously)
  readonly schedules = signal<Schedule[]>([]);
  readonly schedulesLoading = signal(false);
  readonly concerns = signal<Concern[]>([]);
  readonly users = signal<AppUser[]>([]);
  readonly recentActivity = signal<ActivityEntry[]>([]);
  readonly notice = signal('');
  /** Drivers: show only their own team's collections on Collection Records. */
  readonly teamOnly = signal(true);

  // PLAIN FIELDS (changed only by user events)
  searchText = '';
  showScheduleForm = false;
  editingId: string | null = null;
  scheduleForm: Schedule = this.emptySchedule();

  showConcernForm = false;
  concernForm = { resident: '', area: '', subject: '', details: '' };

  /** Called when the user moves to another page. */
  resetPageState(): void {
    this.searchText = '';
    this.showScheduleForm = false;
    this.showConcernForm = false;
    this.notice.set('');
  }

  /** Forget everything from the previous person when someone signs out. */
  clearData(): void {
    this.schedules.set([]);
    this.concerns.set([]);
    this.users.set([]);
    this.recentActivity.set([]);
    this.teamOnly.set(true);
  }

  private emptySchedule(): Schedule {
    return { id: '', area: '', date: '', time: '07:00', team: 'Team Alpha', status: 'Scheduled' };
  }

  private get me(): AppUser | null {
    return this.session.user();
  }

  private log(action: string, detail = ''): void {
    void this.activity.log(this.me, action, detail);
  }

  // ---------- LOADING ----------

  /** Loads everything the signed-in role is allowed to see. */
  loadAll(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadSchedules();
    this.loadConcerns();
    this.loadUsers();
    this.loadActivity();
  }

  loadSchedules(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.schedulesLoading.set(true);
    this.api.list<Schedule>('schedules').subscribe({
      next: (data) => {
        this.schedules.set(data);
        this.schedulesLoading.set(false);
      },
      error: (error) => {
        console.error('Schedule loading error:', error);
        this.schedulesLoading.set(false);
        this.notice.set('Unable to load schedules. Check your internet connection or access permissions.');
      }
    });
  }

  loadConcerns(): void {
    const u = this.me;
    if (u?.role !== 'barangay_head') return;   // resident concerns belong to Barangay Heads only
    this.api.listWhere<Concern>('concerns', 'area', u.barangay).subscribe({
      next: (data) => this.concerns.set(data),
      error: (error) => {
        console.error('Concern loading error:', error);
        this.notice.set('Unable to load resident concerns. Publish the latest firestore.rules.');
      }
    });
  }

  loadUsers(): void {
    if (this.me?.role !== 'admin') return;
    this.auth.listUsers().then(list => this.users.set(list)).catch(e => console.error('User loading error:', e));
  }

  loadActivity(): void {
    if (this.me?.role !== 'admin') return;
    this.activity.all(8).then(list => this.recentActivity.set(list)).catch(e => console.error('Activity loading error:', e));
  }

  // ---------- ROLE-BASED VIEWS ----------

  /** Only administrators may add, edit or delete schedules (matches firestore.rules). */
  get canManageSchedules(): boolean {
    return this.me?.role === 'admin';
  }

  get isDriver(): boolean {
    return this.me?.role === 'driver';
  }

  /** Barangay Heads only see their own barangay. */
  get visibleSchedules(): Schedule[] {
    const u = this.me;
    const all = this.schedules();
    return u?.role === 'barangay_head' ? all.filter(s => same(s.area, u.barangay)) : all;
  }

  get visibleConcerns(): Concern[] {
    return this.concerns();
  }

  /** Drivers: the collections assigned to their team (the team is set by the administrator). */
  get myTeamSchedules(): Schedule[] {
    const team = this.me?.team ?? '';
    return team ? this.schedules().filter(s => same(s.team, team)) : [];
  }

  /** Schedules this person is responsible for: their team (driver) or everything they may see. */
  get mySchedules(): Schedule[] {
    return this.isDriver ? this.myTeamSchedules : this.visibleSchedules;
  }

  // ---------- FILTERS ----------

  get filteredSchedules(): Schedule[] {
    const q = this.searchText.toLowerCase().trim();
    return this.visibleSchedules.filter(s =>
      [s.area, s.date, s.time, s.team, s.status]
        .some(v => String(v).toLowerCase().includes(q))
    );
  }

  /** Collection Records page: same as schedules, but drivers can narrow it to their own team. */
  get filteredRecords(): Schedule[] {
    const base = this.isDriver && this.teamOnly() ? this.myTeamSchedules : this.visibleSchedules;
    const q = this.searchText.toLowerCase().trim();
    return base.filter(s => [s.area, s.date, s.time, s.team, s.status].some(v => String(v).toLowerCase().includes(q)));
  }

  get filteredConcerns(): Concern[] {
    const q = this.searchText.toLowerCase().trim();
    return this.visibleConcerns.filter(c =>
      [c.resident, c.area, c.subject, c.status].some(v => v.toLowerCase().includes(q))
    );
  }

  // ---------- DASHBOARD NUMBERS ----------

  get completedCount(): number {
    return this.visibleSchedules.filter(s => s.status === 'Completed').length;
  }
  get pendingCount(): number {
    return this.visibleSchedules.filter(s => s.status === 'Scheduled').length;
  }
  get inProgressCount(): number {
    return this.visibleSchedules.filter(s => s.status === 'In Progress').length;
  }
  get resolvedConcerns(): number {
    return this.visibleConcerns.filter(c => c.status === 'Resolved').length;
  }
  get pendingConcerns(): number {
    return this.visibleConcerns.filter(c => c.status !== 'Resolved').length;
  }
  get openConcerns(): Concern[] {
    return this.visibleConcerns.filter(c => c.status !== 'Resolved');
  }

  private byDateTime = (a: Schedule, b: Schedule) => (a.date + a.time).localeCompare(b.date + b.time);

  /** Today's collections for whatever `list` is passed in. */
  todayOf(list: Schedule[]): Schedule[] {
    const t = todayIso();
    return list.filter(s => s.date === t).sort(this.byDateTime);
  }

  /** Collections after today that are not finished or cancelled. */
  upcomingOf(list: Schedule[]): Schedule[] {
    const t = todayIso();
    return list.filter(s => s.date > t && s.status !== 'Completed' && s.status !== 'Cancelled').sort(this.byDateTime);
  }

  /** Date is in the past but the collection was never completed or cancelled. */
  overdueOf(list: Schedule[]): Schedule[] {
    const t = todayIso();
    return list.filter(s => s.date < t && (s.status === 'Scheduled' || s.status === 'In Progress')).sort(this.byDateTime);
  }

  /** The next collection (today or later) that is still to be done. */
  nextOf(list: Schedule[]): Schedule | undefined {
    const t = todayIso();
    return list.filter(s => s.date >= t && (s.status === 'Scheduled' || s.status === 'In Progress')).sort(this.byDateTime)[0];
  }

  /** Whole days from today until the given YYYY-MM-DD date (0 = today, negative = past). */
  daysUntil(date: string): number {
    const [y, m, d] = date.split('-').map(Number);
    const target = new Date(y, (m || 1) - 1, d || 1).getTime();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((target - today) / 86400000);
  }

  /** "7:00 AM" from "07:00". */
  time12(t: string): string {
    const [h, m] = (t || '').split(':').map(Number);
    if (isNaN(h)) return t;
    return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }

  /** Per-team totals for the admin dashboard. */
  get teamWorkload(): { team: string; total: number; completed: number; active: number }[] {
    const map = new Map<string, { team: string; total: number; completed: number; active: number }>();
    for (const s of this.schedules()) {
      const key = s.team.trim() || 'Unassigned';
      const row = map.get(key) ?? { team: key, total: 0, completed: 0, active: 0 };
      row.total++;
      if (s.status === 'Completed') row.completed++;
      if (s.status === 'In Progress') row.active++;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  get todayLabel(): string {
    return new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ---------- NOTIFICATIONS (built from live data, filtered by the person's preferences) ----------

  get notifications(): AppNotification[] {
    const u = this.me;
    if (!u) return [];
    const p = u.prefs;
    const list = this.mySchedules;
    const t = todayIso();
    const soon = todayIso(3);
    const where = (s: Schedule) => (this.isDriver ? s.area : `${s.area} (${s.team})`);
    const link = this.isDriver ? '/records' : '/schedules';
    const out: AppNotification[] = [];

    if (p.notifyToday) {
      for (const s of this.todayOf(list).filter(x => x.status !== 'Cancelled')) {
        out.push({
          kind: 'today', date: s.date, link,
          title: s.status === 'Completed' ? 'Collection completed today' : 'Collection today',
          message: `${where(s)} at ${this.time12(s.time)} - ${s.status}.`
        });
      }
      for (const s of this.overdueOf(list)) {
        out.push({
          kind: 'today', date: s.date, link,
          title: 'Overdue collection',
          message: `${where(s)} was planned for ${s.date} and is still ${s.status.toLowerCase()}.`
        });
      }
    }
    if (p.notifyUpcoming) {
      for (const s of this.upcomingOf(list).filter(x => x.date <= soon)) {
        out.push({
          kind: 'upcoming', date: s.date, link,
          title: 'Upcoming collection',
          message: `${where(s)} on ${s.date} at ${this.time12(s.time)}.`
        });
      }
    }
    if (p.notifyCancelled) {
      for (const s of list.filter(x => x.status === 'Cancelled' && x.date >= t)) {
        out.push({
          kind: 'cancelled', date: s.date, link,
          title: 'Collection cancelled',
          message: `${where(s)} on ${s.date} was cancelled.`
        });
      }
    }
    if (p.notifyConcerns && u.role === 'barangay_head') {
      for (const c of this.openConcerns) {
        out.push({
          kind: 'concern', date: c.createdAt.slice(0, 10), link: '/concerns',
          title: c.status === 'Pending' ? 'New resident concern' : 'Concern under review',
          message: `${c.subject} - ${c.area} (${c.resident}).`
        });
      }
    }
    return out;
  }

  // ---------- SCHEDULE ACTIONS ----------

  openAddSchedule(): void {
    this.editingId = null;
    this.scheduleForm = this.emptySchedule();
    this.showScheduleForm = true;
    this.notice.set('');
  }

  editSchedule(schedule: Schedule): void {
    this.editingId = schedule.id;
    this.scheduleForm = { ...schedule };
    this.showScheduleForm = true;
    this.notice.set('');
  }

  saveSchedule(): void {
    const form = this.scheduleForm;
    if (!form.area.trim() || !form.date || !form.time || !form.team.trim()) {
      this.notice.set('Please complete all required fields.');
      return;
    }

    if (this.editingId !== null) {
      const id = this.editingId;
      this.api.update<Schedule>('schedules', { ...form, id }).subscribe({
        next: (updated) => {
          this.schedules.update(list => list.map(s => (s.id === id ? updated : s)));
          this.showScheduleForm = false;
          this.editingId = null;
          this.scheduleForm = this.emptySchedule();
          this.notice.set('Schedule updated successfully.');
          this.log('Edited a schedule', `${updated.area} - ${updated.date}`);
        },
        error: (error) => {
          console.error('Update error:', error);
          this.notice.set('Failed to update schedule.');
        }
      });
    } else {
      const newSchedule: Schedule = { ...form, id: String(Date.now()) };
      this.api.create<Schedule>('schedules', newSchedule).subscribe({
        next: (created) => {
          this.schedules.update(list => [created, ...list]);
          this.showScheduleForm = false;
          this.scheduleForm = this.emptySchedule();
          this.notice.set('New schedule added successfully.');
          this.log('Added a schedule', `${created.area} - ${created.date}`);
        },
        error: (error) => {
          console.error('Create error:', error);
          this.notice.set('Failed to add schedule.');
        }
      });
    }
  }

  deleteSchedule(schedule: Schedule): void {
    if (!confirm(`Delete the schedule for ${schedule.area}?`)) return;
    this.api.remove('schedules', schedule.id).subscribe({
      next: () => {
        this.schedules.update(list => list.filter(s => s.id !== schedule.id));
        this.notice.set('Schedule deleted successfully.');
        this.log('Deleted a schedule', `${schedule.area} - ${schedule.date}`);
      },
      error: (error) => {
        console.error('Delete error:', error);
        this.notice.set('Failed to delete schedule.');
      }
    });
  }

  changeScheduleStatus(schedule: Schedule, status: Status): void {
    this.api.update<Schedule>('schedules', { ...schedule, status }).subscribe({
      next: (updated) => {
        this.schedules.update(list => list.map(s => (s.id === updated.id ? updated : s)));
        this.notice.set(`${updated.area}: marked ${status.toLowerCase()}.`);
        this.log('Updated collection status', `${updated.area} - ${schedule.status} to ${status}`);
      },
      error: (error) => {
        console.error('Status update error:', error);
        this.notice.set('Failed to update collection status.');
      }
    });
  }

  // ---------- CONCERN ACTIONS (Firestore collection: concerns) ----------

  openConcernForm(): void {
    const u = this.me;
    this.concernForm = { resident: '', area: u?.role === 'barangay_head' ? u.barangay : '', subject: '', details: '' };
    this.showConcernForm = true;
    this.notice.set('');
  }

  saveConcern(): void {
    const f = this.concernForm;
    const u = this.me;
    if (!u) return;
    const area = u.role === 'barangay_head' ? u.barangay : f.area.trim();
    if (!f.resident.trim() || !area || !f.subject.trim()) {
      this.notice.set('Please enter the resident, area and subject.');
      return;
    }
    const concern: Concern = {
      id: String(Date.now()),
      resident: f.resident.trim(),
      area,
      subject: f.subject.trim(),
      details: f.details.trim(),
      status: 'Pending',
      createdBy: u.email,
      createdAt: new Date().toISOString()
    };
    this.api.create<Concern>('concerns', concern).subscribe({
      next: (created) => {
        this.concerns.update(list => [created, ...list]);
        this.showConcernForm = false;
        this.notice.set('Resident concern recorded.');
        this.log('Recorded a resident concern', `${created.subject} - ${created.area}`);
      },
      error: (error) => {
        console.error('Concern create error:', error);
        this.notice.set('Failed to save the concern. Publish the latest firestore.rules.');
      }
    });
  }

  changeConcernStatus(concern: Concern, status: ConcernStatus): void {
    this.api.update<Concern>('concerns', { ...concern, status }).subscribe({
      next: (updated) => {
        this.concerns.update(list => list.map(c => (c.id === updated.id ? updated : c)));
        this.notice.set('Resident concern updated.');
        this.log('Updated a resident concern', `${concern.subject} - ${status}`);
      },
      error: (error) => {
        console.error('Concern update error:', error);
        this.notice.set('Failed to update the concern.');
      }
    });
  }

  // ---------- EXPORT SCHEDULES (CSV) ----------

  exportSchedules(): void {
    const header = ['Area', 'Date', 'Time', 'Team', 'Status'];
    const rows = this.filteredSchedules.map(s => [s.area, s.date, s.time, s.team, s.status]);
    this.downloadCsv('waste-collection-schedules.csv', [header, ...rows]);
  }

  /** Saves a table of values as a CSV file that opens in Excel. */
  downloadCsv(filename: string, table: string[][]): void {
    const csv = table
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
