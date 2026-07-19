import { createDroneSDK } from './packages/drone-sdk/src/index.ts';

async function main(): Promise<void> {
  const sdk = createDroneSDK();
  const codexConfig = {
    agent: 'codex' as const,
    model: 'gpt-5.4-mini',
  };

  const suffix = Date.now().toString(36);
  const group = sdk.groups.create('experiment');
  const [firstDrone, secondDrone] = await group.createManyDrones([
    { name: `test-drone-a-${suffix}`, ...codexConfig },
    { name: `test-drone-b-${suffix}`, ...codexConfig },
  ]);

  console.log('Created drones:');
  console.log(`- ${firstDrone.name} (${firstDrone.id})`);
  console.log(`- ${secondDrone.name} (${secondDrone.id})`);

  const responses = await sdk.broadcast
    .drones([firstDrone, secondDrone])
    .chat('default')
    .sendAndWait('hello world', { timeoutMs: 120_000, pollIntervalMs: 500 });

  console.log('\nResponses:');
  for (const response of responses) {
    console.log(`- ${response.droneName}: [${response.status}] ${response.text ?? '(no response text)'}`);
  }
}

void main().catch((error: unknown) => {
  console.error('Failed to run drone test:', error);
  process.exitCode = 1;
});
