#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import { tasksCreate, tasksDelete, tasksGet, tasksList, tasksSearch, type DroneClient } from './host/api';

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
  if (!token) throw new Error(`missing tasks token at ${tokenPath}`);
  return token;
}

async function createClient(): Promise<DroneClient> {
  return {
    baseUrl: resolveBaseUrl(),
    token: await resolveToken(),
  };
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

type TaskListItem = {
  id: string;
  title: string;
  description?: string;
  typeId?: string;
  typeLabel?: string;
  laneId?: string;
  laneTitle?: string;
  playbookId?: string;
  playbookLabel?: string;
  droneId?: string;
  droneName?: string;
  createdAt?: string;
  updatedAt?: string;
  score?: number;
  reasons?: string[];
};

type TaskListResponse = {
  ok?: boolean;
  actor?: { id?: string | null; name?: string | null };
  playbook?: { id?: string | null; label?: string | null } | null;
  repoPath?: string | null;
  taskTypes?: Array<{ id?: string; label?: string; active?: boolean }>;
  tasks?: TaskListItem[];
  task?: TaskListItem;
  updatedAt?: string;
  query?: string;
};

function truncateSingleLine(raw: unknown, maxChars: number): string {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function headerLines(response: TaskListResponse): string[] {
  const lines: string[] = [];
  const playbookLabel = String(response.playbook?.label ?? '').trim();
  const repoPath = String(response.repoPath ?? '').trim();
  if (playbookLabel) lines.push(`Playbook: ${playbookLabel}`);
  if (repoPath) lines.push(`Repo: ${repoPath}`);
  return lines;
}

function formatTaskListItem(task: TaskListItem, index: number, includeScore = false): string[] {
  const lines = [`${index + 1}. [${String(task.typeLabel ?? task.typeId ?? 'Task')}] ${task.title}`];
  lines.push(`   id: ${task.id}`);
  const laneTitle = String(task.laneTitle ?? task.laneId ?? '').trim();
  if (laneTitle) lines.push(`   lane: ${laneTitle}`);
  if (includeScore && typeof task.score === 'number') {
    const reasons = Array.isArray(task.reasons) && task.reasons.length > 0 ? ` (${task.reasons.join(', ')})` : '';
    lines.push(`   score: ${task.score}${reasons}`);
  }
  const description = truncateSingleLine(task.description, 220);
  if (description) lines.push(`   description: ${description}`);
  return lines;
}

function printTaskList(response: TaskListResponse, opts?: { query?: string }): void {
  const tasks = Array.isArray(response.tasks) ? response.tasks : [];
  const lines = headerLines(response);
  if (opts?.query) lines.push(`Search: ${opts.query}`);
  lines.push(`Tasks: ${tasks.length}`);
  if (tasks.length === 0) {
    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }
  const body = tasks.flatMap((task, index) => formatTaskListItem(task, index, Boolean(opts?.query)));
  process.stdout.write(`${[...lines, '', ...body].join('\n')}\n`);
}

function printTaskDetails(response: TaskListResponse): void {
  const task = response.task;
  if (!task) throw new Error('missing task');
  const lines = headerLines(response);
  lines.push(`[${String(task.typeLabel ?? task.typeId ?? 'Task')}] ${task.title}`);
  lines.push(`id: ${task.id}`);
  const laneTitle = String(task.laneTitle ?? task.laneId ?? '').trim();
  if (laneTitle) lines.push(`lane: ${laneTitle}`);
  const droneName = String(task.droneName ?? '').trim();
  if (droneName) lines.push(`drone: ${droneName}`);
  if (task.createdAt) lines.push(`created: ${task.createdAt}`);
  if (task.updatedAt) lines.push(`updated: ${task.updatedAt}`);
  const description = String(task.description ?? '').trim();
  if (description) {
    lines.push('');
    lines.push('Description:');
    lines.push(description);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

const program = new Command()
  .name('tasks')
  .description('Local task CLI for the drone daemon')
  .showHelpAfterError();

program
  .command('list')
  .description('List tasks visible to this drone')
  .option('-t, --type <typeId>', 'Filter by task type', (value, previous: string[]) => [...previous, value], [])
  .option('--json', 'Print raw JSON')
  .action(async (options: { type: string[]; json?: boolean }) => {
    const client = await createClient();
    const response = await tasksList(client, { typeIds: options.type });
    if (options.json) {
      printJson(response);
      return;
    }
    printTaskList(response);
  });

program
  .command('get')
  .description('Show full details for one task')
  .argument('<taskId>', 'Task id')
  .option('--json', 'Print raw JSON')
  .action(async (taskId: string, options: { json?: boolean }) => {
    const client = await createClient();
    const response = await tasksGet(client, taskId);
    if (options.json) {
      printJson(response);
      return;
    }
    printTaskDetails(response);
  });

program
  .command('search')
  .description('Fuzzy-search tasks visible to this drone')
  .option('-t, --type <typeId>', 'Filter by task type', (value, previous: string[]) => [...previous, value], [])
  .option('--json', 'Print raw JSON')
  .argument('<query>', 'Search text')
  .action(async (query: string, options: { type: string[]; json?: boolean }) => {
    const client = await createClient();
    const response = await tasksSearch(client, { query, typeIds: options.type });
    if (options.json) {
      printJson(response);
      return;
    }
    printTaskList(response, { query });
  });

program
  .command('create')
  .description('Create a task visible to this drone scope')
  .requiredOption('-t, --type <typeId>', 'Task type id')
  .option('-d, --description <text>', 'Task description')
  .argument('<title>', 'Task title')
  .action(async (title: string, options: { type: string; description?: string }) => {
    const client = await createClient();
    printJson(
      await tasksCreate(client, {
        title,
        typeId: options.type,
        ...(typeof options.description === 'string' ? { description: options.description } : {}),
      }),
    );
  });

program
  .command('delete')
  .alias('rm')
  .description('Delete a task visible to this drone scope')
  .argument('<taskId>', 'Task id')
  .action(async (taskId: string) => {
    const client = await createClient();
    printJson(await tasksDelete(client, taskId));
  });

async function main() {
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.stderr.write(`${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});
