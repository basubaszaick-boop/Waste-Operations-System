import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AppNotification } from '../../core/models';
import { WasteStore } from '../../core/waste.store';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notifications.component.html'
})
export class NotificationsComponent {
  readonly store = inject(WasteStore);
  private readonly router = inject(Router);

  readonly labels: Record<string, string> = {
    today: 'Today', upcoming: 'Upcoming', cancelled: 'Cancelled', concern: 'Resident concern'
  };

  openOne(n: AppNotification): void {
    this.store.markRead(n);
    this.open(n.link);
  }

  open(link: string): void {
    this.router.navigateByUrl(link);
  }
}
