import { describe, expect, test } from 'bun:test';
import {
  HubAssistantService,
  summarizeAssistantChatIdle,
  waitForAssistantChatIdle,
} from '../src/hub/assistant';
import { loadRegistry, updateRegistry } from '../src/host/registry';
import { withTempDroneDataDir } from './test-helpers';

function seedChat(reg: any, pendingPrompts: any[] = [], turns: any[] = []): void {
  const now = new Date().toISOString();
  reg.drones = reg.drones ?? {};
  reg.drones['drone-a'] = {
    id: 'drone-a',
    name: 'Drone A',
    createdAt: now,
    chats: {
      default: {
        createdAt: now,
        turns,
        pendingPrompts,
      },
    },
  };
}

describe('assistant chat idle wait', () => {
  test('treats queued user messages as active and failed pending messages as idle', async () => {
    await withTempDroneDataDir('assistant-chat-idle-', async () => {
      await updateRegistry((reg: any) => {
        seedChat(reg, [
          {
            id: 'prompt-1',
            at: new Date().toISOString(),
            prompt: 'please work',
            state: 'queued',
          },
        ]);
      });

      let status = summarizeAssistantChatIdle(await loadRegistry(), { droneId: 'drone-a', chatName: 'default' });
      expect(status.idle).toBe(false);
      expect(status.reason).toBe('active_user_messages');
      expect(status.activeUserMessages).toBe(1);

      await updateRegistry((reg: any) => {
        seedChat(reg, [
          {
            id: 'prompt-1',
            at: new Date().toISOString(),
            prompt: 'please work',
            state: 'failed',
            error: 'agent failed before accepting prompt',
          },
        ]);
      });

      status = summarizeAssistantChatIdle(await loadRegistry(), { droneId: 'drone-a', chatName: 'default' });
      expect(status.idle).toBe(true);
      expect(status.reason).toBe('latest_user_failed');
      expect(status.failedUserMessages).toBe(1);
    });
  });

  test('waits until a pending prompt becomes an agent turn', async () => {
    await withTempDroneDataDir('assistant-chat-idle-wait-', async () => {
      const startedAt = new Date().toISOString();
      await updateRegistry((reg: any) => {
        seedChat(reg, [
          {
            id: 'prompt-2',
            at: startedAt,
            prompt: 'finish this',
            state: 'sent',
          },
        ]);
      });

      setTimeout(() => {
        void updateRegistry((reg: any) => {
          seedChat(
            reg,
            [],
            [
              {
                id: 'prompt-2',
                at: startedAt,
                promptAt: startedAt,
                completedAt: new Date().toISOString(),
                prompt: 'finish this',
                ok: true,
                output: 'done',
              },
            ],
          );
        });
      }, 50);

      const result = await waitForAssistantChatIdle({
        targets: [{ droneId: 'drone-a', chatName: 'default' }],
        timeoutMs: 2000,
        pollIntervalMs: 25,
        idleForMs: 0,
      });

      expect(result.ok).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(result.targets[0]?.idle).toBe(true);
      expect(result.targets[0]?.reason).toBe('latest_agent_message');
      expect(result.targets[0]?.latest?.role).toBe('agent');
      expect(result.targets[0]?.latest?.text).toBe('done');
    });
  });

  test('treats a pending seeded drone default chat as active until it becomes a real chat', async () => {
    await withTempDroneDataDir('assistant-chat-idle-pending-seed-', async () => {
      const startedAt = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-pending': {
            id: 'drone-pending',
            name: 'Drone Pending',
            createdAt: startedAt,
            updatedAt: startedAt,
            phase: 'starting',
            seed: { chatName: 'default', prompt: 'start this work' },
          },
        };
      });

      let status = summarizeAssistantChatIdle(await loadRegistry(), { droneId: 'drone-pending', chatName: 'default' }, { requireChat: true });
      expect(status.idle).toBe(false);
      expect(status.reason).toBe('active_user_messages');
      expect(status.latest?.text).toBe('start this work');

      setTimeout(() => {
        void updateRegistry((reg: any) => {
          reg.pending = {};
          reg.drones = {
            'drone-pending': {
              id: 'drone-pending',
              name: 'Drone Pending',
              createdAt: startedAt,
              chats: {
                default: {
                  createdAt: startedAt,
                  turns: [
                    {
                      id: 'startup-seed',
                      at: startedAt,
                      promptAt: startedAt,
                      completedAt: new Date().toISOString(),
                      prompt: 'start this work',
                      ok: true,
                      output: 'seed done',
                    },
                  ],
                },
              },
            },
          };
        });
      }, 50);

      const result = await waitForAssistantChatIdle({
        targets: [{ droneId: 'drone-pending', chatName: 'default' }],
        timeoutMs: 2000,
        pollIntervalMs: 25,
        idleForMs: 0,
      });

      expect(result.ok).toBe(true);
      expect(result.targets[0]?.idle).toBe(true);
      expect(result.targets[0]?.latest?.text).toBe('seed done');
    });
  });

  test('rejects unknown chat targets instead of treating them as idle', async () => {
    await withTempDroneDataDir('assistant-chat-idle-missing-chat-', async () => {
      await updateRegistry((reg: any) => {
        seedChat(reg);
      });

      await expect(
        waitForAssistantChatIdle({
          targets: [{ droneId: 'drone-a', chatName: 'missing-chat' }],
          timeoutMs: 1000,
          pollIntervalMs: 25,
          idleForMs: 0,
        }),
      ).rejects.toThrow('unknown chat: drone-a/missing-chat');
    });
  });

  test('aborts an active wait when the caller signal is cancelled', async () => {
    await withTempDroneDataDir('assistant-chat-idle-abort-', async () => {
      await updateRegistry((reg: any) => {
        seedChat(reg, [
          {
            id: 'prompt-3',
            at: new Date().toISOString(),
            prompt: 'keep waiting',
            state: 'sent',
          },
        ]);
      });

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);

      await expect(
        waitForAssistantChatIdle({
          targets: [{ droneId: 'drone-a', chatName: 'default' }],
          timeoutMs: 5000,
          pollIntervalMs: 1000,
          idleForMs: 0,
          signal: controller.signal,
        }),
      ).rejects.toThrow('aborted');
    });
  });

  test('subscribes to chat idle without blocking the assistant thread', async () => {
    await withTempDroneDataDir('assistant-chat-idle-subscribe-', async () => {
      await updateRegistry((reg: any) => {
        seedChat(reg, [
          {
            id: 'prompt-4',
            at: new Date().toISOString(),
            prompt: 'keep working',
            state: 'sent',
          },
        ]);
      });

      const service = new HubAssistantService({
        listDrones: async () => [],
        createDrone: async () => {
          throw new Error('not implemented');
        },
        createChat: async () => {
          throw new Error('not implemented');
        },
        setDroneGroup: async () => {
          throw new Error('not implemented');
        },
        messageDrone: async () => {
          throw new Error('not implemented');
        },
      });
      const snapshot = await service.createThread({ title: 'Subscription test', provider: 'openai', model: 'gpt-5.5' });
      const threadId = snapshot.activeThreadId;
      const subscription = await service.subscribeToChatsIdle({
        threadId,
        toolCallId: 'tool-call-1',
        targets: [{ droneId: 'drone-a', chatName: 'default' }],
        idleForMs: 1000,
      });

      expect(subscription.status).toBe('active');
      expect(subscription.targets).toEqual([{ droneId: 'drone-a', chatName: 'default' }]);

      const subscribedSnapshot = await service.snapshot();
      const thread = subscribedSnapshot.threads.find((item) => item.id === threadId);
      expect(thread?.status).toBe('waiting_for_chats_idle');
      expect(subscribedSnapshot.chatIdleSubscriptions.some((item) => item.id === subscription.id && item.status === 'active')).toBe(true);
    });
  });
});
