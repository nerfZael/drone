import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MeshApp } from './src/shell/MeshApp';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <MeshApp />
    </SafeAreaProvider>
  );
}
