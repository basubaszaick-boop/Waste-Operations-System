import { isPlatformBrowser, CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AppNotification } from '../../core/models';
import { NAV, NavItem } from '../../core/nav';
import { SessionService } from '../../core/session.service';
import { WasteStore, todayIso } from '../../core/waste.store';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './shell.component.html'
})
export class ShellComponent implements OnInit {
  readonly session = inject(SessionService);
  readonly store = inject(WasteStore);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** Sidebar only lists the pages this role may open. */
  readonly nav = computed(() => NAV.filter(n => !n.hidden && this.session.canAccess(n.roles)));
  readonly current = signal<NavItem | undefined>(undefined);

  // ----- notification bell -----
  readonly bellOpen = signal(false);
  readonly onlyUnread = signal(false);
  readonly icons: Record<string, string> = { today: '♻', upcoming: '▦', cancelled: '✕', concern: '☏' };

  /** Newest first, optionally only the unread ones; the dropdown shows the 15 most recent. */
  shown(): AppNotification[] {
    const list = [...this.store.notifications].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    return (this.onlyUnread() ? list.filter(n => !this.store.isRead(n)) : list).slice(0, 15);
  }

  trackN = (_: number, n: AppNotification) => n.id;

  toggleBell(e: Event): void {
    e.stopPropagation();
    this.bellOpen.update(v => !v);
  }

  openNotif(n: AppNotification): void {
    this.store.markRead(n);
    this.bellOpen.set(false);
    this.router.navigateByUrl(n.link);
  }

  seeAll(): void { this.bellOpen.set(false); this.go('notifications'); }
  prefs(): void { this.bellOpen.set(false); this.router.navigateByUrl('/profile#notifications'); }

  /** "Today, 8:00 AM" / "Tomorrow, 7:00 AM" / "Nov 21, 7:00 AM". */
  when(at: string): string {
    const d = new Date(at);
    if (isNaN(d.getTime())) return at;
    const day = at.slice(0, 10);
    const label = day === todayIso() ? 'Today' : day === todayIso(1) ? 'Tomorrow' : day === todayIso(-1) ? 'Yesterday'
      : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    return at.length > 10 ? `${label}, ${d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}` : label;
  }

  @HostListener('document:click') closeBell(): void { this.bellOpen.set(false); }
  @HostListener('document:keydown.escape') escBell(): void { this.bellOpen.set(false); }

  constructor() {
    this.updateCurrent(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(e => {
        this.updateCurrent(e.urlAfterRedirects);
        this.store.resetPageState();
        this.bellOpen.set(false);
      });
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) this.store.loadAll();
  }

  private updateCurrent(url: string): void {
    const path = url.split('?')[0].split('#')[0].replace(/^\//, '').split('/')[0];
    this.current.set(NAV.find(n => n.path === path));
  }

  go(path: string): void {
    this.router.navigateByUrl('/' + path);
  }

  async logout(): Promise<void> {
    await this.session.logout();
    this.store.clearData();
    this.store.resetPageState();
    await this.router.navigateByUrl('/login');
  }
}
