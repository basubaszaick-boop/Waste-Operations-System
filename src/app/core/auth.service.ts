import { Injectable } from '@angular/core';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  User
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, firebaseConfig } from './firebase';

export type Role = 'admin' | 'driver' | 'barangay_head';

/** Which in-app notifications the person wants to see. */
export interface Prefs {
  notifyToday: boolean;
  notifyUpcoming: boolean;
  notifyCancelled: boolean;
  notifyConcerns: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  notifyToday: true,
  notifyUpcoming: true,
  notifyCancelled: true,
  notifyConcerns: true
};

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  role: Role;
  barangay: string;
  phone: string;
  address: string;
  bio: string;
  position: string;   // office (admin) or barangay position (head)
  vehicle: string;    // drivers: plate number
  team: string;       // drivers: team assigned by the admin
  photo: string;      // small JPEG data URL
  active: boolean;
  createdAt: string;
  lastSignIn: string;
  prefs: Prefs;
}

/** Fields a person may change on their own profile (must match firestore.rules). */
export type SelfEditable = Partial<Pick<AppUser, 'name' | 'phone' | 'address' | 'bio' | 'position' | 'vehicle' | 'photo' | 'email' | 'prefs'>>;

/** Fields an administrator may change on someone else's account. */
export type AdminEditable = Partial<Pick<AppUser, 'name' | 'role' | 'barangay' | 'team' | 'active' | 'position' | 'phone'>>;

const ROLES: Role[] = ['admin', 'driver', 'barangay_head'];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Firestore Timestamp | string | undefined -> ISO string ('' if unknown). */
function toIso(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const t = v as { toDate?: () => Date };
  return typeof t.toDate === 'function' ? t.toDate().toISOString() : '';
}

function readPrefs(v: unknown): Prefs {
  const p = (v && typeof v === 'object' ? v : {}) as Partial<Prefs>;
  return {
    notifyToday: p.notifyToday !== false,
    notifyUpcoming: p.notifyUpcoming !== false,
    notifyCancelled: p.notifyCancelled !== false,
    notifyConcerns: p.notifyConcerns !== false
  };
}

/** Builds an AppUser from a users/{uid} document. Returns null for an invalid role / barangay. */
function toAppUser(uid: string, d: Record<string, unknown>, email: string, lastSignIn: string): AppUser | null {
  const role = d['role'] as Role;
  if (!ROLES.includes(role)) return null;
  const barangay = str(d['barangay']);
  if (role === 'barangay_head' && !barangay) return null;
  return {
    uid,
    email: email || str(d['email']),
    name: str(d['name']),
    role,
    barangay,
    phone: str(d['phone']),
    address: str(d['address']),
    bio: str(d['bio']),
    position: str(d['position']),
    vehicle: str(d['vehicle']),
    team: str(d['team']),
    photo: str(d['photo']),
    active: d['active'] !== false,
    createdAt: toIso(d['createdAt']),
    lastSignIn,
    prefs: readPrefs(d['prefs'])
  };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  /** Sign in with email + password, then load the role from Firestore users/{uid}. */
  async login(email: string, password: string): Promise<AppUser> {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    const profile = await this.loadProfile(cred.user);
    if (!profile) {
      await signOut(auth);
      throw new Error('NO_PROFILE');
    }
    if (!profile.active) {
      await signOut(auth);
      throw new Error('ACCOUNT_DISABLED');
    }
    return profile;
  }

  /** Reads users/{uid}. Returns null if the document or a valid role is missing. */
  async loadProfile(user: User): Promise<AppUser | null> {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) return null;
    const t = user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime) : null;
    const lastSignIn = t && !isNaN(t.getTime()) ? t.toISOString() : '';
    return toAppUser(user.uid, snap.data() as Record<string, unknown>, user.email ?? '', lastSignIn);
  }

  /** Restores the session after a page refresh. Disabled accounts are signed out. */
  watch(callback: (u: AppUser | null) => void): () => void {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) return callback(null);
      try {
        const p = await this.loadProfile(user);
        if (p && !p.active) {
          await signOut(auth);
          return callback(null);
        }
        callback(p);
      } catch {
        callback(null);
      }
    });
  }

  logout(): Promise<void> {
    return signOut(auth);
  }

  // ---------- profile (the signed-in person) ----------

  /** Saves the person's own profile fields, then returns the fresh profile. */
  async saveOwnProfile(uid: string, patch: SelfEditable): Promise<AppUser> {
    await updateDoc(doc(db, 'users', uid), { ...patch });
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in.');
    const fresh = await this.loadProfile(user);
    if (!fresh) throw new Error('NO_PROFILE');
    return fresh;
  }

  /** Re-checks the current password, then sets the new one. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = auth.currentUser;
    if (!user || !user.email) throw new Error('Not signed in.');
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
  }

  // ---------- admin: manage accounts ----------

  async listUsers(): Promise<AppUser[]> {
    const snap = await getDocs(collection(db, 'users'));
    const out: AppUser[] = [];
    snap.forEach(d => {
      const u = toAppUser(d.id, d.data() as Record<string, unknown>, '', '');
      if (u) out.push(u);
    });
    return out.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }

  async updateUser(current: AppUser | null, uid: string, patch: AdminEditable): Promise<void> {
    if (current?.role !== 'admin') throw new Error('Only the administrator can change accounts.');
    if (uid === current.uid && (patch.role !== undefined || patch.active !== undefined))
      throw new Error('You cannot change your own role or deactivate your own account.');
    if (patch.role === 'barangay_head' && !(patch.barangay ?? '').trim())
      throw new Error('A Barangay Head must be assigned to a barangay.');
    await updateDoc(doc(db, 'users', uid), { ...patch });
  }

  /**
   * Admin-only. Uses a temporary second Firebase app so the admin stays signed in.
   * The Firestore rules must also allow only admins to create users/{uid}.
   */
  async createStaff(
    current: AppUser | null,
    input: { email: string; password: string; name: string; role: Role; barangay: string; team?: string }
  ): Promise<void> {
    if (current?.role !== 'admin') throw new Error('Only the administrator can create accounts.');
    if (!ROLES.includes(input.role)) throw new Error('Invalid role.');
    if (input.role === 'barangay_head' && !input.barangay.trim())
      throw new Error('A Barangay Head must be assigned to a barangay.');
    if (input.password.length < 6) throw new Error('Password must be at least 6 characters.');

    const temp = initializeApp(firebaseConfig, 'staff-creator-' + Date.now());
    try {
      const cred = await createUserWithEmailAndPassword(getAuth(temp), input.email.trim(), input.password);
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: input.name.trim(),
        email: input.email.trim(),
        role: input.role,
        barangay: input.role === 'barangay_head' ? input.barangay.trim() : '',
        team: input.role === 'driver' ? (input.team ?? '').trim() : '',
        active: true,
        createdAt: serverTimestamp()
      });
      await signOut(getAuth(temp));
    } finally {
      await deleteApp(temp);
    }
  }
}
