import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MeshApp } from './src/shell/MeshApp';
import { systemUi } from './src/theme';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={systemUi.statusBarStyle} />
        <MeshApp />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
