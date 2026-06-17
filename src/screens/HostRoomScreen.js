// src/screens/HostRoomScreen.js
//
// FIX #2:  saveRoomMeta() called after room creation to write hostUid to RTDB
//          so per-participant security rules can verify host identity.
// FIX #3:  Room creation now avoids a blocking pre-read and retries if the
//          generated code collides with an existing protected room.
// FIX #8:  cleanup() is stored in cleanupRef so the unmount useEffect always
//          calls the latest version (not the stale null-roomCode closure).
// FIX #9:  confirmStop is stored in confirmStopRef for the same reason —
//          BackHandler always calls the current version.
// FIX #10: acceptListener() sets peerConnections.current[listenerUid] = 'pending'
//          synchronously before the first await, preventing double-accept races.
// FIX #11: A 30-second ICE timeout is set per accepted listener; if connectionState
//          never reaches 'connected', the listener is auto-removed with an alert.
// FIX #13: JoinRoomScreen already blocks joining non-streaming rooms, but the host
//          screen also now shows a "not streaming" badge on pending request rows.

import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  FlatList,
  ActivityIndicator,
  BackHandler,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  ScrollView,
  ToastAndroid,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {NativeEventEmitter, NativeModules} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';

import {
  getSystemAudioStream,
  createHostPeerConnection,
  createOffer,
  processAnswer,
  addListenerIceCandidate,
  closePeerConnection,
  stopStream,
  isPeerConnected,
} from '../services/webrtcService';
import {
  saveRoomMeta,
  saveOffer,
  listenForAnswer,
  saveHostCandidate,
  listenForListenerCandidates,
  clearRoomSignaling,
  clearListenerSignaling,
} from '../services/signalingService';
import AudioVisualizer from '../components/AudioVisualizer';
import ListenerCard from '../components/ListenerCard';

const ICE_TIMEOUT_MS = 60000;
const ROOM_SETUP_TIMEOUT_MS = 12000;
const ROOM_CREATE_ATTEMPTS = 4;

function withTimeout(promise, label, timeoutMs = ROOM_SETUP_TIMEOUT_MS) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} is taking too long. Check Firebase setup and internet connection.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function getReadyUser() {
  if (auth().currentUser) return auth().currentUser;
  return withTimeout(auth().signInAnonymously(), 'Firebase sign-in');
}

// ── Room code generation ───────────────────────────────────────────────────

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createRoomFast(hostUid, hostName) {
  for (let i = 0; i < ROOM_CREATE_ATTEMPTS; i++) {
    const code = generateRoomCode();
    try {
      await withTimeout(
        Promise.all([
          firestore().collection('rooms').doc(code).set({
            hostUid,
            hostName,
            createdAt: firestore.FieldValue.serverTimestamp(),
            active: true,
            streaming: false,
          }),
          saveRoomMeta(code, hostUid),
        ]),
        'Room setup',
      );
      return code;
    } catch (e) {
      if (e.code !== 'firestore/permission-denied' || i === ROOM_CREATE_ATTEMPTS - 1) {
        throw e;
      }
    }
  }
  throw new Error('Could not generate a unique room code. Please try again.');
}

// ── Component ─────────────────────────────────────────────────────────────

