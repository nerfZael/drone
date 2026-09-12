import type { LivePcmAudio, LivePcmCallbacks } from '@drone/assistant-chat';

export async function openBrowserLivePcmAudio(callbacks: LivePcmCallbacks,
  onPlaybackBlocked: (blocked: boolean) => void): Promise<LivePcmAudio> {
  callbacks.signal?.throwIfAborted();
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
    throw new Error('Live voice needs microphone access and Web Audio in a secure browser.');
  }
  const context = new AudioContext({ sampleRate: 24_000 });
  let microphone: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let closed = false;
  let playbackEnd = 0;
  const playing = new Set<AudioBufferSourceNode>();
  let resolveStopped!: (error: Error) => void;
  const stopped = new Promise<Error>((resolve) => { resolveStopped = resolve; });
  let releasePromise: Promise<void> | undefined;
  const release = (): Promise<void> => {
    if (releasePromise) return releasePromise;
    closed = true;
    resolveStopped(new Error('Voice conversation ended.'));
    callbacks.signal?.removeEventListener('abort', abort);
    microphone?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
    source?.disconnect();
    playing.forEach((node) => { node.onended = null; node.stop(); });
    playing.clear();
    releasePromise = context.close();
    return releasePromise;
  };
  const abort = () => { void release().catch(() => undefined); };
  callbacks.signal?.addEventListener('abort', abort, { once: true });
  try {
    // Resume from the initiating gesture, before awaiting microphone permission.
    const resumed = context.resume().then(() => null, (error: unknown) => error);
    microphone = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
    } });
    if (closed || callbacks.signal?.aborted) {
      microphone.getTracks().forEach((track) => track.stop());
      throw new Error('Voice conversation ended.');
    }
    // Browsers can leave resume pending while autoplay is blocked, even after
    // closing the context. Cancellation must still settle microphone startup.
    const resumeError = await Promise.race([resumed, stopped]);
    if (resumeError) throw resumeError;
    callbacks.signal?.throwIfAborted();
    if (context.sampleRate !== 24_000) throw new Error('Live voice requires a 24 kHz audio context.');
    microphone.getTracks().forEach((track) => {
      track.onended = () => callbacks.onError('Microphone disconnected. Start Live voice again.');
    });
    source = context.createMediaStreamSource(microphone);
    // Same capture API as the existing desktop recorder. Output stays silent;
    // samples go exclusively to the authenticated Live connection.
    processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (event) => {
      if (closed) return;
      const samples = event.inputBuffer.getChannelData(0);
      const bytes = new Uint8Array(samples.length * 2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      }
      callbacks.onAudio(btoa(String.fromCharCode(...bytes)));
    };
    source.connect(processor);
    processor.connect(context.destination);
    return {
      mute(muted) { microphone?.getTracks().forEach((track) => { track.enabled = !muted; }); },
      async resume() { await context.resume(); onPlaybackBlocked(context.state !== 'running'); },
      play(audio) {
        if (closed) return;
        try {
          if (audio.length > 256_000) throw new Error('Live audio chunk is too large.');
          const binary = atob(audio);
          if (!binary.length || binary.length % 2) throw new Error('Invalid Live audio.');
          if (Math.max(0, playbackEnd - context.currentTime) + binary.length / 48_000 > 5) {
            throw new Error('Live voice playback fell behind. Start again.');
          }
          const buffer = context.createBuffer(1, binary.length / 2, 24_000);
          const samples = buffer.getChannelData(0);
          for (let i = 0; i < samples.length; i++) {
            const value = binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8;
            samples[i] = (value >= 32768 ? value - 65536 : value) / 32768;
          }
          const node = context.createBufferSource();
          node.buffer = buffer;
          node.connect(context.destination);
          playing.add(node);
          node.onended = () => { playing.delete(node); node.disconnect(); };
          const start = Math.max(context.currentTime, playbackEnd);
          node.start(start);
          playbackEnd = start + buffer.duration;
          onPlaybackBlocked(context.state !== 'running');
        } catch (error) { callbacks.onError(error instanceof Error ? error.message : 'Live playback failed.'); }
      },
      release,
    };
  } catch (error) { await release(); throw error; }
}
