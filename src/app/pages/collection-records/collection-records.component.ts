import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WasteStore } from '../../core/waste.store';
import { SessionService } from '../../core/session.service';

@Component({
  selector: 'app-collection-records',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './collection-records.component.html'
})
export class CollectionRecordsComponent {
  readonly store = inject(WasteStore);
  readonly session = inject(SessionService);
}
