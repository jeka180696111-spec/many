// /api/join-family — приєднання до родини по invite-коду.
// Клієнтські Firestore rules не пускають користувача читати/писати
// в чужий families/{id} доки він не в members. Тому робимо це серверно
// через admin SDK.

import { getDB } from './_firestore.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, code, userName, userAvatar } = req.body || {};
  if (!uid || !code || !userName) {
    return res.status(400).json({ error: 'uid, code, userName required' });
  }

  try {
    const db = getDB();
    const inviteRef = db.collection('invites').doc(String(code).toUpperCase());
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists) {
      return res.status(400).json({ error: 'Невірний або застарілий код запрошення' });
    }

    const invite = inviteDoc.data();
    const now = new Date().toISOString();

    if (invite.used || (invite.expiresAt && invite.expiresAt < now)) {
      return res.status(400).json({ error: 'Невірний або застарілий код запрошення' });
    }

    const { familyId } = invite;

    const familyRef = db.collection('families').doc(familyId);
    const familySnap = await familyRef.get();
    if (!familySnap.exists) {
      return res.status(400).json({ error: 'Родину не знайдено' });
    }

    const familyData = familySnap.data();
    const members = Array.isArray(familyData.members) ? familyData.members : [];

    // Якщо цей uid вже в родині — просто повертаємо success (ідемпотентно).
    const alreadyMember = members.some(m => m.uid === uid);
    if (!alreadyMember) {
      const newMember = { uid, name: userName, avatar: userAvatar || '', joinedAt: now };
      await familyRef.update({ members: [...members, newMember] });
    }

    // Створюємо/оновлюємо документ користувача.
    await db.collection('users').doc(uid).set({
      name: userName,
      avatar: userAvatar || '',
      familyId,
      role: 'member',
      createdAt: familyData.createdAt || now,
      joinedAt: now,
    }, { merge: true });

    // Позначаємо invite використаним (одноразовий).
    await inviteRef.set({
      used: true,
      usedBy: uid,
      usedAt: now,
    }, { merge: true });

    return res.status(200).json({ ok: true, familyId, role: 'member' });
  } catch (e) {
    console.error('[join-family]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
