// src/screens/ListenerRoomScreen.js
//
// FIX #7:  startListening is no longer wrapped in useCallback. It is defined
//          inline inside the Firestore snapshot effect, so it always captures
//          fresh roomCode/uid values and there is no stale-closure risk.
// FIX #8:  cleanup is stored in cleanupRef so the unmount effect and BackHandler
//          always call the latest version.
// FIX #11: A 30-second ICE timeout moves the user to a TIMED_OUT error state
//          if the WebRTC connection never reaches 'connected', instead of
//          leaving them on the "Connecting…" spinner indefinitely.

import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, BackHandler,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';

import {
  createListenerPeerConnection,
  processOffer,
  addHostIceCandidate,
  closePeerConnection,
  isPeerConnected,
} from '../services/webrtcService';
import {
  listenForOffer,
  saveAnswer,
  saveListenerCandidate,
  listenForHostCandidates,
  clearListenerSignaling,
} from '../services/signalingService';
import AudioVisualizer from '../components/AudioVisualizer';

const STATUS = {
  WAITING_APPROVAL: 'waiting_approval',
  REJECTED:         'rejected',
  CONNECTING:       'connecting',
  CONNECTED:        'connected',
  DISCONNECTED:     'disconnected',
  HOST_OFFLINE:     'host_offline',
  TIMED_OUT:        'timed_out',    // FIX #11
};

const ICE_TIMEOUT_MS = 60000;

