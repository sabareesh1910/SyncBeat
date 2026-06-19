import {NativeModules, NativeEventEmitter} from 'react-native';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
} from 'react-native-webrtc';

// ── ICE Configuration ────────────────────────────────────────────
//
// Connection priority (automatic via WebRTC ICE):
//   1. STUN (direct peer-to-peer, fastest, free)
//   2. TURN Account 1 — Metered primary
//   3. TURN Account 2 — Metered secondary (bandwidth fallback)
//   4. TURN OpenRelay  — last resort public server
//
// To add more TURN accounts in the future, add them to the
// iceServers array before the OpenRelay section, following
// the same 4-URL pattern (port 80, 80/tcp, 443, 443/tcp).
//
// ICE_TIMEOUT_MS: how long to wait for a connection before
// giving up. Set high enough to allow TURN fallback to kick in.
// 60 seconds is recommended when multiple TURN servers are used
// because ICE needs time to try each server.

const ICE_TIMEOUT_MS = 60000; // 60 seconds
const ICE_GATHERING_TIMEOUT_MS = 5000;

const RTC_CONFIG = {
  iceServers: [

    // ── 1. STUN servers (try direct connection first) ──────────
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },

    // ── 2. TURN Account 1 — Metered Primary ───────────────────
    // Used when direct connection fails.
    // If bandwidth runs out, ICE automatically moves to Account 2.
    {
      urls:       'turn:global.relay.metered.ca:80',
      username:   '30e13400f35237ed9b1c5d7e',
      credential: '69x+Xk0mM2g2OC33',
    },
    {
      urls:       'turn:global.relay.metered.ca:80?transport=tcp',
      username:   '30e13400f35237ed9b1c5d7e',
      credential: '69x+Xk0mM2g2OC33',
    },
    {
      urls:       'turn:global.relay.metered.ca:443',
      username:   '30e13400f35237ed9b1c5d7e',
      credential: '69x+Xk0mM2g2OC33',
    },
    {
      urls:       'turns:global.relay.metered.ca:443?transport=tcp',
      username:   '30e13400f35237ed9b1c5d7e',
      credential: '69x+Xk0mM2g2OC33',
    },

    // ── 3. TURN Account 2 — Metered Secondary ─────────────────
    // Fallback if Account 1 credentials are exhausted or rejected.
    // ADD MORE ACCOUNTS HERE in the same pattern if provided.
    {
      urls:       'turn:global.relay.metered.ca:80',
      username:   'c85007de26728fe1c649082f',
      credential: 'sZ4HpNTu9bk8vaLh',
    },
    {
      urls:       'turn:global.relay.metered.ca:80?transport=tcp',
      username:   'c85007de26728fe1c649082f',
      credential: 'sZ4HpNTu9bk8vaLh',
    },
    {
      urls:       'turn:global.relay.metered.ca:443',
      username:   'c85007de26728fe1c649082f',
      credential: 'sZ4HpNTu9bk8vaLh',
    },
    {
      urls:       'turns:global.relay.metered.ca:443?transport=tcp',
      username:   'c85007de26728fe1c649082f',
      credential: 'sZ4HpNTu9bk8vaLh',
    },

    // ── 4. OpenRelay — Last Resort ─────────────────────────────
    // Public shared TURN server. No credentials needed.
    // Used only if all accounts above fail or are rejected.
    // Not reliable for production but better than no audio at all.
    {
      urls:       'turn:openrelay.metered.ca:80',
      username:   'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls:       'turn:openrelay.metered.ca:443',
      username:   'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls:       'turn:openrelay.metered.ca:443?transport=tcp',
      username:   'openrelayproject',
      credential: 'openrelayproject',
    },

  ],

  // Prepare 10 ICE candidates in advance for faster connection.
  iceCandidatePoolSize: 10,

  // iceTransportPolicy: 'all' means try STUN (direct) first,
  // then fall back to TURN relay. Do NOT change this to 'relay'
  // unless you want to force TURN and skip direct connection.
  iceTransportPolicy: 'all',
};

// ── SYSTEM AUDIO CAPTURE ────────────────────────────────────────────────────

export async function getSystemAudioStream() {
  const {SystemAudioCapture} = NativeModules;
  if (!SystemAudioCapture) {
    throw new Error('SystemAudioCapture native module not found. Is the app rebuilt?');
  }
  // Request MediaProjection permission — shows the Android "Start capturing?" dialog.
  await SystemAudioCapture.requestCapture();

  // Use getUserMedia with a real audio constraint so WebRTC
  // creates a valid local audio track to send to listeners.
  // The actual audio content will come from the system capture above.
  const stream = await mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl:  false,
      sampleRate:       44100,
      channelCount:     2,
    },
    video: false,
  });
  return stream;
}

// ── ICE candidate buffer helpers ─────────────────────────────────────────────
//
// FIX #6: Candidates that arrive before remoteDescription is set are buffered
// here and flushed once flushIceCandidates() is called (after setRemoteDescription).
// Each peer connection has its own buffer keyed by the pc object reference.

const iceCandidateBuffers = new WeakMap(); // WeakMap<RTCPeerConnection, Array>

function bufferOrAddCandidate(pc, candidateData) {
  if (pc.remoteDescription) {
    // Remote description is already set — add immediately.
    pc.addIceCandidate(new RTCIceCandidate(candidateData)).catch(e => {
      console.warn('addIceCandidate failed:', e);
    });
  } else {
    // Queue for later.
    if (!iceCandidateBuffers.has(pc)) {
      iceCandidateBuffers.set(pc, []);
    }
    iceCandidateBuffers.get(pc).push(candidateData);
  }
}

