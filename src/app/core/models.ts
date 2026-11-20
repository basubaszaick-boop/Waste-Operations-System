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
  /** 'sms' = arrived automatically from the SMS gateway; 'manual' = typed in by the Barangay Head. Older records have no value (= manual). */
  source?: 'sms' | 'manual';
  senderPhone?: string;       // 09XXXXXXXXX
  verified?: boolean;         // sender matched a registered resident (or was verified by the head)
  receivedAt?: string;        // when the SMS reached the gateway phone
  ackStatus?: string;         // automatic confirmation SMS: pending | sent | failed | skipped-rate-limit
  gatewayDeviceId?: string;
}

/** A gateway phone that texted the system but is not linked to a Barangay Head yet (admin sees these). */
export interface SmsDevice {
  id: string;
  deviceId: string;
  lastSeen: string;
  count: number;
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
  id: string;        // stable key: the same reminder keeps the same id, so "read" survives a refresh
  at: string;        // ISO-like date-time the notification is about
  kind: 'today' | 'upcoming' | 'cancelled' | 'concern';
  title: string;
  message: string;
  date: string;
  link: string;
}
