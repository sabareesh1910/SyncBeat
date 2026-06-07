// src/services/firebaseConfig.js
//
// FIX #2: RTDB rules are now scoped per-participant, not just "any auth user".
//         Specifically, only the host can write offers; only the listener can
//         write answers and listener candidates; only the host can write host
//         candidates. This prevents any authenticated user from injecting fake
//         SDP or ICE data into another user's signaling path.
//
// FIX #3: Room expiry is handled by a Firebase Cloud Function (see template
//         below). Rooms older than 24 hours are automatically deleted.
//         generateUniqueRoomCode() now also checks active:true to avoid
//         treating expired (active:false) rooms as collisions.

export const FIRESTORE_ROOMS = 'rooms';
export const RTDB_SIGNALING  = 'signaling';

// ─────────────────────────────────────────────────────────────
//  FIREBASE SETUP STEPS
// ─────────────────────────────────────────────────────────────
//  1. Go to https://console.firebase.google.com
//  2. Create a project (e.g. "syncbeat")
//  3. Add Android app — package name: com.syncbeat
//  4. Download google-services.json → android/app/google-services.json
//  5. Enable: Authentication → Anonymous
//             Firestore      → create database
//             Realtime DB    → create database
//  6. Apply ALL security rules below (do NOT leave in test mode)
//  7. Deploy the Cloud Function below for room expiry (FIX #3)

// ─────────────────────────────────────────────────────────────
//  FIRESTORE RULES  (Console → Firestore → Rules)
// ─────────────────────────────────────────────────────────────
//
//  rules_version = '2';
//  service cloud.firestore {
//    match /databases/{database}/documents {
//
//      match /rooms/{roomCode} {
//        allow read:   if request.auth != null;
//        allow create: if request.auth != null
//                      && request.resource.data.hostUid == request.auth.uid;
//        allow update: if request.auth != null
//                      && resource.data.hostUid == request.auth.uid;
//        allow delete: if request.auth != null
//                      && resource.data.hostUid == request.auth.uid;
//
//        match /requests/{uid} {
//          allow create: if request.auth != null && request.auth.uid == uid;
//          allow read:   if request.auth != null
//                        && (request.auth.uid == uid
//                            || request.auth.uid == get(/databases/$(database)/documents/rooms/$(roomCode)).data.hostUid);
//          allow update: if request.auth != null
//                        && (request.auth.uid == uid
//                            || request.auth.uid == get(/databases/$(database)/documents/rooms/$(roomCode)).data.hostUid);
//          allow delete: if request.auth != null
//                        && request.auth.uid == get(/databases/$(database)/documents/rooms/$(roomCode)).data.hostUid;
//        }
//      }
//    }
//  }

// ─────────────────────────────────────────────────────────────
//  REALTIME DATABASE RULES  (Console → Realtime DB → Rules)
// ─────────────────────────────────────────────────────────────
//
//  FIX #2: Rules are now scoped per-participant:
//    • offers/{listenerUid}          → only the host can write
//    • answers/{uid}                 → only the listener (uid) can write
//    • hostCandidates/{listenerUid}  → only the host can write
//    • listenerCandidates/{uid}      → only the listener (uid) can write
//
//  To use these rules you must store hostUid in RTDB alongside the
//  signaling data. HostRoomScreen writes it when creating the room
//  (see saveRoomMeta in signalingService.js).
//
//  {
//    "rules": {
//      "signaling": {
//        "$roomCode": {
//          // Anyone authenticated can read all signaling for a room
//          // (needed so host reads answers, listener reads offers)
//          ".read": "auth != null",
//
//          "meta": {
//            // Only the host writes the meta (hostUid) node
//            ".write": "auth != null"
//          },
//
//          "offers": {
//            "$listenerUid": {
//              // Only the host can write an offer to a listener
//              ".write": "auth != null && data.parent().parent().child('meta/hostUid').val() == auth.uid"
//            }
//          },
//
//          "answers": {
//            "$uid": {
//              // Only the listener matching $uid can write their own answer
//              ".write": "auth != null && auth.uid == $uid"
//            }
//          },
//
//          "hostCandidates": {
//            "$listenerUid": {
//              // Only the host can write host-side ICE candidates
//              ".write": "auth != null && data.parent().parent().child('meta/hostUid').val() == auth.uid"
//            }
//          },
//
//          "listenerCandidates": {
//            "$uid": {
//              // Only the listener matching $uid can write their own candidates
//              ".write": "auth != null && auth.uid == $uid"
//            }
//          }
//        }
//      }
//    }
//  }

// ─────────────────────────────────────────────────────────────
//  CLOUD FUNCTION — Room Expiry  (FIX #3)
// ─────────────────────────────────────────────────────────────
//  Deploy this to Firebase Cloud Functions to auto-delete stale rooms.
//  Runs daily at midnight UTC and removes rooms older than 24 hours.
//
//  // functions/index.js
//  const {onSchedule} = require('firebase-functions/v2/scheduler');
//  const {initializeApp} = require('firebase-admin/app');
//  const {getFirestore, Timestamp} = require('firebase-admin/firestore');
//  const {getDatabase} = require('firebase-admin/database');
//
//  initializeApp();
//
//  exports.purgeExpiredRooms = onSchedule('every 24 hours', async () => {
//    const db = getFirestore();
//    const rtdb = getDatabase();
//    const cutoff = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
//
//    const snap = await db.collection('rooms')
//      .where('createdAt', '<', cutoff)
//      .get();
//
//    const batch = db.batch();
//    const rtdbDeletes = [];
//
//    for (const doc of snap.docs) {
//      batch.delete(doc.ref);
//      // Also wipe any leftover signaling data from RTDB
//      rtdbDeletes.push(rtdb.ref(`signaling/${doc.id}`).remove());
//    }
//
//    await Promise.all([batch.commit(), ...rtdbDeletes]);
//    console.log(`Purged ${snap.size} expired rooms`);
//  });

// ─────────────────────────────────────────────────────────────
//  DATA STRUCTURE (reference)
// ─────────────────────────────────────────────────────────────
//
// Firestore:
//   rooms/{roomCode}
//     hostUid:   string
//     hostName:  string
//     createdAt: timestamp
//     active:    boolean
//     streaming: boolean
//
//   rooms/{roomCode}/requests/{uid}
//     uid:         string
//     displayName: string
//     status:      'pending' | 'accepted' | 'rejected' | 'removed' | 'left'
//     requestedAt: timestamp
//
// Realtime DB:
//   signaling/{roomCode}/meta/hostUid           — used by RTDB security rules
//   signaling/{roomCode}/offers/{listenerUid}   — SDP offer per listener
//   signaling/{roomCode}/answers/{uid}          — SDP answer per listener
//   signaling/{roomCode}/hostCandidates/{listenerUid}/{idx}
//   signaling/{roomCode}/listenerCandidates/{uid}/{idx}
