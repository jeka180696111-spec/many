// Спільний init Firestore Admin для endpoint'ів.
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export function getDB() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not configured');
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
  return getFirestore();
}
