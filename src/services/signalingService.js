// src/services/signalingService.js
// Uses Firebase Realtime Database for all WebRTC signaling.
// RTDB has no per-document write rate limits and is purpose-built
// for real-time data exchange — exactly what WebRTC signaling needs.
// Firestore is only used for room management (rooms collection).

import database from '@react-native-firebase/database';

const sigRef = (roomCode) => database().ref(`signaling/${roomCode}`);

function cleanCandidate(candidate) {
  const json = candidate.toJSON ? candidate.toJSON() : candidate;
  return Object.fromEntries(
    Object.entries(json).filter(([, value]) => value !== undefined && value !== null)
  );
}

function cleanSessionDescription(description) {
  return {
    type: description.type,
    sdp:  description.sdp,
  };
}

// ── ROOM META ──────────────────────────────────────────────────
// Writes hostUid to RTDB so security rules can verify host identity.
// Called once when the host creates the room.

export async function saveRoomMeta(roomCode, hostUid) {
  await sigRef(roomCode).child('meta/hostUid').set(hostUid);
}

// ── HOST side ──────────────────────────────────────────────────

export async function saveOffer(roomCode, listenerUid, sdp) {
  await sigRef(roomCode).child(`offers/${listenerUid}`).set(
    cleanSessionDescription(sdp)
  );
}

export function listenForAnswer(roomCode, listenerUid, callback) {
  let processed = false;
  const ref = sigRef(roomCode).child(`answers/${listenerUid}`);
  const handler = snap => {
    const val = snap.val();
    if (val && !processed) {
      processed = true;
      callback(val);
    }
  };
  ref.on('value', handler);
  return () => ref.off('value', handler);
}

export async function saveHostCandidate(roomCode, listenerUid, candidate) {
  await sigRef(roomCode)
    .child(`hostCandidates/${listenerUid}`)
    .push(cleanCandidate(candidate));
}

export function listenForListenerCandidates(roomCode, listenerUid, callback) {
  const ref = sigRef(roomCode).child(`listenerCandidates/${listenerUid}`);
  const handler = snap => {
    const val = snap.val();
    if (val) callback(val);
  };
  ref.on('child_added', handler);
  return () => ref.off('child_added', handler);
}

// ── LISTENER side ──────────────────────────────────────────────

export function listenForOffer(roomCode, uid, callback) {
  let processed = false;
  const ref = sigRef(roomCode).child(`offers/${uid}`);
  const handler = snap => {
    const val = snap.val();
    if (val && !processed) {
      processed = true;
      callback(val);
    }
  };
  ref.on('value', handler);
  return () => ref.off('value', handler);
}

export async function saveAnswer(roomCode, uid, sdp) {
  await sigRef(roomCode).child(`answers/${uid}`).set(
    cleanSessionDescription(sdp)
  );
}

export async function saveListenerCandidate(roomCode, uid, candidate) {
  await sigRef(roomCode)
    .child(`listenerCandidates/${uid}`)
    .push(cleanCandidate(candidate));
}

export function listenForHostCandidates(roomCode, uid, callback) {
  const ref = sigRef(roomCode).child(`hostCandidates/${uid}`);
  const handler = snap => {
    const val = snap.val();
    if (val) callback(val);
  };
  ref.on('child_added', handler);
  return () => ref.off('child_added', handler);
}

// ── CLEANUP ────────────────────────────────────────────────────

export async function clearRoomSignaling(roomCode) {
  await sigRef(roomCode).remove();
}

export async function clearListenerSignaling(roomCode, uid) {
  await Promise.all([
    sigRef(roomCode).child(`offers/${uid}`).remove(),
    sigRef(roomCode).child(`answers/${uid}`).remove(),
    sigRef(roomCode).child(`hostCandidates/${uid}`).remove(),
    sigRef(roomCode).child(`listenerCandidates/${uid}`).remove(),
  ]);
}
