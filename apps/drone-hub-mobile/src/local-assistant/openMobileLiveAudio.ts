import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, requestNotificationPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { AppState, Platform } from 'react-native';
import { ensureMobileRecordingPermission, ensureMobileBackgroundRecordingPermission } from './mobile-recording-permission';
import { startMobileLiveBackground } from './mobile-live-background';

export async function prepareMobileLiveAudio() {
  const permission = await ensureMobileRecordingPermission({
    getPermission: getRecordingPermissionsAsync,
    requestPermission: requestRecordingPermissionsAsync,
  });
  if (!permission.granted) throw new Error('Allow microphone access in your phone settings to use Live voice.');
  await ensureMobileBackgroundRecordingPermission({
    platform: Platform.OS, platformVersion: Number(Platform.Version),
    requestPermission: requestNotificationPermissionsAsync,
  });
  // Android permission activities temporarily background the app. Wait for their
  // dismissal before opening audio, but never start recording in the background.
  if (AppState.currentState !== 'active') {
    const resumed = await new Promise<boolean>((resolve) => {
      const finish = (active: boolean) => {
        clearTimeout(timer);
        subscription.remove();
        resolve(active);
      };
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') finish(true);
      });
      const timer = setTimeout(() => finish(AppState.currentState === 'active'), 3_000);
      if (AppState.currentState === 'active') finish(true);
    });
    if (!resumed) throw new Error('Return to Drone Hub and try Live voice again.');
  }
}

export async function openMobileLiveAudio(onStopped: () => void = () => {}) {
  // Load only when used so older app installations can still use transcription.
  const { mediaDevices, RTCPeerConnection } = await import('react-native-webrtc');
  const stopBackground = await startMobileLiveBackground(onStopped);
  try {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: Platform.OS === 'android',
      shouldRouteThroughEarpiece: false, interruptionMode: 'doNotMix' });
    const microphone = await mediaDevices.getUserMedia({ audio: true, video: false });
    let peer: InstanceType<typeof RTCPeerConnection>;
    try { peer = new RTCPeerConnection({}); }
    catch (error) { microphone.release(); throw error; }
    return {
      peer, microphone,
      async release() {
        try {
          microphone.getTracks().forEach((track) => track.stop());
          peer.close();
          microphone.release();
          await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false });
        } finally { await stopBackground(); }
      },
    };
  } catch (error) {
    try { await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false }); }
    finally { await stopBackground(); }
    throw error;
  }
}
