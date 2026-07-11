import { describe, expect, test } from 'bun:test';

import { HubAssistantService } from '../src/hub/assistant';
import { withTempDroneDataDir } from './test-helpers';

function installFakeRuntime(service: HubAssistantService): void {
  const Type = {
    Object: (value: unknown) => value,
    String: (value?: unknown) => value,
    Optional: (value: unknown) => value,
    Number: (value?: unknown) => value,
    Boolean: (value?: unknown) => value,
    Array: (value: unknown) => value,
  };
  (service as any).runtime = async () => ({
    Agent: class {},
    Type,
    getModel: (provider: string, model: string) => ({ provider, id: model, reasoning: false }),
    getModels: () => [],
    getSupportedThinkingLevels: () => ['off'],
  });
}

describe('assistant whiteboard images', () => {
  test('capture_whiteboard stores an image content block in tool results', async () => {
    await withTempDroneDataDir('assistant-whiteboard-image-', async () => {
      const pngData = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
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
        captureWhiteboard: async () => ({
          ok: true,
          data: pngData,
          mimeType: 'image/png',
          metadata: {
            ok: true,
            whiteboardId: 'main',
            title: 'Main whiteboard',
            version: 1,
            mimeType: 'image/png',
            width: 10,
            height: 10,
            byteLength: 8,
          },
        }),
      });
      installFakeRuntime(service);
      const history: any[] = [];
      service.setRealtimeHistoryDelegate(async (_threadId, message) => {
        history.push(message);
      });
      service.setRealtimeToolDelegate({
        catalog: async () => [{
          name: 'drone_hub__capture_whiteboard',
          description: 'Capture whiteboard',
          parameters: { type: 'object', properties: {} },
        }],
        execute: async () => ({
          content: [
            { type: 'image', data: pngData, mimeType: 'image/png' },
            { type: 'text', text: 'Captured Main whiteboard.' },
          ],
          details: { whiteboardId: 'main', mimeType: 'image/png' },
        }),
      });

      const config = await service.realtimeSessionConfig({ source: 'desktop' });
      expect(config.tools.map((tool) => tool.name)).toContain('drone_hub__capture_whiteboard');

      const result = await service.executeRealtimeTool({
        threadId: config.threadId,
        toolCallId: 'call_capture_whiteboard',
        toolName: 'drone_hub__capture_whiteboard',
        arguments: {},
        source: 'desktop',
      });
      expect(result.output).toContain('whiteboardId');
      expect((result.result as any).whiteboardId).toBe('main');

      const toolResult = history.find((message: any) => message.role === 'toolResult' && message.toolCallId === 'call_capture_whiteboard');
      expect(toolResult.content.some((part: any) => part.type === 'image' && part.mimeType === 'image/png' && part.data === pngData)).toBe(true);
    });
  });
});
