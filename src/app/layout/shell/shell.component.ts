import { isPlatformBrowser, CommonModule } from '@angular/common';
import { Component, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { NAV, NavItem } from '../../core/nav';
import { SessionService } from '../../core/session.service';
import { WasteStore } from '../../core/waste.store';

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
  readonly nav = computed(() => NAV.filter(n => this.session.canAccess(n.roles)));
  readonly current = signal<NavItem | undefined>(undefined);

  constructor() {
    this.updateCurrent(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(e => {
        this.updateCurrent(e.urlAfterRedirects);
        this.store.resetPageState();
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
