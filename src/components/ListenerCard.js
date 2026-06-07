// src/components/ListenerCard.js
//
// Shows a connected listener row in the host's screen.
// The host can disconnect any individual listener by tapping the
// disconnect button — a confirmation dialog appears first.
// The card also shows connection duration since the listener connected.

import React, {useEffect, useState} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, Alert} from 'react-native';

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

export default function ListenerCard({listener, onDisconnect}) {
  const [elapsed, setElapsed] = useState(0);

  // Tick a connection-duration timer every second.
  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const confirmDisconnect = () => {
    Alert.alert(
      'Disconnect Listener?',
      `Remove ${listener.name} from the room? They will be notified and their audio will stop.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: onDisconnect,
        },
      ],
    );
  };

  return (
    <View style={styles.card}>
      {/* Avatar */}
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {(listener.name || '?').charAt(0).toUpperCase()}
        </Text>
      </View>

      {/* Name + status */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {listener.name}
        </Text>
        <View style={styles.statusRow}>
          <View style={styles.dot} />
          <Text style={styles.statusText}>
            Listening · {formatDuration(elapsed)}
          </Text>
        </View>
      </View>

      {/* Disconnect button */}
      <TouchableOpacity style={styles.disconnectBtn} onPress={confirmDisconnect}>
        <Text style={styles.disconnectIcon}>✕</Text>
        <Text style={styles.disconnectText}>Kick</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1535',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: '#2E2B4A',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#2ECC71',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {color: '#FFF', fontWeight: '800', fontSize: 17},
  info: {flex: 1},
  name: {color: '#FFF', fontSize: 15, fontWeight: '600'},
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#2ECC71',
  },
  statusText: {color: '#2ECC71', fontSize: 12},
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#2A1525',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#FF4D6D',
  },
  disconnectIcon: {color: '#FF4D6D', fontSize: 11, fontWeight: '800'},
  disconnectText: {color: '#FF4D6D', fontSize: 13, fontWeight: '700'},
});
