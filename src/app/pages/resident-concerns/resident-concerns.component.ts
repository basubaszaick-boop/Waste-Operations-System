import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WasteStore } from '../../core/waste.store';
import { SessionService } from '../../core/session.service';
import { ConcernStatus } from '../../core/models';

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
  expanded: string | null = null;

  toggle(id: string): void {
    this.expanded = this.expanded === id ? null : id;
  }
}
