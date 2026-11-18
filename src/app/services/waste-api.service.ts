
import { Injectable } from '@angular/core';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where
} from 'firebase/firestore';
import { db } from '../core/firebase';

export interface CollectionSchedule {
  id?: string;
  barangay: string;
  day: string;
  time: string;
  driver: string;
  vehicleId: string;
  status: 'Scheduled' | 'In Progress' | 'Completed' | 'Delayed';
}

export interface WasteVehicle {
  id?: string;
  plateNumber: string;
  type: string;
  driver: string;
  status: 'Active' | 'Delayed' | 'Under Maintenance';
  notes: string;
}

export interface WasteNotification {
  id?: string;
  title: string;
  barangay: string;
  message: string;
  date: string;
  type: 'Schedule Change' | 'Delay' | 'General';
}

export interface WasteReadiness {
  id?: string;
  barangay: string;
  street: string;
  household: string;
  ready: boolean;
  updatedAt: string;
}

export interface CollectionPoint {
  id?: string;
  barangay: string;
  location: string;
  scheduleId: string;
  completed: boolean;
}

/**
 * Small Firestore wrapper. It keeps the same list / create / update / remove
 * methods the app already uses, but data now lives in Cloud Firestore
 * (collection = resource name, document ID = record id) instead of a local server.
 */
@Injectable({ providedIn: 'root' })
export class WasteApiService {
  list<T>(resource: string): Observable<T[]> {
    return from(getDocs(collection(db, resource))).pipe(
      map(snap => snap.docs.map(d => ({ ...d.data(), id: d.id }) as T))
    );
  }

  /** Lists documents where one field equals a value (needed for rules that limit a Barangay Head to their own area). */
  listWhere<T>(resource: string, field: string, value: string): Observable<T[]> {
    return from(getDocs(query(collection(db, resource), where(field, '==', value)))).pipe(
      map(snap => snap.docs.map(d => ({ ...d.data(), id: d.id }) as T))
    );
  }

  create<T extends { id?: string }>(resource: string, value: T): Observable<T> {
    const { id, ...data } = value;
    const save = id
      ? setDoc(doc(db, resource, id), data).then(() => id)
      : addDoc(collection(db, resource), data).then(ref => ref.id);
    return from(save).pipe(map(newId => ({ ...data, id: newId }) as unknown as T));
  }

  update<T extends { id?: string }>(resource: string, value: T): Observable<T> {
    const { id, ...data } = value;
    if (!id) {
      throw new Error('Cannot update a record without an id.');
    }
    return from(setDoc(doc(db, resource, id), data)).pipe(map(() => value));
  }

  remove(resource: string, id: string): Observable<void> {
    return from(deleteDoc(doc(db, resource, id)));
  }
}