export default function HostRoomScreen({navigation}) {
  const [hostName, setHostName]           = useState('');
  const [hostNameInput, setHostNameInput] = useState('');
  const [showNameModal, setShowNameModal] = useState(true);
  const [roomCode, setRoomCode]           = useState(null);
  const [roomReady, setRoomReady]         = useState(false);
  const [isStreaming, setIsStreaming]     = useState(false);
  const [loading, setLoading]             = useState(false);
  const [pendingRequests, setPendingRequests]   = useState([]);
  const [acceptedPending, setAcceptedPending]   = useState([]);
  const [connectedListeners, setConnectedListeners] = useState([]);

  // Refs for peer connections and signaling cleanup fns
  const peerConnections = useRef({}); // uid → RTCPeerConnection | 'pending'
  const signalingUnsubs = useRef({}); // uid → [fn, fn]
  const iceTimeouts     = useRef({}); // uid → timeout id   (FIX #11)
  const audioStream     = useRef(null);
  const cleanedUp       = useRef(false);

  // FIX #8: Always call the latest cleanup/confirmStop via refs.
  const cleanupRef     = useRef(null);
  const confirmStopRef = useRef(null);

  // ── Collect host name & create room ─────────────────────────────────────

  const handleNameConfirm = useCallback(async () => {
    const trimmedName = hostNameInput.trim();
    if (!trimmedName) { Alert.alert('Name Required', 'Please enter your display name.'); return; }
    setHostName(trimmedName);
    setShowNameModal(false);
    setLoading(true);
    try {
      const user = await getReadyUser();
      const code = await createRoomFast(user.uid, trimmedName);
      setRoomCode(code);
      setRoomReady(true);
    } catch (e) {
      Alert.alert('Error', e.message);
      navigation.replace('Home');
    } finally {
      setLoading(false);
    }
  }, [hostNameInput, navigation]);

  // ── Listen for pending requests ─────────────────────────────────────────

  useEffect(() => {
    if (!roomCode || !roomReady) return;
    const unsub = firestore()
      .collection('rooms').doc(roomCode).collection('requests')
      .where('status', '==', 'pending')
      .onSnapshot(snap => setPendingRequests(snap.docs.map(d => d.data())));
    return unsub;
  }, [roomCode, roomReady]);

  // ── Back handler — always calls latest confirmStop via ref (FIX #9) ─────

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmStopRef.current?.();
      return true;
    });
    return () => handler.remove();
  }, []);

  // ── Unmount — always calls latest cleanup via ref (FIX #8) ──────────────

  useEffect(() => {
    return () => { cleanupRef.current?.(); };
  }, []);

  // ── FIX #4 + #16: Listen for notification Stop / service killed ──────────
  // When the user taps "Stop" in the foreground notification, or Android kills
  // the service due to memory pressure (after START_STICKY restart), the
  // native AudioCaptureEventModule emits 'onCaptureStopped'. We call cleanup()
  // and navigate home so WebRTC, Firebase, and room state are always consistent.
  useEffect(() => {
    if (!NativeModules.AudioCaptureEvent) return; // safe on simulators / Jest
    const emitter = new NativeEventEmitter(NativeModules.AudioCaptureEvent);
    const sub = emitter.addListener('onCaptureStopped', async () => {
      await cleanupRef.current?.();
      navigation.replace('Home');
    });
    return () => sub.remove();
  }, [navigation]);

  // ── Start streaming ─────────────────────────────────────────────────────

  const startStreaming = async () => {
    setLoading(true);
    try {
      const stream = await getSystemAudioStream();
      audioStream.current = stream;
      setIsStreaming(true);
      await firestore().collection('rooms').doc(roomCode).update({streaming: true});
    } catch (e) {
      Alert.alert('Permission Required',
        'SyncBeat needs permission to capture your device audio.\nPlease tap "Start Now" when Android asks.');
    } finally {
      setLoading(false);
    }
  };

  // ── Accept a listener ───────────────────────────────────────────────────

  const acceptListener = useCallback(async request => {
    if (!audioStream.current) {
      Alert.alert('Not Ready', 'Please start broadcasting before accepting listeners.');
      return;
    }

    const listenerUid = request.uid;

    // FIX #10: Set sentinel synchronously BEFORE any await to prevent
    // a double-tap race where two accepts both pass the guard simultaneously.
    if (peerConnections.current[listenerUid]) return;
    peerConnections.current[listenerUid] = 'pending';

    let pcForCatch = null;
    try {
      await firestore()
        .collection('rooms').doc(roomCode).collection('requests').doc(listenerUid)
        .update({
          connectionDebug: 'host_creating_offer',
          answer: null,
          offer: null,
          hostCandidates: [],
          listenerCandidates: [],
        });

      const pc = createHostPeerConnection({
        audioStream: audioStream.current,
        onIceCandidate: candidate => saveHostCandidate(roomCode, listenerUid, candidate),
        onConnectionStateChange: state => {
          firestore()
            .collection('rooms').doc(roomCode).collection('requests').doc(listenerUid)
            .update({hostConnectionState: state})
            .catch(() => {});

          if (state === 'connected') {
            // FIX #11: Clear ICE timeout on successful connection.
            clearTimeout(iceTimeouts.current[listenerUid]);
            delete iceTimeouts.current[listenerUid];
            setAcceptedPending(prev => prev.filter(l => l.uid !== listenerUid));
            setConnectedListeners(prev =>
              prev.find(l => l.uid === listenerUid) ? prev : [...prev, {uid: listenerUid, name: request.displayName}],
            );
          } else if (state === 'disconnected' || state === 'failed') {
            clearTimeout(iceTimeouts.current[listenerUid]);
            delete iceTimeouts.current[listenerUid];
            setAcceptedPending(prev => prev.filter(l => l.uid !== listenerUid));
            setConnectedListeners(prev => prev.filter(l => l.uid !== listenerUid));
          }
        },
      });
      pcForCatch = pc;

      // Replace 'pending' sentinel with the real peer connection.
      peerConnections.current[listenerUid] = pc;

      const offer = await createOffer(pc);
      await saveOffer(roomCode, listenerUid, offer);

      await firestore()
        .collection('rooms').doc(roomCode).collection('requests').doc(listenerUid)
        .update({status: 'accepted', connectionDebug: 'offer_saved'});

      setAcceptedPending(prev =>
        prev.find(l => l.uid === listenerUid) ? prev : [...prev, {uid: listenerUid, name: request.displayName}],
      );

      let unsubAnswer;
      unsubAnswer = listenForAnswer(roomCode, listenerUid, async answer => {
        try {
          await processAnswer(pc, answer);
          if (unsubAnswer) {
            unsubAnswer();
            if (signalingUnsubs.current[listenerUid]) signalingUnsubs.current[listenerUid][0] = () => {};
          }
        } catch (e) {
          await firestore()
            .collection('rooms').doc(roomCode).collection('requests').doc(listenerUid)
            .update({connectionDebug: `host_process_answer_failed: ${e.message}`})
            .catch(() => {});
        }
      });

      const unsubCandidates = listenForListenerCandidates(roomCode, listenerUid,
        candidate => addListenerIceCandidate(pc, candidate),
      );

      signalingUnsubs.current[listenerUid] = [unsubAnswer, unsubCandidates];

      // FIX #11: Start a 60s ICE timeout. If not connected by then, auto-kick.
      iceTimeouts.current[listenerUid] = setTimeout(async () => {
        const currentPc = peerConnections.current[listenerUid];
        if (currentPc && currentPc !== 'pending' && !isPeerConnected(currentPc)) {
          Alert.alert(
            'Connection Timed Out',
            `Could not establish audio connection with ${request.displayName} after 60 seconds. They have been removed.`,
          );
          await disconnectListener(listenerUid);
        }
      }, ICE_TIMEOUT_MS);
    } catch (e) {
      if (pcForCatch) closePeerConnection(pcForCatch);
      delete peerConnections.current[listenerUid];
      setAcceptedPending(prev => prev.filter(l => l.uid !== listenerUid));
      await firestore()
        .collection('rooms').doc(roomCode).collection('requests').doc(listenerUid)
        .update({
          status: 'removed',
          connectionDebug: `host_accept_failed: ${e.message}`,
        })
        .catch(() => {});
      Alert.alert('Connection Error', e.message);
    }
  }, [roomCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reject ──────────────────────────────────────────────────────────────

  const rejectListener = async request => {
    await firestore()
      .collection('rooms').doc(roomCode).collection('requests').doc(request.uid)
      .update({status: 'rejected'});
  };

  // ── Disconnect one listener (connected or mid-handshake) ─────────────────

  const disconnectListener = useCallback(async listenerUid => {
    clearTimeout(iceTimeouts.current[listenerUid]);
    delete iceTimeouts.current[listenerUid];

    const existingPc = peerConnections.current[listenerUid];
    if (existingPc && existingPc !== 'pending') closePeerConnection(existingPc);
    delete peerConnections.current[listenerUid];

    const unsubs = signalingUnsubs.current[listenerUid];
    if (unsubs) { unsubs.forEach(fn => fn()); delete signalingUnsubs.current[listenerUid]; }

    await clearListenerSignaling(roomCode, listenerUid);
    await firestore()
      .collection('rooms').doc(roomCode).collection('requests').doc(listenerUid)
      .update({status: 'removed'});

    setConnectedListeners(prev => prev.filter(l => l.uid !== listenerUid));
    setAcceptedPending(prev => prev.filter(l => l.uid !== listenerUid));
  }, [roomCode]);

  // ── Disconnect all ───────────────────────────────────────────────────────

  const confirmDisconnectAll = useCallback(() => {
    const total = connectedListeners.length + acceptedPending.length;
    if (total === 0) return;
    Alert.alert(
      'Disconnect Everyone?',
      `Remove all ${total} listener${total === 1 ? '' : 's'} from your room?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: `Disconnect All (${total})`,
          style: 'destructive',
          onPress: async () => {
            const allUids = [
              ...connectedListeners.map(l => l.uid),
              ...acceptedPending.map(l => l.uid),
            ];
            await Promise.all(allUids.map(u => disconnectListener(u)));
          },
        },
      ],
    );
  }, [connectedListeners, acceptedPending, disconnectListener]);

  // ── Full cleanup ─────────────────────────────────────────────────────────
  // FIX #8: Defined as a stable function and stored in cleanupRef each render.

  const cleanup = useCallback(async () => {
    if (cleanedUp.current) return;
    cleanedUp.current = true;

    Object.values(iceTimeouts.current).forEach(clearTimeout);
    iceTimeouts.current = {};

    Object.entries(peerConnections.current).forEach(([, conn]) => {
      if (conn && conn !== 'pending') closePeerConnection(conn);
    });
    peerConnections.current = {};

    Object.values(signalingUnsubs.current).forEach(unsubs => unsubs.forEach(fn => fn()));
    signalingUnsubs.current = {};

    stopStream(audioStream.current);
    audioStream.current = null;

    if (roomCode) {
      await clearRoomSignaling(roomCode);
      await firestore().collection('rooms').doc(roomCode).update({active: false, streaming: false});
    }
  }, [roomCode]);

  // Keep refs current every render (FIX #8, #9).
  cleanupRef.current = cleanup;

  // ── confirmStop ──────────────────────────────────────────────────────────
  // FIX #9: Stored in a ref so BackHandler always gets the latest version.

  const confirmStop = useCallback(() => {
    Alert.alert(
      'Stop Broadcasting?',
      'The room will close and all listeners will be disconnected.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Stop & Close',
          style: 'destructive',
          onPress: async () => { await cleanup(); navigation.replace('Home'); },
        },
      ],
    );
  }, [cleanup, navigation]);

  confirmStopRef.current = confirmStop; // FIX #9

  const copyRoomCode = useCallback(() => {
    if (!roomCode) return;
    NativeModules.SyncBeatClipboard?.copyText(roomCode);
    ToastAndroid.show('Room code copied', ToastAndroid.SHORT);
  }, [roomCode]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const totalActive = connectedListeners.length + acceptedPending.length;

  // ── Render: name modal ───────────────────────────────────────────────────

  if (showNameModal) {
    return (
      <SafeAreaView style={styles.container}>
        <Modal visible transparent animationType="fade" onRequestClose={() => navigation.goBack()}>
          <KeyboardAvoidingView style={styles.modalOverlay} behavior="padding">
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Your Name</Text>
              <Text style={styles.modalSub}>Listeners will see this as the host name.</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. Arjun"
                placeholderTextColor="#4A4869"
                value={hostNameInput}
                onChangeText={setHostNameInput}
                maxLength={24}
                autoFocus
                onSubmitEditing={handleNameConfirm}
              />
              <TouchableOpacity style={styles.modalBtn} onPress={handleNameConfirm}>
                <Text style={styles.modalBtnText}>Create Room →</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCancel} onPress={() => navigation.goBack()}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    );
  }

  if (loading || !roomReady) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color="#6C63FF" />
          <Text style={styles.loaderText}>Setting up your room…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: main ─────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={confirmStop}>
          <Text style={styles.stopText}>✕ Stop</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Host Room</Text>
        {totalActive > 0 ? (
          <TouchableOpacity style={styles.disconnectAllBtn} onPress={confirmDisconnectAll}>
            <Text style={styles.disconnectAllText}>Kick All</Text>
          </TouchableOpacity>
        ) : (
          <View style={{width: 60}} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Room code */}
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>ROOM CODE</Text>
          <TouchableOpacity onPress={copyRoomCode} activeOpacity={0.75}>
            <Text style={styles.codeValue}>{roomCode}</Text>
          </TouchableOpacity>
          <Text style={styles.codeHint}>Share this code with your friends</Text>
          <Text style={styles.hostNameBadge}>Hosting as {hostName}</Text>
        </View>

        {/* Stream toggle */}
        {!isStreaming ? (
          <TouchableOpacity style={styles.startBtn} onPress={startStreaming} disabled={loading} activeOpacity={0.85}>
            {loading ? <ActivityIndicator color="#FFF" /> : (
              <>
                <Text style={styles.startBtnIcon}>📡</Text>
                <Text style={styles.startBtnText}>Start Broadcasting</Text>
                <Text style={styles.startBtnSub}>Android will ask permission to capture audio</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.liveBar}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE · Broadcasting system audio</Text>
            <AudioVisualizer />
          </View>
        )}

        {/* Pending requests */}
        {pendingRequests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending Requests ({pendingRequests.length})</Text>
            {pendingRequests.map(req => (
              <View key={req.uid} style={styles.requestRow}>
                <View style={styles.requestAvatar}>
                  <Text style={styles.requestAvatarText}>
                    {(req.displayName || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.requestName} numberOfLines={1}>{req.displayName}</Text>
                <TouchableOpacity style={styles.rejectBtn} onPress={() => rejectListener(req)}>
                  <Text style={styles.rejectBtnText}>✕</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.acceptBtn, !isStreaming && styles.btnDisabled]}
                  disabled={!isStreaming}
                  onPress={() => acceptListener(req)}>
                  <Text style={styles.acceptBtnText}>Accept</Text>
                </TouchableOpacity>
              </View>
            ))}
            {!isStreaming && (
              <Text style={styles.warningText}>⚠ Start broadcasting before accepting listeners</Text>
            )}
          </View>
        )}

        {/* Accepted / connecting */}
        {acceptedPending.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Connecting… ({acceptedPending.length})</Text>
            {acceptedPending.map(listener => (
              <View key={listener.uid} style={styles.connectingRow}>
                <View style={styles.connectingAvatar}>
                  <Text style={styles.connectingAvatarText}>
                    {(listener.name || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.connectingInfo}>
                  <Text style={styles.connectingName}>{listener.name}</Text>
                  <Text style={styles.connectingStatus}>Setting up audio… (60s timeout)</Text>
                </View>
                <TouchableOpacity
                  style={styles.kickConnectingBtn}
                  onPress={() =>
                    Alert.alert('Cancel Connection?', `Disconnect ${listener.name}?`, [
                      {text: 'Cancel', style: 'cancel'},
                      {text: 'Disconnect', style: 'destructive', onPress: () => disconnectListener(listener.uid)},
                    ])
                  }>
                  <Text style={styles.kickConnectingText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Connected */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Listening Now ({connectedListeners.length})</Text>
            {connectedListeners.length > 1 && (
              <TouchableOpacity onPress={confirmDisconnectAll}>
                <Text style={styles.disconnectAllInline}>Disconnect All</Text>
              </TouchableOpacity>
            )}
          </View>
          {connectedListeners.length === 0 ? (
            <Text style={styles.emptyText}>No one connected yet. Accept requests above.</Text>
          ) : (
            connectedListeners.map(listener => (
              <ListenerCard
                key={listener.uid}
                listener={listener}
                onDisconnect={() => disconnectListener(listener.uid)}
              />
            ))
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    {flex: 1, backgroundColor: '#0F0F1A'},
  scroll:       {paddingBottom: 40},
  centerLoader: {flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16},
  loaderText:   {color: '#8884A8', fontSize: 14},
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1E1B3A',
  },
  headerTitle:       {color: '#FFF', fontSize: 16, fontWeight: '700'},
  stopText:          {color: '#FF4D6D', fontSize: 14, fontWeight: '600'},
  disconnectAllBtn:  {
    backgroundColor: '#2A1525', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#FF4D6D',
  },
  disconnectAllText: {color: '#FF4D6D', fontSize: 12, fontWeight: '700'},
  codeCard: {
    margin: 20, backgroundColor: '#1A1535', borderRadius: 16,
    padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#6C63FF',
  },
  codeLabel:     {fontSize: 11, fontWeight: '800', color: '#6C63FF', letterSpacing: 2, marginBottom: 8},
  codeValue:     {fontSize: 40, fontWeight: '900', color: '#FFFFFF', letterSpacing: 10},
  codeHint:      {fontSize: 12, color: '#8884A8', marginTop: 8},
  hostNameBadge: {fontSize: 12, color: '#6C63FF', marginTop: 6, fontWeight: '600'},
  startBtn:      {marginHorizontal: 20, backgroundColor: '#6C63FF', borderRadius: 16, padding: 20, alignItems: 'center'},
  startBtnIcon:  {fontSize: 28, marginBottom: 6},
  startBtnText:  {color: '#FFF', fontSize: 18, fontWeight: '700'},
  startBtnSub:   {color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4},
  liveBar: {
    marginHorizontal: 20, backgroundColor: '#0D2B1D', borderRadius: 12,
    padding: 14, flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#2ECC71', gap: 10,
  },
  liveDot:   {width: 10, height: 10, borderRadius: 5, backgroundColor: '#2ECC71'},
  liveText:  {color: '#2ECC71', fontSize: 13, fontWeight: '700', flex: 1},
  section:   {marginHorizontal: 20, marginTop: 24},
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10,
  },
  sectionTitle:        {color: '#8884A8', fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase'},
  disconnectAllInline: {color: '#FF4D6D', fontSize: 12, fontWeight: '700'},
  requestRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1535',
    borderRadius: 12, padding: 12, marginBottom: 8, gap: 10,
    borderWidth: 1, borderColor: '#2E2B4A',
  },
  requestAvatar:     {width: 36, height: 36, borderRadius: 18, backgroundColor: '#6C63FF', justifyContent: 'center', alignItems: 'center'},
  requestAvatarText: {color: '#FFF', fontWeight: '800', fontSize: 16},
  requestName:       {flex: 1, color: '#FFF', fontSize: 15, fontWeight: '600'},
  rejectBtn:         {backgroundColor: '#2A1525', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: '#FF4D6D'},
  rejectBtnText:     {color: '#FF4D6D', fontWeight: '700'},
  acceptBtn:         {backgroundColor: '#6C63FF', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7},
  btnDisabled:       {opacity: 0.4},
  acceptBtnText:     {color: '#FFF', fontWeight: '700', fontSize: 14},
  warningText:       {color: '#EF9F27', fontSize: 12, marginTop: 4},
  connectingRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#12112A',
    borderRadius: 12, padding: 12, marginBottom: 8, gap: 12,
    borderWidth: 1, borderColor: '#EF9F27',
  },
  connectingAvatar:     {width: 42, height: 42, borderRadius: 21, backgroundColor: '#EF9F27', justifyContent: 'center', alignItems: 'center'},
  connectingAvatarText: {color: '#FFF', fontWeight: '800', fontSize: 17},
  connectingInfo:       {flex: 1},
  connectingName:       {color: '#FFF', fontSize: 15, fontWeight: '600'},
  connectingStatus:     {color: '#EF9F27', fontSize: 12, marginTop: 2},
  kickConnectingBtn:    {width: 32, height: 32, borderRadius: 16, backgroundColor: '#2A1525', borderWidth: 1, borderColor: '#FF4D6D', justifyContent: 'center', alignItems: 'center'},
  kickConnectingText:   {color: '#FF4D6D', fontWeight: '800', fontSize: 14},
  emptyText: {color: '#4A4869', fontSize: 13, fontStyle: 'italic', marginTop: 4},
  modalOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24},
  modalCard:    {backgroundColor: '#1A1535', borderRadius: 20, padding: 28, width: '100%', borderWidth: 1, borderColor: '#6C63FF', gap: 12},
  modalTitle:   {color: '#FFF', fontSize: 22, fontWeight: '800', textAlign: 'center'},
  modalSub:     {color: '#8884A8', fontSize: 14, textAlign: 'center', lineHeight: 20},
  modalInput:   {backgroundColor: '#0F0F1A', borderRadius: 12, borderWidth: 1, borderColor: '#2E2B4A', paddingHorizontal: 16, paddingVertical: 14, color: '#FFF', fontSize: 16, marginTop: 4},
  modalBtn:     {backgroundColor: '#6C63FF', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4},
  modalBtnText: {color: '#FFF', fontSize: 16, fontWeight: '700'},
  modalCancel:  {alignItems: 'center', paddingVertical: 8},
  modalCancelText: {color: '#8884A8', fontSize: 14},
});
