import assert from "node:assert/strict";
import { GroqTranscriptionManager, PcmSpeechSegmenter, buildGroqPrompt, buildTranscriptionConfigFromEnv, hasTranscriptContent, pcm16leToWav, pcmDurationMs, stripTranscriptCommands } from "../src/stt.js";
import { normalizeWavChunkSizes } from "../src/tts.js";

const pcm = Buffer.alloc(640);
const wav = pcm16leToWav(pcm, 16_000, 1);

assert.equal(wav.toString("ascii", 0, 4), "RIFF");
assert.equal(wav.toString("ascii", 8, 12), "WAVE");
assert.equal(wav.toString("ascii", 12, 16), "fmt ");
assert.equal(wav.readUInt16LE(20), 1);
assert.equal(wav.readUInt16LE(22), 1);
assert.equal(wav.readUInt32LE(24), 16_000);
assert.equal(wav.readUInt16LE(34), 16);
assert.equal(wav.toString("ascii", 36, 40), "data");
assert.equal(wav.readUInt32LE(40), 640);
assert.equal(wav.byteLength, 684);
assert.equal(pcmDurationMs(640, 16_000, 1), 20);

const groqStyleWav = Buffer.from(wav);
groqStyleWav.writeUInt32LE(0xffffffff, 4);
groqStyleWav.writeUInt32LE(0xffffffff, 40);
const normalizedGroqStyleWav = normalizeWavChunkSizes(groqStyleWav);
assert.equal(normalizedGroqStyleWav.readUInt32LE(4), normalizedGroqStyleWav.byteLength - 8);
assert.equal(normalizedGroqStyleWav.readUInt32LE(40), 640);

const segmenter = new PcmSpeechSegmenter({
  sampleRateHz: 16_000,
  channels: 1,
  minSpeechMs: 120,
  minSubmitMs: 800,
  silenceMs: 200,
  shortUtteranceSilenceMs: 500,
  maxSegmentMs: 2_000,
  overlapMs: 100,
  silenceThreshold: 0.01,
  debugVad: false,
});

const firstSegments = [
  ...segmenter.append(tonePcm(140)),
  ...segmenter.append(silencePcm(100)),
  ...segmenter.append(silencePcm(100)),
];
assert.equal(firstSegments.length, 1);
assert.equal(firstSegments[0]!.audioMs, 800);

const secondSegments = [
  ...segmenter.append(tonePcm(140)),
  ...segmenter.append(silencePcm(200)),
];
assert.equal(secondSegments.length, 1);
assert.equal(secondSegments[0]!.audioMs, 800);

const tooShort = new PcmSpeechSegmenter({
  sampleRateHz: 16_000,
  channels: 1,
  minSpeechMs: 120,
  minSubmitMs: 800,
  silenceMs: 200,
  shortUtteranceSilenceMs: 500,
  maxSegmentMs: 2_000,
  overlapMs: 100,
  silenceThreshold: 0.01,
  debugVad: false,
});
const noSegments = [
  ...tooShort.append(tonePcm(80)),
  ...tooShort.append(silencePcm(300)),
];
assert.equal(noSegments.length, 0);
const shortSegment = [
  ...tooShort.append(silencePcm(200)),
];
assert.equal(shortSegment.length, 1);
assert.equal(shortSegment[0]!.audioMs, 800);

const repeatedShort = new PcmSpeechSegmenter({
  sampleRateHz: 16_000,
  channels: 1,
  minSpeechMs: 120,
  minSubmitMs: 800,
  silenceMs: 200,
  shortUtteranceSilenceMs: 500,
  maxSegmentMs: 2_000,
  overlapMs: 0,
  silenceThreshold: 0.01,
  debugVad: false,
});
const repeatedSegments = [
  ...repeatedShort.append(tonePcm(140)),
  ...repeatedShort.append(silencePcm(200)),
  ...repeatedShort.append(tonePcm(140)),
  ...repeatedShort.append(silencePcm(200)),
  ...repeatedShort.append(tonePcm(140)),
  ...repeatedShort.append(silencePcm(200)),
];
assert.equal(repeatedSegments.length, 3);
assert.deepEqual(repeatedSegments.map((segment) => segment.audioMs), [800, 800, 800]);

const prompt = buildGroqPrompt("Prefer numerals for spoken numbers.", "x".repeat(2_000), 896);
assert.ok(prompt);
assert.equal(Array.from(prompt).length, 896);
assert.ok(prompt.startsWith("Prefer numerals"));
assert.ok(prompt.endsWith("x".repeat(20)));

const longConfiguredPrompt = buildGroqPrompt("p".repeat(1_000), "context should be dropped", 896);
assert.ok(longConfiguredPrompt);
assert.equal(Array.from(longConfiguredPrompt).length, 896);
assert.equal(longConfiguredPrompt, "p".repeat(896));