export default function ListenerRoomScreen({route, navigation}) {
  const {roomCode, displayName} = route.params;
  const [status, setStatus] = useState(STATUS.WAITING_APPROVAL);

  const pc             = useRef(null);
  const signalingUnsubs = useRef([]);
  const acceptedRef    = useRef(false);
  const cleanedUp      = useRef(false);
  const iceTimeout     = useRef(null); // FIX #11
  const cleanupRef     = useRef(null); // FIX #8

  const uid = auth().currentUser?.uid;

  // ── Watch request status ──────────────────────────────────────────────────
  // FIX #7: startListening is defined inline here — no useCallback, no stale closure.

  useEffect(() => {
    const startListening = async () => {
      try {
        await firestore()
          .collection('rooms').doc(roomCode).collection('requests').doc(uid)
          .update({connectionDebug: 'listener_creating_peer'});

        // FIX #1: createListenerPeerConnection is now async (fetches TURN creds).
        const peerConn = await createListenerPeerConnection({
          onIceCandidate: candidate => saveListenerCandidate(roomCode, uid, candidate),
          onTrack: _stream => setStatus(STATUS.CONNECTED),
          onConnectionStateChange: state => {
            firestore()
              .collection('rooms').doc(roomCode).collection('requests').doc(uid)
              .update({listenerConnectionState: state})
              .catch(() => {});

            if (state === 'connected') {
              // FIX #11: Clear ICE timeout on success.
              clearTimeout(iceTimeout.current);
              setStatus(STATUS.CONNECTED);
            } else if (state === 'disconnected' || state === 'failed') {
              clearTimeout(iceTimeout.current);
              setStatus(STATUS.DISCONNECTED);
            }
          },
        });

        pc.current = peerConn;

        const unsubOffer = listenForOffer(roomCode, uid, async offer => {
          try {
            const answer = await processOffer(peerConn, offer);
            if (answer) {
              await saveAnswer(roomCode, uid, answer);
              await firestore()
                .collection('rooms').doc(roomCode).collection('requests').doc(uid)
                .update({connectionDebug: 'answer_saved'});
            }
          } catch (e) {
            await firestore()
              .collection('rooms').doc(roomCode).collection('requests').doc(uid)
              .update({connectionDebug: `listener_process_offer_failed: ${e.message}`})
              .catch(() => {});
            setStatus(STATUS.TIMED_OUT);
          }
        });

        const unsubCandidates = listenForHostCandidates(roomCode, uid, candidate => {
          addHostIceCandidate(peerConn, candidate);
        });

        signalingUnsubs.current = [unsubOffer, unsubCandidates];

        // FIX #11: Auto-fail after 60 s if still not connected.
        iceTimeout.current = setTimeout(() => {
          if (!isPeerConnected(pc.current)) {
            firestore()
              .collection('rooms').doc(roomCode).collection('requests').doc(uid)
              .update({connectionDebug: 'listener_ice_timeout'})
              .catch(() => {});
            setStatus(STATUS.TIMED_OUT);
            cleanupRef.current?.();
          }
        }, ICE_TIMEOUT_MS);
      } catch (e) {
        await firestore()
          .collection('rooms').doc(roomCode).collection('requests').doc(uid)
          .update({connectionDebug: `listener_start_failed: ${e.message}`})
          .catch(() => {});
        setStatus(STATUS.TIMED_OUT);
      }
    };

    const unsub = firestore()
      .collection('rooms').doc(roomCode).collection('requests').doc(uid)
      .onSnapshot(snap => {
        const data = snap.data();
        if (!data) return;
        if (data.status === 'accepted' && !acceptedRef.current) {
          acceptedRef.current = true;
          setStatus(STATUS.CONNECTING);
          startListening(); // FIX #7: fresh closure, no stale values
        } else if (data.status === 'rejected') {
          setStatus(STATUS.REJECTED);
        } else if (data.status === 'removed') {
          setStatus(STATUS.DISCONNECTED);
          cleanupRef.current?.();
        }
      });

    return unsub;
  }, [roomCode, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Watch room active status ──────────────────────────────────────────────

  useEffect(() => {
    const unsub = firestore()
      .collection('rooms').doc(roomCode)
      .onSnapshot(snap => {
        const data = snap.data();
        if (data && !data.active) {
          setStatus(STATUS.HOST_OFFLINE);
          cleanupRef.current?.();
        }
      });
    return unsub;
  }, [roomCode]);

  // ── Back handler — always latest via ref (FIX #8) ────────────────────────

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmLeave();
      return true;
    });
    return () => handler.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Unmount cleanup — always latest via ref (FIX #8) ────────────────────

  useEffect(() => {
    return () => { cleanupRef.current?.(); };
  }, []);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  const cleanup = useCallback(async () => {
    if (cleanedUp.current) return;
    cleanedUp.current = true;

    clearTimeout(iceTimeout.current);
    signalingUnsubs.current.forEach(fn => fn());
    signalingUnsubs.current = [];
    closePeerConnection(pc.current);
    pc.current = null;

    try {
      await clearListenerSignaling(roomCode, uid);
    } catch (_) {
      // Room may already be gone.
    }
  }, [roomCode, uid]);

  // Keep cleanupRef current every render (FIX #8).
  cleanupRef.current = cleanup;

  // ── Leave ─────────────────────────────────────────────────────────────────

  const confirmLeave = useCallback(() => {
    Alert.alert('Leave Room?', 'You will stop listening.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await cleanup();
          try {
            await firestore()
              .collection('rooms').doc(roomCode).collection('requests').doc(uid)
              .update({status: 'left'});
          } catch (_) {}
          navigation.replace('Home');
        },
      },
    ]);
  }, [cleanup, roomCode, uid, navigation]);

  // ── Render ────────────────────────────────────────────────────────────────

  const renderContent = () => {
    switch (status) {
      case STATUS.WAITING_APPROVAL:
        return (
          <View style={styles.statusCard}>
            <Text style={styles.statusIcon}>⏳</Text>
            <Text style={styles.statusTitle}>Waiting for approval</Text>
            <Text style={styles.statusDesc}>The host will see your request and accept or reject it.</Text>
            <View style={styles.pulse} />
          </View>
        );

      case STATUS.REJECTED:
        return (
          <View style={styles.statusCard}>
            <Text style={styles.statusIcon}>❌</Text>
            <Text style={[styles.statusTitle, {color: '#FF4D6D'}]}>Request Rejected</Text>
            <Text style={styles.statusDesc}>The host declined your request to join.</Text>
            <TouchableOpacity style={styles.homeBtn} onPress={() => navigation.replace('Home')}>
              <Text style={styles.homeBtnText}>Back to Home</Text>
            </TouchableOpacity>
          </View>
        );

      case STATUS.CONNECTING:
        return (
          <View style={styles.statusCard}>
            <Text style={styles.statusIcon}>🔗</Text>
            <Text style={styles.statusTitle}>Connecting…</Text>
            <Text style={styles.statusDesc}>Setting up audio stream. This takes a few seconds (up to 60s).</Text>
          </View>
        );

      case STATUS.CONNECTED:
        return (
          <View style={styles.connectedCard}>
            <View style={styles.liveIndicator}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>CONNECTED · Listening live</Text>
            </View>
            <Text style={styles.connectedIcon}>🎧</Text>
            <Text style={styles.connectedTitle}>You're in!</Text>
            <Text style={styles.connectedDesc}>
              Audio from <Text style={styles.highlight}>{roomCode}</Text> is playing
              through your device.
            </Text>
            <AudioVisualizer active />
            <View style={styles.tipBox}>
              <Text style={styles.tipText}>
                💡 Tip: Connect your Bluetooth speaker now — audio will automatically route to it.
              </Text>
            </View>
          </View>
        );

      case STATUS.DISCONNECTED:
        return (
          <View style={styles.statusCard}>
            <Text style={styles.statusIcon}>🔌</Text>
            <Text style={[styles.statusTitle, {color: '#EF9F27'}]}>Disconnected</Text>
            <Text style={styles.statusDesc}>You were removed from the room by the host.</Text>
            <TouchableOpacity style={styles.homeBtn} onPress={() => navigation.replace('Home')}>
              <Text style={styles.homeBtnText}>Back to Home</Text>
            </TouchableOpacity>
          </View>
        );

      case STATUS.HOST_OFFLINE:
        return (
          <View style={styles.statusCard}>
            <Text style={styles.statusIcon}>📴</Text>
            <Text style={[styles.statusTitle, {color: '#8884A8'}]}>Host Stopped</Text>
            <Text style={styles.statusDesc}>The host ended the broadcast.</Text>
            <TouchableOpacity style={styles.homeBtn} onPress={() => navigation.replace('Home')}>
              <Text style={styles.homeBtnText}>Back to Home</Text>
            </TouchableOpacity>
          </View>
        );

      // FIX #11: New state shown when ICE negotiation times out.
      case STATUS.TIMED_OUT:
        return (
          <View style={styles.statusCard}>
            <Text style={styles.statusIcon}>⏱</Text>
            <Text style={[styles.statusTitle, {color: '#FF4D6D'}]}>Connection Timed Out</Text>
            <Text style={styles.statusDesc}>
              Could not establish an audio stream after 60 seconds. This is usually caused by a
              strict firewall or mobile data NAT. Try switching to WiFi and joining again.
            </Text>
            <TouchableOpacity style={styles.homeBtn} onPress={() => navigation.replace('Home')}>
              <Text style={styles.homeBtnText}>Back to Home</Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={confirmLeave}>
          <Text style={styles.leaveText}>← Leave</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Room · {roomCode}</Text>
        <View style={{width: 60}} />
      </View>
      <View style={styles.userTag}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.userName}>{displayName}</Text>
      </View>
      {renderContent()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   {flex: 1, backgroundColor: '#0F0F1A'},
  header:      {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E1B3A'},
  headerTitle: {color: '#FFF', fontSize: 16, fontWeight: '700'},
  leaveText:   {color: '#8884A8', fontSize: 14},
  userTag:     {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 10},
  avatar:      {width: 32, height: 32, borderRadius: 16, backgroundColor: '#2ECC71', justifyContent: 'center', alignItems: 'center'},
  avatarText:  {color: '#FFF', fontWeight: '800'},
  userName:    {color: '#FFF', fontSize: 15, fontWeight: '600'},
  statusCard:  {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12},
  statusIcon:  {fontSize: 56, marginBottom: 8},
  statusTitle: {color: '#FFF', fontSize: 22, fontWeight: '800', textAlign: 'center'},
  statusDesc:  {color: '#8884A8', fontSize: 14, textAlign: 'center', lineHeight: 22},
  pulse:       {width: 20, height: 20, borderRadius: 10, backgroundColor: '#6C63FF', marginTop: 16, opacity: 0.8},
  homeBtn:     {marginTop: 16, backgroundColor: '#1A1535', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderColor: '#6C63FF'},
  homeBtnText: {color: '#6C63FF', fontWeight: '700'},
  connectedCard:  {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 14},
  liveIndicator:  {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0D2B1D', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: '#2ECC71'},
  liveDot:        {width: 8, height: 8, borderRadius: 4, backgroundColor: '#2ECC71'},
  liveText:       {color: '#2ECC71', fontSize: 12, fontWeight: '700'},
  connectedIcon:  {fontSize: 64, marginTop: 8},
  connectedTitle: {color: '#FFF', fontSize: 28, fontWeight: '800'},
  connectedDesc:  {color: '#8884A8', fontSize: 14, textAlign: 'center', lineHeight: 22},
  highlight:      {color: '#6C63FF', fontWeight: '700'},
  tipBox:         {backgroundColor: '#1A1535', borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: '#6C63FF', width: '100%', marginTop: 8},
  tipText:        {color: '#8884A8', fontSize: 13, lineHeight: 20},
});
