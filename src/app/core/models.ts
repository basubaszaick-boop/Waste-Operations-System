export type Status = 'Scheduled' | 'In Progress' | 'Completed' | 'Cancelled';

export interface Schedule {
  id: string;
  area: string;
  date: string;
  time: string;
  team: string;
  status: Status;
}

export type ConcernStatus = 'Pending' | 'In Review' | 'Resolved';

export interface Concern {
  id: string;
  resident: string;
  area: string;
  subject: string;
  details: string;
  status: ConcernStatus;
  createdBy: string;
  createdAt: string;
}

/** One line of the activity log (Firestore collection: audit). */
export interface ActivityEntry {
  id?: string;
  user: string;      // e-mail of the person who did it
  name: string;
  role: string;
  action: string;
  detail: string;
  time: string;      // ISO date-time
}

/** A notification built from live schedule / concern data. */
export interface AppNotification {
  kind: 'today' | 'upcoming' | 'cancelled' | 'concern';
  title: string;
  message: string;
  date: string;
  link: string;
}
