export type GroqTtsConfig = {
  apiKey?: string;
  endpoint: string;
  model: string;
  voice: string;
  responseFormat: "wav";
};

const digitWords = new Map<string, string>([
  ["0", "zero"],
  ["1", "one"],
  ["2", "two"],
  ["3", "three"],
  ["4", "four"],
  ["5", "five"],
  ["6", "six"],
  ["7", "seven"],
  ["8", "eight"],
  ["9", "nine"],
]);

export function buildTtsConfigFromEnv(env: NodeJS.ProcessEnv): GroqTtsConfig {
  return {
    apiKey: env.GROQ_TTS_API_KEY?.trim() || env.GROQ_API_KEY?.trim(),
    endpoint: env.GROQ_TTS_ENDPOINT ?? "https://api.groq.com/openai/v1/audio/speech",
    model: env.GROQ_TTS_MODEL ?? "canopylabs/orpheus-v1-english",
    voice: env.GROQ_TTS_VOICE ?? "austin",
    responseFormat: "wav",
  };
}

export function buildApprovalCodeSpeechText(code: string): string {
  const words = Array.from(code)
    .map((digit) => digitWords.get(digit) ?? digit)
    .join(" ");
  const spacedDigits = Array.from(code).join(" ");
  return `Approval code ${words}. Code ${spacedDigits}.`;
}

export async function synthesizeApprovalCodeWav(code: string, config: GroqTtsConfig): Promise<Buffer> {
  return await synthesizeTextWav(buildApprovalCodeSpeechText(code), config);
}

export async function synthesizeTextWav(text: string, config: GroqTtsConfig): Promise<Buffer> {
  if (!config.apiKey) {
    throw new Error("Groq TTS disabled: set GROQ_API_KEY or GROQ_TTS_API_KEY");
  }

  const input = text.trim();
  if (!input) {
    throw new Error("missing TTS text");
  }

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input,
      voice: config.voice,
      response_format: config.responseFormat,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }

  return normalizeWavChunkSizes(Buffer.from(await response.arrayBuffer()));
}

export function normalizeWavChunkSizes(wav: Buffer): Buffer {
  if (wav.byteLength < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    return wav;
  }

  const output = Buffer.from(wav);
  const riffSize = output.byteLength - 8;
  if (riffSize >= 0 && riffSize <= 0xffffffff && output.readUInt32LE(4) === 0xffffffff) {
    output.writeUInt32LE(riffSize, 4);
  }

  let offset = 12;
  while (offset + 8 <= output.byteLength) {
    const chunkId = output.toString("ascii", offset, offset + 4);
    const chunkSize = output.readUInt32LE(offset + 4);
    const dataStart = offset + 8;

    if (chunkId === "data") {
      if (chunkSize === 0xffffffff) {
        output.writeUInt32LE(output.byteLength - dataStart, offset + 4);
      }
      break;
    }

    if (chunkSize === 0xffffffff) {
      break;
    }

    const nextOffset = dataStart + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset || nextOffset > output.byteLength) {
      break;
    }
    offset = nextOffset;
  }

  return output;
}
