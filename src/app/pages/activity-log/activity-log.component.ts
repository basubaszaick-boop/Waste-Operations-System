import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivityService } from '../../core/activity.service';
import { friendlyError } from '../../core/auth-errors';
import { ActivityEntry } from '../../core/models';
import { WasteStore } from '../../core/waste.store';

@Component({
  selector: 'app-activity-log',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [DatePipe],
  templateUrl: './activity-log.component.html'
})
export class ActivityLogComponent implements OnInit {
  private readonly activity = inject(ActivityService);
  private readonly store = inject(WasteStore);
  private readonly date = inject(DatePipe);

  readonly entries = signal<ActivityEntry[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly query = signal('');
  readonly role = signal<'all' | 'admin' | 'driver' | 'barangay_head'>('all');
  readonly roles: { id: 'all' | 'admin' | 'driver' | 'barangay_head'; label: string }[] = [
    { id: 'all', label: 'Everyone' },
    { id: 'admin', label: 'Admins' },
    { id: 'driver', label: 'Drivers' },
    { id: 'barangay_head', label: 'Barangay Heads' }
  ];

  readonly shown = computed(() => {
    const q = this.query().toLowerCase().trim();
    const r = this.role();
    return this.entries().filter(e =>
      (r === 'all' || e.role === r) &&
      (!q || [e.name, e.user, e.action, e.detail].some(v => String(v).toLowerCase().includes(q)))
    );
  });

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.entries.set(await this.activity.all(300));
    } catch (e) {
      this.error.set(friendlyError(e));
    } finally {
      this.loading.set(false);
    }
  }

  roleLabel(r: string): string {
    return r === 'barangay_head' ? 'Barangay Head' : r === 'driver' ? 'Driver' : 'Admin';
  }

  exportCsv(): void {
    const rows = this.shown().map(e => [
      this.date.transform(e.time, 'yyyy-MM-dd HH:mm') ?? e.time, e.name, e.user, this.roleLabel(e.role), e.action, e.detail
    ]);
    this.store.downloadCsv('activity-log.csv', [['Time', 'Name', 'Email', 'Role', 'Action', 'Detail'], ...rows]);
  }
}
