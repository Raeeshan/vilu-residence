/**
 * Real Firestore-backed implementation of profileService's
 * FirestoreUserDocReader — reads users/{normalizedEmail}, exactly mirroring
 * the web Agency Portal's fetchAgencyProfile() (now itself fixed to
 * normalize the email first, see that file's own 2026-09-13 comment).
 * firestore.rules already permits this exact read: `isAdmin() ||
 * isStaff() || isManagerRole() || (self-email match)` — a signed-in user
 * reading their OWN users/{email} doc is always allowed; this repository
 * never attempts to read any other user's document.
 */
import { getFirestore } from '../firebase/firebase';
import type { RawUserDoc } from '../../types/profile';
import type { FirestoreUserDocReader } from './profileService';

export const usersRepository: FirestoreUserDocReader = {
  async getUserDoc(normalizedEmail: string): Promise<RawUserDoc | null> {
    const snap = await getFirestore().collection('users').doc(normalizedEmail).get();
    if (!snap.exists) return null;
    return snap.data() as RawUserDoc;
  },
};
