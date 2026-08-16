import type { CompanionClientTransport, CompanionServerMessage } from '@drone/assistant-chat';

const COMPANION_CONNECTION_TIMEOUT_MS = 10_000;

export function createCompanionWebSocketTransport(url: string): CompanionClientTransport {
  let socket: WebSocket | null = null;
  let closing = false;

  return {
    async open({ onMessage, onDisconnect }) {
      const connectionStartedAt = performance.now();
      await new Promise<void>((resolve, reject) => {
        try {
          socket = new WebSocket(url);
        } catch (error) {
          reject(connectionError(error));
          return;
        }

        const activeSocket = socket;
        let opened = false;
        let disconnectReported = false;
        let connectionTimer: number | null = window.setTimeout(() => {
          connectionTimer = null;
          if (opened || closing) return;
          activeSocket.close();
          reject(new Error('Companion could not connect to Drone Hub.'));
        }, COMPANION_CONNECTION_TIMEOUT_MS);
        const clearConnectionTimer = () => {
          if (connectionTimer == null) return;
          window.clearTimeout(connectionTimer);
          connectionTimer = null;
        };
        const reportDisconnect = (message: string) => {
          if (closing || disconnectReported) return;
          disconnectReported = true;
          onDisconnect(message);
        };

        activeSocket.onopen = () => {
          if (closing) {
            activeSocket.close();
            reject(new Error('Companion connection was closed.'));
            return;
          }
          opened = true;
          clearConnectionTimer();
          resolve();
        };
        activeSocket.onmessage = (event) => {
          if (typeof event.data !== 'string') return;
          try {
            onMessage(JSON.parse(event.data) as CompanionServerMessage);
          } catch {
            // Ignore malformed server messages and keep the active session alive.
          }
        };
        activeSocket.onerror = () => {
          clearConnectionTimer();
          if (!opened) {
            reject(new Error('Companion could not connect to Drone Hub.'));
            return;
          }
          reportDisconnect('Companion could not connect to Drone Hub.');
        };
        activeSocket.onclose = () => {
          clearConnectionTimer();
          if (socket === activeSocket) socket = null;
          if (!opened) {
            reject(new Error('Companion could not connect to Drone Hub.'));
            return;
          }
          reportDisconnect('Companion disconnected before the run finished.');
        };
      });
      return {
        connectionMs: Math.max(0, performance.now() - connectionStartedAt),
        connectionReused: false,
      };
    },
    sendPrompt(input) {
      send({ type: 'start_run', ...input });
    },
    sendToolResult(input) {
      send({ type: 'tool_result', ...input });
    },
    cancel(runId) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'cancel_run', runId }));
      }
    },
    close() {
      closing = true;
      const activeSocket = socket;
      socket = null;
      activeSocket?.close();
    },
  };

  function send(message: unknown): void {
    if (socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Companion browser disconnected');
    }
    socket.send(JSON.stringify(message));
  }
}

function connectionError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Companion could not connect to Drone Hub.');
}
