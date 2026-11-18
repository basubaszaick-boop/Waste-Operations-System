import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { WasteStore } from '../../core/waste.store';
import { SessionService } from '../../core/session.service';
import { Concern, Schedule } from '../../core/models';

interface Attention { icon: string; tone: 'red' | 'orange' | 'blue' | 'green'; title: string; text: string; link: string; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent {
  readonly store = inject(WasteStore);
  readonly session = inject(SessionService);
  private readonly router = inject(Router);

  go(path: string): void {
    this.router.navigateByUrl('/' + path);
  }

  goLink(link: string): void {
    this.router.navigateByUrl(link);
  }

  /** Open the schedules page, then open the "add schedule" form. */
  addSchedule(): void {
    this.router.navigateByUrl('/schedules').then(() => this.store.openAddSchedule());
  }

  reportConcern(): void {
    this.router.navigateByUrl('/concerns').then(() => this.store.openConcernForm());
  }

  /** Open the schedules page already searched for one team / area. */
  openSchedulesFor(text: string): void {
    this.router.navigateByUrl('/schedules').then(() => (this.store.searchText = text));
  }

  get greeting(): string {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  // ---------- shared ----------
  get visible(): Schedule[] { return this.store.visibleSchedules; }
  get todays(): Schedule[] { return this.store.todayOf(this.visible); }
  get percentDone(): number {
    const n = this.visible.length;
    return n ? Math.round((this.store.completedCount / n) * 100) : 0;
  }

  // ---------- admin ----------
  get overdueCount(): number { return this.store.overdueOf(this.store.schedules()).length; }
  get activeAccounts(): number { return this.store.users().filter(u => u.active).length; }

  /** Things the administrator should look at, each one a link. */
  get attention(): Attention[] {
    const s = this.store;
    const out: Attention[] = [];
    const overdue = s.overdueOf(s.schedules());
    if (overdue.length)
      out.push({ icon: '⚠', tone: 'red', title: `${overdue.length} overdue collection${overdue.length > 1 ? 's' : ''}`,
        text: `${overdue[0].area} (${overdue[0].date}) is still ${overdue[0].status.toLowerCase()}.`, link: '/records' });
    const notStarted = this.todays.filter(x => x.status === 'Scheduled');
    if (notStarted.length)
      out.push({ icon: '◷', tone: 'orange', title: `${notStarted.length} collection${notStarted.length > 1 ? 's' : ''} today not started`,
        text: notStarted.map(x => x.area).slice(0, 3).join(', '), link: '/records' });
    const noTeam = s.users().filter(u => u.role === 'driver' && u.active && !u.team);
    if (noTeam.length)
      out.push({ icon: '♙', tone: 'blue', title: `${noTeam.length} driver${noTeam.length > 1 ? 's' : ''} without a team`,
        text: `${noTeam[0].name || noTeam[0].email} cannot see team collections yet.`, link: '/personnel' });
    return out;
  }

  // ---------- driver ----------
  get team(): string { return this.session.user()?.team ?? ''; }
  get myAll(): Schedule[] { return this.store.myTeamSchedules; }
  get myToday(): Schedule[] { return this.store.todayOf(this.myAll); }
  get myUpcoming(): Schedule[] { return this.store.upcomingOf(this.myAll); }
  get myOverdue(): Schedule[] { return this.store.overdueOf(this.myAll); }
  get myDoneToday(): number { return this.myToday.filter(s => s.status === 'Completed').length; }
  get myActive(): number { return this.myAll.filter(s => s.status === 'In Progress').length; }

  browseAll(): void {
    this.store.teamOnly.set(false);
    this.go('records');
  }

  // ---------- barangay head ----------
  get next(): Schedule | undefined { return this.store.nextOf(this.visible); }
  get nextWhen(): string {
    const n = this.next;
    if (!n) return '';
    const d = this.store.daysUntil(n.date);
    return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : `In ${d} days`;
  }
  get headUpcoming(): Schedule[] { return this.store.upcomingOf(this.visible).slice(0, 5); }
  get headConcerns(): Concern[] { return this.store.openConcerns.slice(0, 4); }
}