const cleanedWake = stripTranscriptCommands("Hey Sebastian, what am I saying right now?");
assert.equal(cleanedWake.wakeDetected, true);
assert.equal(cleanedWake.sleepDetected, false);
assert.equal(cleanedWake.text, "what am I saying right now?");

const cleanedSleep = stripTranscriptCommands("That's it. This should not include the command.");
assert.equal(cleanedSleep.wakeDetected, false);
assert.equal(cleanedSleep.sleepDetected, true);
assert.equal(cleanedSleep.sleepTargetState, "awake");
assert.equal(cleanedSleep.abortDetected, false);
assert.equal(cleanedSleep.text, "This should not include the command.");

const cleanedGoToSleep = stripTranscriptCommands("Go to sleep. This should not include the command.");
assert.equal(cleanedGoToSleep.wakeDetected, false);
assert.equal(cleanedGoToSleep.sleepDetected, true);
assert.equal(cleanedGoToSleep.sleepTargetState, "sleeping");
assert.equal(cleanedGoToSleep.abortDetected, false);
assert.equal(cleanedGoToSleep.text, "This should not include the command.");

for (const phrase of ["ok stop", "ok, stop", "okay stop", "okay, stop"]) {
  const cleanedAbort = stripTranscriptCommands(`${phrase}. This should be discarded.`);
  assert.equal(cleanedAbort.abortDetected, true);
  assert.equal(cleanedAbort.sleepDetected, false);
  assert.equal(cleanedAbort.text, "This should be discarded.");

  const cleanedOnlyAbort = stripTranscriptCommands(`${phrase}.`);
  assert.equal(cleanedOnlyAbort.abortDetected, true);
  assert.equal(cleanedOnlyAbort.sleepDetected, false);
  assert.equal(cleanedOnlyAbort.text, "");
}

const cleanedPatchWake = stripTranscriptCommands("Patch me in, send this to the current chat.");
assert.equal(cleanedPatchWake.wakeDetected, true);
assert.equal(cleanedPatchWake.text, "send this to the current chat.");

const cleanedClipboardWake = stripTranscriptCommands("Can you transcribe, send this to my clipboard.");
assert.equal(cleanedClipboardWake.wakeDetected, true);
assert.equal(cleanedClipboardWake.text, "send this to my clipboard.");

const cleanedShortClipboardWake = stripTranscriptCommands("Transcribe send this to my clipboard.");
assert.equal(cleanedShortClipboardWake.wakeDetected, true);
assert.equal(cleanedShortClipboardWake.text, "send this to my clipboard.");

const cleanedStandaloneHey = stripTranscriptCommands("Hey, what am I saying right now?");
assert.equal(cleanedStandaloneHey.wakeDetected, false);
assert.equal(cleanedStandaloneHey.text, "Hey, what am I saying right now?");

const cleanedBoth = stripTranscriptCommands("hey sebastian this is useful that's it");
assert.equal(cleanedBoth.wakeDetected, true);
assert.equal(cleanedBoth.sleepDetected, true);
assert.equal(cleanedBoth.text, "this is useful");

assert.equal(hasTranscriptContent("."), false);
assert.equal(hasTranscriptContent(". . ."), false);
assert.equal(hasTranscriptContent("..."), false);
assert.equal(hasTranscriptContent("pairing is password protected."), true);

