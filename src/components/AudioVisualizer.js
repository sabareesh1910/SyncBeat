// src/components/AudioVisualizer.js
import React, {useEffect, useRef} from 'react';
import {View, Animated, StyleSheet} from 'react-native';

const BAR_COUNT = 12;

export default function AudioVisualizer({active = true}) {
  const animations = useRef(
    Array.from({length: BAR_COUNT}, () => new Animated.Value(0.2)),
  ).current;

  useEffect(() => {
    if (!active) {
      animations.forEach(anim => {
        Animated.spring(anim, {
          toValue: 0.2,
          useNativeDriver: true,
        }).start();
      });
      return;
    }

    const loops = animations.map((anim, i) => {
      const randomDuration = 300 + Math.random() * 500;
      return Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 0.2 + Math.random() * 0.8,
            duration: randomDuration,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.1 + Math.random() * 0.4,
            duration: randomDuration * 0.8,
            useNativeDriver: true,
          }),
        ]),
      );
    });

    loops.forEach((loop, i) => {
      setTimeout(() => loop.start(), i * 40);
    });

    return () => loops.forEach(l => l.stop());
  }, [active]);

  return (
    <View style={styles.container}>
      {animations.map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              transform: [{scaleY: anim}],
              opacity: anim.interpolate({
                inputRange: [0.1, 1],
                outputRange: [0.3, 1],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    gap: 3,
  },
  bar: {
    width: 4,
    height: 32,
    backgroundColor: '#6C63FF',
    borderRadius: 2,
  },
});
