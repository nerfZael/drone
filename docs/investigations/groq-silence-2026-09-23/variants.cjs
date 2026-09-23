const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveGroqApiKeySettings } = require(path.resolve(__dirname, '../../../apps/drone/dist/hub/hub-settings.js'));
const root = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'groq-silence-probe'));
async function main() {
  const { apiKey } = await resolveGroqApiKeySettings();
  if (!apiKey) throw new Error('No configured GROQ key');
  for (const format of ['flac', 'webm']) {
    const result = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', path.join(root, 'silence-5s.wav'), path.join(root, `silence-5s.${format}`)]);
    if (result.status !== 0) throw new Error(result.stderr.toString());
  }
  const cases = [
    { name: 'plain-json', responseFormat: 'json' },
    { name: 'explicit-English', language: 'en' },
    { name: 'dictation-style-prompt', prompt: 'Voice dictation transcript.' },
    { name: 'anti-hallucination-instruction', prompt: 'Transcribe only audible speech. If there is silence, return no text.' },
    { name: 'recent-speech-context', prompt: 'Please open the project and show the latest changes.' },
    { name: 'explicit-Croatian', language: 'hr' },
    { name: 'flac-format', format: 'flac' },
    { name: 'webm-format', format: 'webm' },
  ];
  const results = [];
  for (const variant of cases) {
    const format = variant.format || 'wav';
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(path.join(root, `silence-5s.${format}`))], { type: `audio/${format}` }), `silence.${format}`);
    form.append('model', 'whisper-large-v3-turbo'); form.append('response_format', variant.responseFormat || 'verbose_json'); form.append('temperature', '0');
    if (variant.prompt) form.append('prompt', variant.prompt);
    if (variant.language) form.append('language', variant.language);
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    const row = { ...variant, status: response.status, requestId: response.headers.get('x-request-id'), text: data.text, error: data.error, segments: data.segments?.map(({ text, no_speech_prob, avg_logprob }) => ({ text, no_speech_prob, avg_logprob })) };
    results.push(row); console.log(JSON.stringify(row));
    fs.writeFileSync(path.join(root, 'variants-results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    if (!response.ok) break;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
