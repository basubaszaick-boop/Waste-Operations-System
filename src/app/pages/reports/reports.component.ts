import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WasteStore } from '../../core/waste.store';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reports.component.html'
})
export class ReportsComponent {
  readonly store = inject(WasteStore);

  /** Totals per collection area, for the breakdown table. */
  get byArea(): { area: string; total: number; completed: number; inProgress: number; scheduled: number; cancelled: number; rate: number }[] {
    const map = new Map<string, { area: string; total: number; completed: number; inProgress: number; scheduled: number; cancelled: number; rate: number }>();
    for (const s of this.store.visibleSchedules) {
      const key = s.area.trim();
      const r = map.get(key) ?? { area: key, total: 0, completed: 0, inProgress: 0, scheduled: 0, cancelled: 0, rate: 0 };
      r.total++;
      if (s.status === 'Completed') r.completed++;
      else if (s.status === 'In Progress') r.inProgress++;
      else if (s.status === 'Cancelled') r.cancelled++;
      else r.scheduled++;
      map.set(key, r);
    }
    return [...map.values()]
      .map(r => ({ ...r, rate: r.total ? Math.round((r.completed / r.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);
  }

  exportAreas(): void {
    const rows = this.byArea.map(r => [r.area, String(r.total), String(r.completed), String(r.inProgress), String(r.scheduled), String(r.cancelled), r.rate + '%']);
    this.store.downloadCsv('collection-summary-by-area.csv', [['Area', 'Total', 'Completed', 'In Progress', 'Scheduled', 'Cancelled', 'Completion rate'], ...rows]);
  }
}
