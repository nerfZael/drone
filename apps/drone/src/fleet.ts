#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import {
  fleetCapabilities,
  fleetHelp,
  fleetRequestCreate,
  fleetRequestGet,
  type DroneClient,
} from './host/api';
import type { FleetRequestType } from './fleet/contracts';

function resolveBaseUrl(): string {
  const explicit =
    process.env.FLEET_DAEMON_BASE_URL?.trim() ||
    process.env.DRONE_DAEMON_BASE_URL?.trim() ||
    process.env.DRONE_BASE_URL?.trim();
  if (explicit) return explicit;
  const portRaw = process.env.FLEET_DAEMON_PORT?.trim() || process.env.DRONE_DAEMON_PORT?.trim() || process.env.DRONE_PORT?.trim() || '7777';
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`invalid daemon port: ${portRaw}`);
  return `http://127.0.0.1:${Math.floor(port)}`;
}

async function resolveToken(): Promise<string> {
  const explicit = process.env.FLEET_TOKEN?.trim() || process.env.DRONE_TOKEN?.trim();
  if (explicit) return explicit;
  const tokenPath = process.env.FLEET_TOKEN_FILE?.trim() || '/dvm-data/drone/token';
  const raw = await fs.readFile(tokenPath, 'utf8');
  const token = raw.trim();
  if (!token) throw new Error(`missing fleet token at ${tokenPath}`);
  return token;
}

async function createClient(): Promise<DroneClient> {
  return {
    baseUrl: resolveBaseUrl(),
    token: await resolveToken(),
  };
}