const originalFetch = globalThis.fetch;
let fetchCalls = 0;
const ignoredSleepCommands: unknown[] = [];
globalThis.fetch = (async () => {
  fetchCalls += 1;
  return new Response(JSON.stringify({ text: "that's it" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

try {
  const manager = new GroqTranscriptionManager(
    {
      ...buildTranscriptionConfigFromEnv({ GROQ_API_KEY: "test" } as NodeJS.ProcessEnv),
      endpoint: "http://127.0.0.1/transcribe",
      intervalMs: 5,
      minSpeechMs: 120,
      minSubmitMs: 120,
      silenceMs: 100,
      shortUtteranceSilenceMs: 200,
      maxSegmentMs: 2_000,
      overlapMs: 0,
      silenceThreshold: 0.01,
      debugSegments: false,
      ignoreEmptySleepCommands: true,
    },
    () => {},
    (command) => ignoredSleepCommands.push(command),
    "test",
  );
  manager.appendPcm(tonePcm(140));
  manager.appendPcm(silencePcm(120));
  await waitFor(() => fetchCalls > 0 && manager.status().status === "ready");
  assert.equal(ignoredSleepCommands.length, 0);
  manager.stop();
} finally {
  globalThis.fetch = originalFetch;
}

let finalFetchCalls = 0;
const finalPrompts: string[] = [];
const sleepCommands: unknown[] = [];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  finalFetchCalls += 1;
  const prompt = init?.body instanceof FormData ? init.body.get("prompt") : null;
  finalPrompts.push(typeof prompt === "string" ? prompt : "");
  const text = finalFetchCalls === 1
    ? "rough chunk text that's it"
    : "final full recording text that's it";
  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

try {
  const manager = new GroqTranscriptionManager(
    {
      ...buildTranscriptionConfigFromEnv({ GROQ_API_KEY: "test" } as NodeJS.ProcessEnv),
      endpoint: "http://127.0.0.1/transcribe",
      intervalMs: 5,
      minSpeechMs: 120,
      minSubmitMs: 120,
      silenceMs: 100,
      shortUtteranceSilenceMs: 200,
      maxSegmentMs: 2_000,
      overlapMs: 0,
      silenceThreshold: 0.01,
      debugSegments: false,
      prompt: "p".repeat(1_000),
      maxPromptChars: 50,
    },
    () => {},
    (command) => sleepCommands.push(command),
    "test-final",
  );
  manager.appendPcm(tonePcm(140));
  manager.appendPcm(silencePcm(120));
  await waitFor(() => sleepCommands.length > 0);
  assert.equal(finalFetchCalls, 2);
  assert.deepEqual(finalPrompts.map((prompt) => Array.from(prompt).length), [50, 50]);
  assert.deepEqual(sleepCommands[0], {
    type: "sleep",
    phrase: "that's it",
    targetState: "awake",
    detectedAt: (sleepCommands[0] as any).detectedAt,
    transcriptText: "final full recording text",
  });
  manager.stop();
} finally {
  globalThis.fetch = originalFetch;
}

let segmentModeFetchCalls = 0;
const segmentModeSleepCommands: unknown[] = [];
globalThis.fetch = (async () => {
  segmentModeFetchCalls += 1;
  return new Response(JSON.stringify({ text: "segment mode text that's it" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

try {
  const manager = new GroqTranscriptionManager(
    {
      ...buildTranscriptionConfigFromEnv({
        GROQ_API_KEY: "test",
        GROQ_STT_FINAL_TRANSCRIPTION_MODE: "segments",
      } as NodeJS.ProcessEnv),
      endpoint: "http://127.0.0.1/transcribe",
      intervalMs: 5,
      minSpeechMs: 120,
      minSubmitMs: 120,
      silenceMs: 100,
      shortUtteranceSilenceMs: 200,
      maxSegmentMs: 2_000,
      overlapMs: 0,
      silenceThreshold: 0.01,
      debugSegments: false,
    },
    () => {},
    (command) => segmentModeSleepCommands.push(command),
    "test-segments",
  );
  manager.appendPcm(tonePcm(140));
  manager.appendPcm(silencePcm(120));
  await waitFor(() => segmentModeSleepCommands.length > 0);
  assert.equal(segmentModeFetchCalls, 1);
  assert.equal((segmentModeSleepCommands[0] as any).transcriptText, "segment mode text");
  manager.stop();
} finally {
  globalThis.fetch = originalFetch;
}

let overflowFetchCalls = 0;
const overflowSleepCommands: unknown[] = [];
globalThis.fetch = (async () => {
  overflowFetchCalls += 1;
  return new Response(JSON.stringify({ text: "overflow fallback text that's it" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

try {
  const manager = new GroqTranscriptionManager(
    {
      ...buildTranscriptionConfigFromEnv({
        GROQ_API_KEY: "test",
        GROQ_STT_MAX_SESSION_AUDIO_BYTES: "1",
      } as NodeJS.ProcessEnv),
      endpoint: "http://127.0.0.1/transcribe",
      intervalMs: 5,
      minSpeechMs: 120,
      minSubmitMs: 120,
      silenceMs: 100,
      shortUtteranceSilenceMs: 200,
      maxSegmentMs: 2_000,
      overlapMs: 0,
      silenceThreshold: 0.01,
      debugSegments: false,
    },
    () => {},
    (command) => overflowSleepCommands.push(command),
    "test-overflow",
  );
  manager.appendPcm(tonePcm(140));
  manager.appendPcm(silencePcm(120));
  await waitFor(() => overflowSleepCommands.length > 0);
  assert.equal(overflowFetchCalls, 1);
  assert.equal((overflowSleepCommands[0] as any).transcriptText, "overflow fallback text");
  manager.stop();
} finally {
  globalThis.fetch = originalFetch;
}

console.log("STT WAV and segmentation tests passed");

function silencePcm(ms: number): Buffer {
  return Buffer.alloc(Math.round(16_000 * 2 * ms / 1000));
}

function tonePcm(ms: number): Buffer {
  const samples = Math.round(16_000 * ms / 1000);
  const output = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const sample = Math.round(Math.sin(i / 8) * 8000);
    output.writeInt16LE(sample, i * 2);
  }
  return output;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for async STT test condition");
}
