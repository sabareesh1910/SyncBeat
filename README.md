# SyncBeat 🎵

Stream your phone's system audio (Instagram, YouTube, Spotify — anything)
to multiple listeners worldwide. Each listener plays the audio through their
own device, which can be connected to a Bluetooth speaker or headphones.

---

## How it works

```
Host phone (playing Instagram Reels)
        │
        │  WebRTC audio stream over internet
        │
        ├──▶ Friend's phone 1 ──▶ 🔊 JBL Bluetooth Speaker
        ├──▶ Friend's phone 2 ──▶ 🎧 Bluetooth Headphones
        └──▶ Friend's phone N ──▶ 🔊 Any speaker / earphones
```

- Host captures ALL system audio via Android MediaProjection API
- Audio is streamed in real-time using WebRTC (same tech as video calls)
- Firebase handles room management and WebRTC signaling
- Audio never goes through Firebase — it's direct peer-to-peer

---

## Requirements

- Android 10+ (API 29+) — required for system audio capture
- Node.js 18+
- React Native CLI (not Expo)
- Android Studio with Android SDK 34
- A Firebase project

---

## Setup Steps

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Firebase

1. Go to https://console.firebase.google.com
2. Create a project named **syncbeat**
3. Add Android app with package name: `com.syncbeat`
4. Download `google-services.json`
5. Place it at: `android/app/google-services.json`
6. In Firebase Console, enable:
   - **Authentication** → Anonymous sign-in
   - **Firestore** → Create database (start in test mode, then apply rules below)
   - **Realtime Database** → Create database (start in test mode, then apply rules below)

### 3. ⚠️ Apply Firebase Security Rules (REQUIRED)

> Do NOT leave Firebase in test mode. Test mode allows anyone on the internet
> to read and write your entire database.

**Firestore Rules** (Console → Firestore → Rules tab):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /rooms/{roomCode} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
                    && request.resource.data.hostUid == request.auth.uid;
      allow update: if request.auth != null
                    && resource.data.hostUid == request.auth.uid;
      allow delete: if request.auth != null
                    && resource.data.hostUid == request.auth.uid;

      match /requests/{uid} {
        allow create: if request.auth != null && request.auth.uid == uid;
        allow read:   if request.auth != null
                      && (request.auth.uid == uid
                          || request.auth.uid == get(/databases/$(database)/documents/rooms/$(roomCode)).data.hostUid);
        allow update: if request.auth != null
                      && (request.auth.uid == uid
                          || request.auth.uid == get(/databases/$(database)/documents/rooms/$(roomCode)).data.hostUid);
        allow delete: if request.auth != null
                      && request.auth.uid == get(/databases/$(database)/documents/rooms/$(roomCode)).data.hostUid;
      }
    }
  }
}
```

**Realtime Database Rules** (Console → Realtime DB → Rules tab):

```json
{
  "rules": {
    "signaling": {
      "$roomCode": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

### 4. Run on Android

```bash
# Connect Android device via USB (enable USB debugging)
npx react-native run-android
```

---

## App Flow

### Host flow
1. Open app → tap **Create Room**
2. Enter your display name
3. Tap **Start Broadcasting**
4. Android shows "Start capturing?" → tap **Start Now**
5. Share the 6-character room code with friends
6. When friends request to join, see them in the **Pending Requests** list
7. Tap **Accept** to let them hear your audio (must be streaming first)
8. Tap **Stop** when done

### Listener flow
1. Open app → tap **Join Room**
2. Enter your name and the room code
3. Wait for the host to accept your request
4. Once accepted, audio starts playing automatically
5. Connect your Bluetooth speaker for best experience

---

## Project Structure

```
syncbeat/
├── index.js
├── src/
│   ├── App.js
│   ├── screens/
│   │   ├── HomeScreen.js
│   │   ├── JoinRoomScreen.js
│   │   ├── HostRoomScreen.js
│   │   └── ListenerRoomScreen.js
│   ├── services/
│   │   ├── firebaseConfig.js       — Firebase setup + security rule templates
│   │   ├── signalingService.js     — WebRTC signaling via Firebase RTDB
│   │   └── webrtcService.js        — WebRTC peer connections + audio capture
│   └── components/
│       ├── AudioVisualizer.js
│       └── ListenerCard.js
└── android/
    └── app/src/main/
        ├── AndroidManifest.xml
        └── java/com/syncbeat/
            ├── MainActivity.kt
            ├── MainApplication.kt
            └── services/
                └── AudioCaptureService.kt
```

---

## Fixes Applied (v1.1.0)

| # | Fix | Description |
|---|-----|-------------|
| 1 | Firebase Security Rules | Detailed rules added in `firebaseConfig.js` and README — never run in test mode |
| 2 | Per-listener SDP offers | Offers now stored at `signaling/{room}/offers/{uid}` instead of a single shared path |
| 3 | Anonymous auth noted | displayName is user-chosen; UID provides session uniqueness |
| 4 | Null stream guard | `acceptListener()` rejects early if `audioStream` is not ready |
| 5 | useEffect race condition | `status` removed from snapshot effect deps; `acceptedRef` prevents double-starts |
| 6 | Unique room codes | `generateUniqueRoomCode()` checks Firestore before using a code |
| 7 | Idempotent cleanup | `cleanedUp` ref prevents double-execution of cleanup in host and listener screens |
| 8 | Real host name | Host is prompted for their display name; stored in Firestore room document |
| 9 | TURN server added | Public TURN fallback added to `RTC_CONFIG` for NAT traversal on mobile data |
| 10 | Removed RTCView hack | Zero-size RTCView removed; audio plays without a view element |
| 11 | Correct signalingState check | `processAnswer` checks for `have-local-offer`; `processOffer` checks `remoteDescription !== null` |
| 12 | Answer listener memory leak | Answer listener unsubscribed immediately after first successful processing |
| 13 | Atomic RTDB cleanup | `clearListenerSignaling` uses a single multi-path update instead of 3 sequential removes |
| 14 | displayName sanitization | Name trimmed before empty check; all-whitespace names rejected; host-self-join blocked |

---

## Technical Notes

### System Audio Capture
- Uses Android `MediaProjection` API (Android 10+ only)
- User must confirm "Start capturing?" prompt every session — Android security requirement
- A foreground service (`AudioCaptureService`) keeps capture alive when the user switches apps

### WebRTC Signaling via Firebase
- Firebase Realtime DB is used for SDP offer/answer + ICE candidate exchange
- Each listener gets their own offer path to prevent concurrent-accept clobbering
- Once peers are connected, Firebase is no longer in the audio path

### TURN Servers
- A public TURN relay (Open Relay) is included as a fallback
- For production, replace with a dedicated TURN server (Twilio, Xirsys, or self-hosted coturn)
- Without TURN, WebRTC fails when both peers are behind symmetric NAT (common on mobile data)

### Bluetooth Speakers
- The app does not manage Bluetooth directly
- Listeners connect their Bluetooth device normally via Android Settings
- Android automatically routes audio to whatever output is connected

### Latency
- Same room / same WiFi: ~50–100ms
- Different cities / mobile data: ~150–300ms (similar to a WhatsApp voice call)

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Could not capture system audio" | Tap "Start Now" on the Android capture prompt |
| Room code not found | Check spelling; codes are case-insensitive in the app |
| Audio cuts out | Check internet connection; TURN server may be needed |
| Listener can't connect | Verify Firebase Realtime DB security rules allow auth'd reads/writes |
| App crashes on Android 9 | minSdkVersion is 29 (Android 10) — this is required for MediaProjection audio |
| Host name shows wrong | Ensure you entered your name in the host name prompt before creating the room |
