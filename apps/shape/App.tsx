import "react-native-gesture-handler";

import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { MorphingForm } from "./src/MorphingForm";

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar hidden />
      <MorphingForm />
    </GestureHandlerRootView>
  );
}
