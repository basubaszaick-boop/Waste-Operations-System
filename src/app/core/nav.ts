import { Role } from './auth.service';

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  subtitle: string;
  roles: Role[];
  /** Still a valid page (title, route, access) but not listed in the sidebar. */
  hidden?: boolean;
}

const ALL: Role[] = ['admin', 'driver', 'barangay_head'];

/** Single source of truth for the sidebar, page titles and route access. */
export const NAV: NavItem[] = [
  { label: 'Dashboard', path: 'dashboard', icon: '▦', roles: ALL,
    subtitle: "Monitor and manage the municipality's waste collection operations." },
  { label: 'Collection Schedules', path: 'schedules', icon: '▤', roles: ALL,
    subtitle: 'Plan collection activities, assign teams, and manage schedules.' },
  { label: 'Personnel', path: 'personnel', icon: '♙', roles: ['admin'],
    subtitle: 'Manage staff accounts, roles and team assignments.' },
  { label: 'Collection Records', path: 'records', icon: '✓', roles: ['admin', 'driver'],
    subtitle: 'Monitor collection progress and update operational status.' },
  { label: 'Resident Concerns', path: 'concerns', icon: '☏', roles: ['barangay_head'],
    subtitle: 'Record resident reports and follow them up.' },
  { label: 'Notifications', path: 'notifications', icon: '♧', roles: ALL, hidden: true,
    subtitle: 'Live reminders built from your schedules.' },
  { label: 'Reports', path: 'reports', icon: '▥', roles: ['admin'],
    subtitle: 'Review collection summaries and export data.' },
  { label: 'Activity Log', path: 'activity', icon: '☰', roles: ['admin'],
    subtitle: 'See who did what in the system.' },
  { label: 'Profile & Settings', path: 'profile', icon: '☺', roles: ALL,
    subtitle: 'Your personal information, security, notifications and account details in one place.' }
];

export const rolesFor = (path: string): Role[] =>
  NAV.find(n => n.path === path)?.roles ?? [];
