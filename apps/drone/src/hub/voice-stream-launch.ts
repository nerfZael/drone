export function buildVoiceStreamProcessEnv(
  baseEnv: NodeJS.ProcessEnv,
  opts: {
    port: number;
    groqApiKey?: string | null;
    pairingPassword?: string | null;
    finalTranscriptionMode?: string | null;
    hubApiUrl?: string | null;
    hubApiToken?: string | null;
  },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    PORT: String(opts.port),
  };

  const groqApiKey = String(opts.groqApiKey ?? '').trim();
  if (groqApiKey) {
    env.GROQ_API_KEY = groqApiKey;
    if (!String(env.GROQ_TTS_API_KEY ?? '').trim()) {
      env.GROQ_TTS_API_KEY = groqApiKey;
    }
  }

  const pairingPassword = String(opts.pairingPassword ?? '').trim();
  if (pairingPassword) {
    env.DRONE_PAIR_PASSWORD = pairingPassword;
  }

  const finalTranscriptionMode = String(opts.finalTranscriptionMode ?? '').trim();
  if (finalTranscriptionMode) {
    env.GROQ_STT_FINAL_TRANSCRIPTION_MODE = finalTranscriptionMode;
  }

  const hubApiUrl = String(opts.hubApiUrl ?? '').trim();
  const hubApiToken = String(opts.hubApiToken ?? '').trim();
  if (hubApiUrl) env.DRONE_HUB_API_URL = hubApiUrl;
  if (hubApiToken) env.DRONE_HUB_API_TOKEN = hubApiToken;

  return env;
}
