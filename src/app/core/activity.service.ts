import { Injectable } from '@angular/core';
import { addDoc, collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { ActivityEntry } from './models';
import { AppUser } from './auth.service';

/** Activity log kept in the Firestore collection "audit". Logging never blocks or breaks the app. */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  /** Writes one line to the log. Errors are ignored on purpose. */
  async log(user: AppUser | null, action: string, detail = ''): Promise<void> {
    if (!user) return;
    try {
      await addDoc(collection(db, 'audit'), {
        user: user.email,
        name: user.name || user.email,
        role: user.role,
        action,
        detail: detail.slice(0, 200),
        time: new Date().toISOString()
      });
    } catch (e) {
      console.warn('Activity log skipped:', e);
    }
  }

  /** The signed-in person's own recent activity (newest first). */
  async mine(email: string, max = 30): Promise<ActivityEntry[]> {
    const snap = await getDocs(query(collection(db, 'audit'), where('user', '==', email), limit(200)));
    return this.sorted(snap.docs.map(d => ({ ...(d.data() as ActivityEntry), id: d.id }))).slice(0, max);
  }

  /** Everyone's activity (admin only). */
  async all(max = 200): Promise<ActivityEntry[]> {
    const snap = await getDocs(query(collection(db, 'audit'), orderBy('time', 'desc'), limit(max)));
    return this.sorted(snap.docs.map(d => ({ ...(d.data() as ActivityEntry), id: d.id })));
  }

  private sorted(list: ActivityEntry[]): ActivityEntry[] {
    return list.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  }
}
