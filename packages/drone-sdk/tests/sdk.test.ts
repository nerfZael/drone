import { describe, expect, test } from 'bun:test';
import { createDroneSDK } from '../src';
import { createMockTransport } from '../src/testing';

describe('drone-sdk core', () => {
  test('creates a drone and dispatches queued chat messages sequentially', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport({
        responder: ({ prompt }) => `done:${prompt}`,
      }),
    });

    const drone = await sdk.drones.create('drone-1', { runtime: 'container' });
    const run = await drone
      .chat('planner')
      .queue('alpha')
      .queue('beta')
      .queue('gamma')
      .dispatch();

    const result = await run.wait();
    const messages = await run.messages({ order: 'asc' });

    expect(result.status).toBe('done');
    expect(messages.map((message) => message.content)).toEqual([
      'alpha',
      'done:alpha',
      'beta',
      'done:beta',
      'gamma',
      'done:gamma',
    ]);
  });

  test('supports multiple chats on one drone', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport({
        responder: ({ chatName, prompt }) => `${chatName}:${prompt}`,
      }),
    });

    const drone = await sdk.drones.create('drone-2', { runtime: 'container' });
    const planner = drone.chat('planner');
    const coder = drone.chat('coder');

    const [plannerRun, coderRun] = await Promise.all([
      planner.queue('p1').queue('p2').queue('p3').dispatch(),
      coder.queue('c1').queue('c2').queue('c3').dispatch(),
    ]);

    await Promise.all([plannerRun.wait(), coderRun.wait()]);
    const [plannerLast, coderLast] = await Promise.all([plannerRun.lastMessageText(), coderRun.lastMessageText()]);

    expect(plannerLast).toBe('planner:p3');
    expect(coderLast).toBe('coder:c3');
  });

  test('broadcasts to multiple chats on one drone', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport({
        responder: ({ chatName, prompt }) => `${chatName}:${prompt}`,
      }),
    });

    const drone = await sdk.drones.create('drone-3', { runtime: 'container' });
    const runs = await drone.broadcast(['planner', 'coder']).send('status');
    const results = await Promise.all(runs.map(async (run) => await run.lastMessageText()));

    expect(results).toEqual(['planner:status', 'coder:status']);
  });

  test('broadcasts to multiple drones on the same chat', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport({
        responder: ({ drone, prompt }) => `${drone.name}:${prompt}`,
      }),
    });

    const [a, b] = await Promise.all([
      sdk.drones.create('drone-a', { runtime: 'container' }),
      sdk.drones.create('drone-b', { runtime: 'container' }),
    ]);

    const runs = await sdk.broadcast.drones([a, b]).chat('default').send('ping');
    const results = await Promise.all(runs.map(async (run) => await run.lastMessageText()));

    expect(results).toEqual(['drone-a:ping', 'drone-b:ping']);
  });

  test('removes chats explicitly', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport(),
    });

    const drone = await sdk.drones.create('drone-4', { runtime: 'container' });
    await drone.chat('planner').ensure();
    await drone.chat('planner').remove();

    const chats = await drone.chats.list();
    expect(chats.map((chat) => chat.name)).toEqual(['default']);
  });

  test('archives drones on remove when archive mode is enabled', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport({ deleteMode: 'archive' }),
    });

    const drone = await sdk.drones.create('drone-5', { runtime: 'container' });
    await drone.remove();

    const found = await sdk.drones.get(drone.id);
    expect(found).toBeNull();
  });

  test('lists groups via group-scoped creates', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport(),
    });

    const exp = sdk.groups.get('experimental');
    await exp.createMany([
      { name: 'a', runtime: 'container' },
      { name: 'b', runtime: 'container' },
    ]);

    const groups = await sdk.groups.list();
    expect(groups).toEqual([{ name: 'experimental', count: 2 }]);
  });
});
