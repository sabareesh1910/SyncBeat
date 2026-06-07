// src/screens/HomeScreen.js
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Image,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

export default function HomeScreen({navigation}) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F0F1A" />

      <View style={styles.hero}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoEmoji}>🎵</Text>
        </View>
        <Text style={styles.appName}>SyncBeat</Text>
        <Text style={styles.tagline}>
          Share your phone's audio with everyone, anywhere
        </Text>
      </View>

      <View style={styles.cards}>
        {/* HOST card */}
        <TouchableOpacity
          style={[styles.card, styles.cardHost]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('HostRoom')}>
          <Text style={styles.cardIcon}>📡</Text>
          <Text style={styles.cardTitle}>Create Room</Text>
          <Text style={styles.cardDesc}>
            Broadcast your phone's audio — music, reels, anything — to
            connected listeners worldwide.
          </Text>
          <View style={styles.cardBadge}>
            <Text style={styles.cardBadgeText}>HOST</Text>
          </View>
        </TouchableOpacity>

        {/* LISTENER card */}
        <TouchableOpacity
          style={[styles.card, styles.cardListener]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('JoinRoom')}>
          <Text style={styles.cardIcon}>🎧</Text>
          <Text style={styles.cardTitle}>Join Room</Text>
          <Text style={styles.cardDesc}>
            Enter a room code and listen to your host's audio through your
            speaker or headphones.
          </Text>
          <View style={[styles.cardBadge, styles.cardBadgeGreen]}>
            <Text style={styles.cardBadgeText}>LISTENER</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>
        Works over WiFi or mobile data · No Bluetooth pairing needed
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
    paddingHorizontal: 24,
  },
  hero: {
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 32,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1E1B3A',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#6C63FF',
  },
  logoEmoji: {fontSize: 36},
  appName: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 14,
    color: '#8884A8',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  cards: {
    flex: 1,
    gap: 16,
  },
  card: {
    borderRadius: 20,
    padding: 24,
    position: 'relative',
    overflow: 'hidden',
  },
  cardHost: {
    backgroundColor: '#1A1535',
    borderWidth: 1,
    borderColor: '#6C63FF',
  },
  cardListener: {
    backgroundColor: '#0F2318',
    borderWidth: 1,
    borderColor: '#2ECC71',
  },
  cardIcon: {fontSize: 36, marginBottom: 12},
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 14,
    color: '#9996B8',
    lineHeight: 21,
  },
  cardBadge: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: '#6C63FF',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cardBadgeGreen: {
    backgroundColor: '#2ECC71',
  },
  cardBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  footer: {
    textAlign: 'center',
    color: '#4A4869',
    fontSize: 12,
    paddingVertical: 20,
  },
});
