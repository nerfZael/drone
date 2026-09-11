import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';

export async function openMobileLiveAudio() {
  // Load only when used so older app installations can still use transcription.
  const { mediaDevices, RTCPeerConnection } = await import('react-native-webrtc');
  const permission = await requestRecordingPermissionsAsync();
  if (!permission.granted) throw new Error('Allow microphone access in your phone settings to use Live voice.');
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false, interruptionMode: 'doNotMix' });
  try {
    const microphone = await mediaDevices.getUserMedia({ audio: true, video: false });
    let peer: InstanceType<typeof RTCPeerConnection>;
    try { peer = new RTCPeerConnection({}); }
    catch (error) { microphone.release(); throw error; }
    return {
      peer, microphone,
      async release() {
        microphone.getTracks().forEach((track) => track.stop());
        peer.close();
        microphone.release();
        await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false });
      },
    };
  } catch (error) {
    await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false });
    throw error;
  }
}
