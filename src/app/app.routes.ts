import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/guards';
import { rolesFor } from './core/nav';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in | Villanueva Waste Operations',
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent)
  },

  {
    // Everything below needs a signed-in user with a valid role.
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell/shell.component').then(m => m.ShellComponent),
    children: [
      {
        path: 'dashboard', canActivate: [roleGuard], data: { roles: rolesFor('dashboard') },
        loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'schedules', canActivate: [roleGuard], data: { roles: rolesFor('schedules') },
        loadComponent: () => import('./pages/collection-schedules/collection-schedules.component').then(m => m.CollectionSchedulesComponent)
      },
      {
        path: 'personnel', canActivate: [roleGuard], data: { roles: rolesFor('personnel') },
        loadComponent: () => import('./pages/personnel/personnel.component').then(m => m.PersonnelComponent)
      },
      {
        path: 'records', canActivate: [roleGuard], data: { roles: rolesFor('records') },
        loadComponent: () => import('./pages/collection-records/collection-records.component').then(m => m.CollectionRecordsComponent)
      },
      {
        path: 'concerns', canActivate: [roleGuard], data: { roles: rolesFor('concerns') },
        loadComponent: () => import('./pages/resident-concerns/resident-concerns.component').then(m => m.ResidentConcernsComponent)
      },
      {
        path: 'notifications', canActivate: [roleGuard], data: { roles: rolesFor('notifications') },
        loadComponent: () => import('./pages/notifications/notifications.component').then(m => m.NotificationsComponent)
      },
      {
        path: 'reports', canActivate: [roleGuard], data: { roles: rolesFor('reports') },
        loadComponent: () => import('./pages/reports/reports.component').then(m => m.ReportsComponent)
      },
      {
        path: 'activity', canActivate: [roleGuard], data: { roles: rolesFor('activity') },
        loadComponent: () => import('./pages/activity-log/activity-log.component').then(m => m.ActivityLogComponent)
      },
      {
        path: 'profile', canActivate: [roleGuard], data: { roles: rolesFor('profile') },
        loadComponent: () => import('./pages/profile/profile.component').then(m => m.ProfileComponent)
      },
      {
        path: 'settings', canActivate: [roleGuard], data: { roles: rolesFor('settings') },
        loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent)
      }
    ]
  },

  { path: '**', redirectTo: 'dashboard' }
];
