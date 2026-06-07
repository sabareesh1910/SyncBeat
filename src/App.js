// src/App.js
//
// FIX #15: Eliminated redundant auth initialization race.
// Previously, signIn() and onAuthStateChanged both called setInitializing(false)
// independently. Now onAuthStateChanged is the single source of truth for auth
// state. signIn() only triggers the anonymous sign-in if needed, and never
// touches initializing state. This prevents the app from rendering without a
// UID if signIn() rejects before onAuthStateChanged fires.

import React, {useEffect, useRef, useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import {ActivityIndicator, View, Text, TouchableOpacity, StyleSheet} from 'react-native';

import HomeScreen from './screens/HomeScreen';
import HostRoomScreen from './screens/HostRoomScreen';
import ListenerRoomScreen from './screens/ListenerRoomScreen';
import JoinRoomScreen from './screens/JoinRoomScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser]                 = useState(null);
  const [authError, setAuthError]       = useState(false);
  // Ref so the onAuthStateChanged callback always reads the latest value
  // without causing the effect to re-run.
  const initializingRef = useRef(true);

  useEffect(() => {
    // FIX #15: onAuthStateChanged is the ONLY place that sets initializing=false.
    // This guarantees we never render the navigator without knowing auth state.
    const unsubscribe = auth().onAuthStateChanged(async firebaseUser => {
      setUser(firebaseUser);

      if (!firebaseUser) {
        // No session — attempt anonymous sign-in.
        try {
          await auth().signInAnonymously();
          // onAuthStateChanged will fire again with the new user — don't
          // setInitializing(false) here; wait for that second callback.
        } catch (e) {
          console.error('Anonymous sign-in failed:', e);
          // Only mark initializing done on failure so the error UI renders.
          setAuthError(true);
          if (initializingRef.current) {
            initializingRef.current = false;
            setInitializing(false);
          }
        }
      } else {
        // We have a user (either existing session or freshly signed in).
        if (initializingRef.current) {
          initializingRef.current = false;
          setInitializing(false);
        }
      }
    });

    return unsubscribe;
  }, []);

  if (initializing) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  if (authError || !user) {
    return (
      <View style={styles.loader}>
        <Text style={styles.errorText}>⚠ Could not connect to servers.</Text>
        <Text style={styles.errorSub}>Check your internet connection and restart the app.</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => {
            setAuthError(false);
            initializingRef.current = true;
            setInitializing(true);
            auth().signInAnonymously().catch(() => {
              setAuthError(true);
              setInitializing(false);
            });
          }}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}>
          <Stack.Screen name="Home"         component={HomeScreen} />
          <Stack.Screen name="JoinRoom"     component={JoinRoomScreen} />
          <Stack.Screen name="HostRoom"     component={HostRoomScreen} />
          <Stack.Screen name="ListenerRoom" component={ListenerRoomScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F0F1A',
    gap: 12,
    paddingHorizontal: 32,
  },
  errorText: {color: '#FF4D6D', fontSize: 18, fontWeight: '700', textAlign: 'center'},
  errorSub:  {color: '#8884A8', fontSize: 14, textAlign: 'center', lineHeight: 22},
  retryBtn:  {
    marginTop: 8,
    backgroundColor: '#6C63FF',
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  retryText: {color: '#FFF', fontWeight: '700', fontSize: 15},
});
