import firestore from '@react-native-firebase/firestore';

const rooms = () => firestore().collection('rooms');
const roomRef = roomCode => rooms().doc(roomCode);
const requestRef = (roomCode, uid) =>
  roomRef(roomCode).collection('requests').doc(uid);

function serverTimestamp() {
  return firestore.FieldValue.serverTimestamp();
}

function arrayUnion(value) {
  return firestore.FieldValue.arrayUnion(value);
}

function cleanCandidate(candidate) {
  return Object.fromEntries(
    Object.entries(candidate.toJSON()).filter(([, value]) => value !== undefined),
  );
}

function cleanSessionDescription(description) {
  return {
    type: description.type,
    sdp: description.sdp,
  };
}

// Firestore already stores hostUid on rooms/{roomCode}; no separate RTDB meta
// write is needed. Keeping this function preserves the existing call sites.
export async function saveRoomMeta() {}

// ── HOST side ──────────────────────────────────────────────────────────────

export async function saveOffer(roomCode, listenerUid, sdp) {
  await requestRef(roomCode, listenerUid).update({
    offer: cleanSessionDescription(sdp),
    offerUpdatedAt: serverTimestamp(),
  });
}

export function listenForAnswer(roomCode, listenerUid, callback) {
  let processed = false;
  return requestRef(roomCode, listenerUid).onSnapshot(snap => {
    const answer = snap.data()?.answer;
    if (answer && !processed) {
      processed = true;
      callback(answer);
    }
  });
}

export async function saveHostCandidate(roomCode, listenerUid, candidate) {
  await requestRef(roomCode, listenerUid).update({
    hostCandidates: arrayUnion(cleanCandidate(candidate)),
  });
}

export function listenForListenerCandidates(roomCode, listenerUid, callback) {
  let seen = 0;
  return requestRef(roomCode, listenerUid).onSnapshot(snap => {
    const candidates = snap.data()?.listenerCandidates || [];
    candidates.slice(seen).forEach(callback);
    seen = candidates.length;
  });
}

// ── LISTENER side ──────────────────────────────────────────────────────────

export function listenForOffer(roomCode, listenerUid, callback) {
  let processed = false;
  return requestRef(roomCode, listenerUid).onSnapshot(snap => {
    const offer = snap.data()?.offer;
    if (offer && !processed) {
      processed = true;
      callback(offer);
    }
  });
}

export async function saveAnswer(roomCode, uid, sdp) {
  await requestRef(roomCode, uid).update({
    answer: cleanSessionDescription(sdp),
    answerUpdatedAt: serverTimestamp(),
  });
}

export async function saveListenerCandidate(roomCode, uid, candidate) {
  await requestRef(roomCode, uid).update({
    listenerCandidates: arrayUnion(cleanCandidate(candidate)),
  });
}

export function listenForHostCandidates(roomCode, uid, callback) {
  let seen = 0;
  return requestRef(roomCode, uid).onSnapshot(snap => {
    const candidates = snap.data()?.hostCandidates || [];
    candidates.slice(seen).forEach(callback);
    seen = candidates.length;
  });
}

// ── CLEANUP ────────────────────────────────────────────────────────────────

export async function clearRoomSignaling() {}

export async function clearListenerSignaling(roomCode, uid) {
  await requestRef(roomCode, uid).update({
    answer: null,
    offer: null,
    hostCandidates: [],
    listenerCandidates: [],
  });
}
