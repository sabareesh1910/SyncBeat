// src/screens/JoinRoomScreen.js
//
// FIX #13: If the room exists but streaming:false, the user now sees a clear
//          warning and can choose to wait (their request is still submitted)
//          or cancel. Previously they'd be admitted and stuck on "Connecting…"
//          with no explanation.
// FIX #14: displayName is sanitised — stripped of control characters and
//          RTL/LTR override Unicode characters that can break UI layout.

import React, {useState} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';

// FIX #14: Strip control characters (0x00–0x1F, 0x7F) and Unicode
// bidirectional override codepoints that can flip text direction in the UI.
function sanitizeName(raw) {
  return raw
    .trim()
    // Remove ASCII control chars
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Remove Unicode bidi override characters
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();
}

export default function JoinRoomScreen({navigation}) {
  const [roomCode, setRoomCode]       = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading]         = useState(false);

  const handleJoin = async () => {
    const code = roomCode.trim().toUpperCase();
    // FIX #14: Sanitise before validation.
    const name = sanitizeName(displayName);

    if (code.length !== 6) {
      Alert.alert('Invalid Code', 'Room codes are 6 characters long.');
      return;
    }
    if (name.length === 0) {
      Alert.alert('Name Required', 'Please enter a valid display name.');
      return;
    }

    setLoading(true);
    try {
      const roomDoc = await firestore().collection('rooms').doc(code).get();

      if (!roomDoc.exists) {
        Alert.alert('Room Not Found', 'No room with that code exists.');
        setLoading(false);
        return;
      }

      const roomData = roomDoc.data();

      if (!roomData.active) {
        Alert.alert('Room Closed', 'This room is no longer active.');
        setLoading(false);
        return;
      }

      const uid = auth().currentUser.uid;

      if (uid === roomData.hostUid) {
        Alert.alert('You are the host', 'You cannot join your own room as a listener.');
        setLoading(false);
        return;
      }

      // FIX #13: Room exists and is active but host hasn't started streaming yet.
      // Warn the user — give them the choice to wait or cancel.
      if (!roomData.streaming) {
        setLoading(false);
        Alert.alert(
          'Host Not Broadcasting Yet',
          `${roomData.hostName || 'The host'} has created the room but hasn't started broadcasting yet.\n\nYour request will be sent now. Once the host starts broadcasting and accepts you, audio will begin automatically.`,
          [
            {text: 'Cancel', style: 'cancel'},
            {
              text: 'Send Request Anyway',
              onPress: () => submitRequest(code, name, uid, roomData),
            },
          ],
        );
        return;
      }

      await submitRequest(code, name, uid, roomData);
    } catch (e) {
      Alert.alert('Error', e.message);
      setLoading(false);
    }
  };

  const submitRequest = async (code, name, uid, roomData) => {
    setLoading(true);
    try {
      await firestore()
        .collection('rooms').doc(code).collection('requests').doc(uid)
        .set({
          uid,
          displayName: name,
          status: 'pending',
          requestedAt: firestore.FieldValue.serverTimestamp(),
          offer: null,
          answer: null,
          hostCandidates: [],
          listenerCandidates: [],
          connectionDebug: 'request_created',
        });

      navigation.replace('ListenerRoom', {
        roomCode: code,
        displayName: name,
        hostUid: roomData.hostUid,
      });
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.inner} behavior="padding">
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Join a Room</Text>
        <Text style={styles.subtitle}>Get the 6-character code from the host</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Your Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Rahul"
            placeholderTextColor="#4A4869"
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={24}
            returnKeyType="next"
          />

          <Text style={styles.label}>Room Code</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            placeholder="e.g. JAZZ42"
            placeholderTextColor="#4A4869"
            value={roomCode}
            onChangeText={t => setRoomCode(t.toUpperCase())}
            maxLength={6}
            autoCapitalize="characters"
            returnKeyType="done"
            onSubmitEditing={handleJoin}
          />

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleJoin}
            disabled={loading}
            activeOpacity={0.85}>
            {loading ? <ActivityIndicator color="#FFF" /> : (
              <Text style={styles.btnText}>Request to Join →</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            💡 After you request to join, the host will see your name and approve or reject you.
            Once approved, audio starts playing automatically.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0F0F1A'},
  inner:     {flex: 1, paddingHorizontal: 24},
  backBtn:   {paddingVertical: 16},
  backText:  {color: '#6C63FF', fontSize: 16},
  title:     {fontSize: 28, fontWeight: '800', color: '#FFFFFF', marginTop: 8},
  subtitle:  {fontSize: 14, color: '#8884A8', marginTop: 6, marginBottom: 32},
  form:      {gap: 8},
  label:     {fontSize: 13, color: '#8884A8', marginBottom: 4, marginTop: 12, fontWeight: '600', letterSpacing: 0.5},
  input:     {backgroundColor: '#1A1535', borderRadius: 12, borderWidth: 1, borderColor: '#2E2B4A', paddingHorizontal: 16, paddingVertical: 14, color: '#FFFFFF', fontSize: 16},
  codeInput: {fontSize: 24, fontWeight: '800', letterSpacing: 8, textAlign: 'center', color: '#6C63FF'},
  btn:        {backgroundColor: '#6C63FF', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 24},
  btnDisabled:{opacity: 0.5},
  btnText:    {color: '#FFF', fontSize: 16, fontWeight: '700'},
  infoBox:    {marginTop: 32, backgroundColor: '#1A1535', borderRadius: 12, padding: 16, borderLeftWidth: 3, borderLeftColor: '#6C63FF'},
  infoText:   {color: '#8884A8', fontSize: 13, lineHeight: 20},
});
