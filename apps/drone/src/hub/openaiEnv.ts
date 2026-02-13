export function requireOpenAiApiKey(): string {
  const key = String(process.env.OPENAI_API_KEY ?? '').trim();
  if (key) return key;
  throw new Error('Missing OPENAI_API_KEY (set it in your environment to enable /api/jobs/from-message).');
}

