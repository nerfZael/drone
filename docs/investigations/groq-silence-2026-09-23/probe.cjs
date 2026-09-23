const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveGroqApiKeySettings } = require(path.resolve(__dirname, '../../../apps/drone/dist/hub/hub-settings.js'));
const root = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'groq-silence-probe'));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const rate = 16000;
function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
function generated(seconds, kind = 'silence', db = -55) {
  const pcm = Buffer.alloc(seconds * rate * 2);
  let seed = 123456;
  for (let i = 0; i < seconds * rate; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = kind === 'noise' ? (seed / 4294967296 * 2 - 1) * Math.sqrt(3) : kind === 'hum' ? Math.sin(i * 2 * Math.PI * 60 / rate) * Math.sqrt(2) : 0;
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 10 ** (db / 20) * 32767))), i * 2);
  }
  return pcm;
}
function speech(text, seconds, gain = 1) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `flite=text=${text}:voice=slt`, '-ar', String(rate), '-ac', '1', '-f', 's16le', 'pipe:1']);
  if (result.status !== 0) throw new Error(result.stderr.toString());
  const pcm = Buffer.alloc(seconds * rate * 2);
  result.stdout.copy(pcm, rate); // half-second leading silence
  if (gain !== 1) for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.round(pcm.readInt16LE(i) * gain), i);
  return pcm;
}
function levels(pcm) {
  let sum = 0, peak = 0;
  for (let i = 0; i < pcm.length; i += 2) { const n = pcm.readInt16LE(i) / 32768; sum += n*n; peak = Math.max(peak, Math.abs(n)); }
  return { rmsDb: sum ? 10 * Math.log10(sum / (pcm.length / 2)) : null, peakDb: peak ? 20 * Math.log10(peak) : null };
}
async function main() {
  const { apiKey } = await resolveGroqApiKeySettings();
  if (!apiKey) throw new Error('No configured GROQ key');
  const cases = [
    { name: 'silence-1s', pcm: generated(1) },
    { name: 'silence-5s', pcm: generated(5) },
    { name: 'silence-30s', pcm: generated(30) },
    { name: 'noise-5s-minus55dB', pcm: generated(5, 'noise', -55) },
    { name: 'noise-30s-minus40dB', pcm: generated(30, 'noise', -40) },
    { name: 'hum-5s-minus45dB', pcm: generated(5, 'hum', -45) },
    { name: 'spoken-thank-you', pcm: speech('Thank you.', 5) },
    { name: 'quiet-spoken-thank-you', pcm: speech('Thank you.', 5, 0.01) },
    { name: 'sentence-with-silence', pcm: speech('Please open the project and show the latest changes.', 15) },
  ];
  const models = ['whisper-large-v3-turbo', 'whisper-large-v3'];
  const results = [];
  for (const model of models) for (const clip of cases) {
    if (model === 'whisper-large-v3' && !['silence-5s', 'silence-30s', 'noise-5s-minus55dB', 'spoken-thank-you'].includes(clip.name)) continue;
    const audio = wav(clip.pcm);
    fs.writeFileSync(path.join(root, `${clip.name}.wav`), audio);
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/wav' }), `${clip.name}.wav`);
    form.append('model', model); form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment'); form.append('temperature', '0');
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    const row = { clip: clip.name, model, seconds: clip.pcm.length / (rate * 2), ...levels(clip.pcm), status: response.status, requestId: response.headers.get('x-request-id'), text: data.text, error: data.error, language: data.language, segments: data.segments?.map(({ text, start, end, no_speech_prob, avg_logprob, compression_ratio }) => ({ text, start, end, no_speech_prob, avg_logprob, compression_ratio })) };
    results.push(row); console.log(JSON.stringify(row));
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    if (!response.ok) break;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
