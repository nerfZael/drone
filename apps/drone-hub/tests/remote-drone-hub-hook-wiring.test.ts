import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/droneHub/app/use-remote-drone-hub.ts', import.meta.url),
  'utf8',
);

describe('remote Drone Hub hook wiring', () => {
  test('keeps chat loading and SSE subscription stable across chat selection', () => {
    expect(source).toContain('const loadChat = React.useCallback');
    expect(source).toContain('return chatLoadCoordinator.request(key, { quiet });');
    expect(source).toContain('    [chatLoadCoordinator],\n  );');
    expect(source).toContain('setLoadingChat(true);\n        setChatError(null);');
    expect(source).toContain('selectedDroneIdRef.current !== droneId');
    expect(source).toContain('selectedChatRef.current !== chatName');
    expect(source).toContain('}, [loadChat, loadDrones, targetDeviceId]);');
    expect(source).not.toContain('[routeAvailable, selectedChat, selectedDroneId, targetDeviceId]');
  });

  test('resets queued loads on selection changes and unmount', () => {
    expect(source).toContain('chatLoadCoordinator.reset();\n    chatVersion.current += 1;');
    expect(source).toContain('mountedRef.current = false;');
    expect(source).toContain('dronesLoadCoordinator.reset();');
    expect(source).toContain('unsubscribe();');
  });
});