async function waitForFleetRequest(client: DroneClient, id: string, opts?: { timeoutMs?: number; pollMs?: number }) {
  const timeoutMs = Number.isFinite(opts?.timeoutMs) ? Math.max(1, Math.floor(opts?.timeoutMs as number)) : 60_000;
  const pollMs = Number.isFinite(opts?.pollMs) ? Math.max(50, Math.floor(opts?.pollMs as number)) : 500;
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response: any = await fleetRequestGet(client, id);
    const request = response?.request ?? null;
    if (!request) throw new Error(`request disappeared: ${id}`);
    if (request.state === 'done' || request.state === 'failed') return request;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`fleet request timeout after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function createFleetRequestAndMaybeWait(
  client: DroneClient,
  opts: {
    type: FleetRequestType;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
    wait?: boolean;
    timeoutMs?: string | number;
    pollMs?: string | number;
  },
) {
  const response: any = await fleetRequestCreate(client, {
    ...(opts.idempotencyKey ? { idempotencyKey: String(opts.idempotencyKey) } : {}),
    type: opts.type,
    payload: opts.payload,
  });
  const request = response?.request ?? null;
  if (opts.wait === false || !request?.id) return response;
  return {
    ok: true,
    request: await waitForFleetRequest(client, String(request.id), {
      timeoutMs: Number(opts.timeoutMs),
      pollMs: Number(opts.pollMs),
    }),
  };
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function resolveMessageText(parts: string[], optionMessage?: string): Promise<string> {
  const fromOption = String(optionMessage ?? '').trim();
  if (fromOption) return fromOption;
  const fromArgs = parts.join(' ').trim();
  if (fromArgs) return fromArgs;
  const stdin = await new Promise<string>((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks: string[] = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => chunks.push(String(chunk)));
    process.stdin.on('end', () => resolve(chunks.join('').trim()));
    process.stdin.on('error', reject);
  });
  if (stdin) return stdin;
  throw new Error('missing message');
}

const program = new Command()
  .name('fleet')
  .description('Local fleet CLI for the drone daemon')
  .showHelpAfterError();

program
  .command('capabilities')
  .description('Show the daemon-synced fleet policy snapshot for this drone')
  .action(async () => {
    const client = await createClient();
    printJson(await fleetCapabilities(client));
  });

program
  .command('daemon-help')
  .description('Show daemon-provided fleet operation help')
  .action(async () => {
    const client = await createClient();
    printJson(await fleetHelp(client));
  });

program
  .command('create')
  .description('Queue a child drone creation request')
  .requiredOption('--name <name>', 'Child drone name')
  .option('--group <group>', 'Optional group override')
  .option('--clone-parent', 'Clone the parent drone into the child with a fresh chat', false)
  .option('--idempotency-key <key>', 'Stable idempotency key')
  .option('--wait', 'Wait for the hub reconciler result', false)
  .option('--timeout-ms <n>', 'Wait timeout in milliseconds', '60000')
  .option('--poll-ms <n>', 'Status poll interval in milliseconds', '500')
  .action(
    async (options: {
      name: string;
      group?: string;
      cloneParent?: boolean;
      idempotencyKey?: string;
      wait?: boolean;
      timeoutMs: string;
      pollMs: string;
    }) => {
      const client = await createClient();
      printJson(
        await createFleetRequestAndMaybeWait(client, {
          idempotencyKey: options.idempotencyKey,
          wait: options.wait,
          timeoutMs: options.timeoutMs,
          pollMs: options.pollMs,
          type: 'create_child',
          payload: {
            name: String(options.name),
            ...(options.group ? { group: String(options.group) } : {}),
            ...(options.cloneParent ? { cloneParent: true } : {}),
          },
        }),
      );
    },
  );

program
  .command('send')
  .description('Queue a message to another drone chat')
  .requiredOption('--to <drone>', 'Target drone id or name')
  .option('--chat <chat>', 'Target chat name', 'default')
  .option('--message <text>', 'Message body')
  .option('--idempotency-key <key>', 'Stable idempotency key')
  .option('--wait', 'Wait for the hub reconciler result', false)
  .option('--timeout-ms <n>', 'Wait timeout in milliseconds', '60000')
  .option('--poll-ms <n>', 'Status poll interval in milliseconds', '500')
  .argument('[messageParts...]', 'Message text when --message is omitted')
  .action(
    async (
      messageParts: string[],
      options: { to: string; chat?: string; message?: string; idempotencyKey?: string; wait?: boolean; timeoutMs: string; pollMs: string },
    ) => {
      const client = await createClient();
      const message = await resolveMessageText((messageParts as string[]) ?? [], options.message ? String(options.message) : undefined);
      printJson(
        await createFleetRequestAndMaybeWait(client, {
          idempotencyKey: options.idempotencyKey,
          wait: options.wait,
          timeoutMs: options.timeoutMs,
          pollMs: options.pollMs,
          type: 'send_message',
          payload: {
            to: String(options.to),
            chat: String(options.chat || 'default'),
            message,
          },
        }),
      );
    },
  );

program
  .command('stop')
  .description('Interrupt the active response in another drone chat')
  .requiredOption('--to <drone>', 'Target drone id or name')
  .option('--chat <chat>', 'Target chat name', 'default')
  .option('--idempotency-key <key>', 'Stable idempotency key')
  .option('--wait', 'Wait for the hub reconciler result', false)
  .option('--timeout-ms <n>', 'Wait timeout in milliseconds', '60000')
  .option('--poll-ms <n>', 'Status poll interval in milliseconds', '500')
  .action(async (options: { to: string; chat?: string; idempotencyKey?: string; wait?: boolean; timeoutMs: string; pollMs: string }) => {
    const client = await createClient();
    printJson(
      await createFleetRequestAndMaybeWait(client, {
        idempotencyKey: options.idempotencyKey,
        wait: options.wait,
        timeoutMs: options.timeoutMs,
        pollMs: options.pollMs,
        type: 'stop_chat',
        payload: {
          to: String(options.to),
          chat: String(options.chat || 'default'),
        },
      }),
    );
  });

program
  .command('read')
  .description('Read paginated messages from a child or assigned drone')
  .requiredOption('--from <drone>', 'Source drone id or name')
  .option('--chat <chat>', 'Chat name', 'default')
  .option('--limit <n>', 'Page size', '20')
  .option('--cursor <cursor>', 'Opaque cursor from a prior read')
  .option('--order <order>', 'Sort order: asc|desc', 'desc')
  .option('--idempotency-key <key>', 'Stable idempotency key')
  .option('--no-wait', 'Do not wait for the hub reconciler result')
  .option('--timeout-ms <n>', 'Wait timeout in milliseconds', '60000')
  .option('--poll-ms <n>', 'Status poll interval in milliseconds', '500')
  .action(
    async (
      options: {
        from: string;
        chat?: string;
        limit: string;
        cursor?: string;
        order?: string;
        idempotencyKey?: string;
        wait: boolean;
        timeoutMs: string;
        pollMs: string;
      },
    ) => {
      const client = await createClient();
      printJson(
        await createFleetRequestAndMaybeWait(client, {
          idempotencyKey: options.idempotencyKey,
          wait: options.wait,
          timeoutMs: options.timeoutMs,
          pollMs: options.pollMs,
          type: 'read_messages',
          payload: {
            from: String(options.from),
            chat: String(options.chat || 'default'),
            limit: Number(options.limit),
            ...(options.cursor ? { cursor: String(options.cursor) } : {}),
            order: String(options.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc',
          },
        }),
      );
    },
  );

const requestCommand = program.command('request').description('Inspect queued fleet requests');

requestCommand
  .command('status')
  .description('Fetch a fleet request by id')
  .requiredOption('--id <id>', 'Fleet request id')
  .action(async (options: { id: string }) => {
    const client = await createClient();
    printJson(await fleetRequestGet(client, String(options.id)));
  });

async function main() {
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.stderr.write(`${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});
