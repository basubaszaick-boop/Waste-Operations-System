import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WasteStore } from '../../core/waste.store';

@Component({
  selector: 'app-collection-schedules',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './collection-schedules.component.html'
})
export class CollectionSchedulesComponent {
  readonly store = inject(WasteStore);
}
