import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Concern, ConcernStatus } from '../../core/models';
import { SessionService } from '../../core/session.service';
import { WasteStore } from '../../core/waste.store';

type Filter = 'all' | 'sms' | 'manual' | 'unverified';

@Component({
  selector: 'app-resident-concerns',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './resident-concerns.component.html'
})
export class ResidentConcernsComponent {
  readonly store = inject(WasteStore);
  readonly session = inject(SessionService);
  readonly statuses: ConcernStatus[] = ['Pending', 'In Review', 'Resolved'];

  readonly filter = signal<Filter>('all');
  readonly filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'sms', label: 'SMS' },
    { id: 'manual', label: 'Manual' },
    { id: 'unverified', label: 'Unverified senders' }
  ];

  expanded: string | null = null;
  verifyForm = { name: '', purok: '', consent: false };
  readonly verifyError = signal('');
  readonly verifyBusy = signal(false);

  isSms(c: Concern): boolean { return c.source === 'sms'; }
  isUnverified(c: Concern): boolean { return this.isSms(c) && c.verified === false; }

  matches(c: Concern, f: Filter): boolean {
    return f === 'all' || (f === 'sms' && this.isSms(c)) || (f === 'manual' && !this.isSms(c)) || (f === 'unverified' && this.isUnverified(c));
  }

  countOf(f: Filter): number {
    return this.store.visibleConcerns.filter(c => this.matches(c, f)).length;
  }

  /** Rows after the search box and the SMS / Manual / Unverified chips. (A getter, so typing in the search box refreshes it.) */
  get shown(): Concern[] {
    return this.store.filteredConcerns.filter(c => this.matches(c, this.filter()));
  }

  received(c: Concern): string {
    return c.receivedAt || c.createdAt;
  }

  toggle(c: Concern): void {
    this.expanded = this.expanded === c.id ? null : c.id;
    this.verifyForm = { name: '', purok: '', consent: false };
    this.verifyError.set('');
  }

  ackText(c: Concern): string {
    switch (c.ackStatus) {
      case 'sent': return 'Confirmation SMS sent to the resident.';
      case 'failed': return 'The confirmation SMS could not be sent (check your Semaphore credits).';
      case 'skipped-rate-limit': return 'No confirmation sent: this number texted many times in the last hour.';
      case 'pending': return 'Confirmation SMS is being sent...';
      default: return '';
    }
  }

  async verify(c: Concern): Promise<void> {
    this.verifyBusy.set(true);
    const f = this.verifyForm;
    const error = await this.store.verifySender(c, f.name, f.purok, f.consent);
    this.verifyError.set(error);
    this.verifyBusy.set(false);
  }
}