async function flushIceCandidates(pc) {
  const buffer = iceCandidateBuffers.get(pc);
  if (!buffer || buffer.length === 0) return;
  iceCandidateBuffers.delete(pc);
  for (const candidateData of buffer) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidateData));
    } catch (e) {
      console.warn('Flushing buffered ICE candidate failed:', e);
    }
  }
}

function normalizeConnectionState(pc) {
  const state = pc.connectionState;
  if (state === 'connected' || state === 'failed' || state === 'disconnected' || state === 'closed') {
    return state;
  }

  if (pc.iceConnectionState === 'completed') return 'connected';
  return pc.iceConnectionState || state;
}

export function isPeerConnected(pc) {
  if (!pc) return false;
  return normalizeConnectionState(pc) === 'connected';
}

function waitForIceGatheringComplete(pc, timeoutMs = ICE_GATHERING_TIMEOUT_MS) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();

  return new Promise(resolve => {
    let finished = false;
    const previousHandler = pc.onicegatheringstatechange;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      pc.onicegatheringstatechange = previousHandler || null;
      resolve();
    };

    const timeoutId = setTimeout(finish, timeoutMs);

    pc.onicegatheringstatechange = event => {
      if (previousHandler) previousHandler(event);
      if (pc.iceGatheringState === 'complete') finish();
    };
  });
}

// ── HOST: create a peer connection for one listener ─────────────────────────

export function createHostPeerConnection({
  audioStream,
  onIceCandidate,
  onConnectionStateChange,
}) {
  const pc = new RTCPeerConnection(RTC_CONFIG);

  const audioTracks = audioStream.getAudioTracks();
  if (audioTracks.length === 0) {
    throw new Error('No audio track available. Please allow audio capture and try again.');
  }

  audioTracks.forEach(track => {
    pc.addTrack(track, audioStream);
  });

  pc.onicecandidate = event => {
    if (event.candidate) {
      Promise.resolve(onIceCandidate(event.candidate)).catch(e => {
        console.warn('Saving host ICE candidate failed:', e);
      });
    }
  };

  pc.onconnectionstatechange = () => {
    onConnectionStateChange(normalizeConnectionState(pc));
  };

  pc.oniceconnectionstatechange = () => {
    onConnectionStateChange(normalizeConnectionState(pc));
  };

  return pc;
}

// Host creates the SDP offer for a specific listener.
export async function createOffer(pc) {
  const offer = await pc.createOffer({offerToReceiveAudio: false});
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc);
  return pc.localDescription || offer;
}

// Host applies the listener's SDP answer.
export async function processAnswer(pc, answerSdp) {
  if (pc.signalingState !== 'have-local-offer') return;
  if (!answerSdp?.type || typeof answerSdp.sdp !== 'string') {
    throw new Error('Invalid answer data received from Firebase.');
  }
  const answer = new RTCSessionDescription(answerSdp);
  await pc.setRemoteDescription(answer);
  // FIX #6: Flush any ICE candidates that arrived before the answer was set.
  await flushIceCandidates(pc);
}

// FIX #6: Use the buffer helper instead of the silent drop guard.
export function addListenerIceCandidate(pc, candidateData) {
  bufferOrAddCandidate(pc, candidateData);
}

// ── LISTENER: create a peer connection to the host ──────────────────────────

export function createListenerPeerConnection({
  onIceCandidate,
  onTrack,
  onConnectionStateChange,
}) {
  const pc = new RTCPeerConnection(RTC_CONFIG);

  pc.ontrack = event => {
    if (event.streams && event.streams[0]) onTrack(event.streams[0]);
  };

  pc.onicecandidate = event => {
    if (event.candidate) {
      Promise.resolve(onIceCandidate(event.candidate)).catch(e => {
        console.warn('Saving listener ICE candidate failed:', e);
      });
    }
  };

  pc.onconnectionstatechange = () => {
    onConnectionStateChange(normalizeConnectionState(pc));
  };

  pc.oniceconnectionstatechange = () => {
    onConnectionStateChange(normalizeConnectionState(pc));
  };

  return pc;
}

// Listener processes the host's SDP offer and creates an answer.
// FIX #12: Log when the re-entry guard fires so it's visible in debug output.
export async function processOffer(pc, offerSdp) {
  if (pc.remoteDescription !== null) {
    console.warn('processOffer: remoteDescription already set — skipping (this is expected if the offer fired twice)');
    return null;
  }
  if (!offerSdp?.type || typeof offerSdp.sdp !== 'string') {
    throw new Error('Invalid offer data received from Firebase.');
  }
  const offer = new RTCSessionDescription(offerSdp);
  await pc.setRemoteDescription(offer);
  // FIX #6: Flush buffered host ICE candidates now that remote desc is set.
  await flushIceCandidates(pc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGatheringComplete(pc);
  return pc.localDescription || answer;
}

// FIX #6: Use the buffer helper on the listener side too.
export function addHostIceCandidate(pc, candidateData) {
  bufferOrAddCandidate(pc, candidateData);
}

// ── CLEANUP ──────────────────────────────────────────────────────────────────

export function closePeerConnection(pc) {
  if (pc) {
    iceCandidateBuffers.delete(pc);
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.onicegatheringstatechange = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.close();
  }
}

export function stopStream(stream) {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
}
