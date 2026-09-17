import { generateText } from 'ai';

async function main() {
  if (!process.env.AI_GATEWAY_API_KEY?.trim()) {
    console.error('Enter AI_GATEWAY_API_KEY locally in .env.local, then run bun index.ts.');
    process.exitCode = 1;
    return;
  }
  try {
    const { text } = await generateText({
      model: 'openai/gpt-5.5',
      prompt: 'Invent a new holiday and describe its traditions.',
      abortSignal: AbortSignal.timeout(60_000),
      maxRetries: 0,
    });
    if (!text.trim()) throw new Error('Empty response');
    console.log(text);
  } catch {
    // SDK errors can contain request details. Never print credentials or raw errors.
    console.error('Gateway text generation failed or returned no text. Check your local key, model access, and connection.');
    process.exitCode = 1;
  }
}

void main();
