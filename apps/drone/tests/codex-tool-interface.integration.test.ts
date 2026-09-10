import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexAppServerConnection } from '../src/codex-app-server';
import { codexToolInterfaceContext } from '../src/codex-model-routing';

// Opt-in: DRONE_TEST_CODEX_BINARY=codex bun test apps/drone/tests/codex-tool-interface.integration.test.ts
// Uses an isolated CODEX_HOME and local Responses fixture. No model API calls or
// credentials are needed. The only command the fixture requests is printf.
test.skipIf(!process.env.DRONE_TEST_CODEX_BINARY)('real Codex retains current tool guidance and executes commands across provider switches', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-tools-'));
  const requests: Array<{ turn: number; body: any }> = [];
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      if (request.method !== 'POST') return Response.json({ models: [], data: [] });
      const turn = Number(new URL(request.url).pathname.split('/')[1]);
      const body: any = await request.json();
      requests.push({ turn, body });
      return fixtureResponse(body, turn);
    },
  });
  let connection: CodexAppServerConnection | undefined;
  try {
    await fs.writeFile(path.join(root, 'config.toml'), 'developer_instructions = "Keep this configured project rule."\n');
    await fs.writeFile(path.join(root, 'models.json'), JSON.stringify({ models: [{
      slug: 'fixture-code-mode', display_name: 'Fixture', description: null,
      supported_reasoning_levels: [], shell_type: 'unified_exec', visibility: 'list',
      supported_in_api: true, priority: 0, support_verbosity: false,
      truncation_policy: { mode: 'tokens', limit: 10000 }, experimental_supported_tools: [],
      tool_mode: 'code_mode_only', context_window: 272000,
      base_instructions: 'Run commands inside functions.exec using tools.exec_command.',
    }] }));
    let threadId: string | undefined;
    for (let turn = 0; turn < 3; turn++) {
      const model = turn === 1 ? 'fixture-vendor/direct-model' : 'fixture-code-mode';
      const provider = turn === 1 ? 'fixture_openrouter' : 'fixture_default';
      let completed: any;
      const args = [process.env.DRONE_TEST_CODEX_BINARY!, 'app-server',
        '-c', `model_catalog_json=${JSON.stringify(path.join(root, 'models.json'))}`,
        '-c', `model_provider=${JSON.stringify(provider)}`,
        '-c', `model_providers.${provider}={name="Fixture",base_url="http://127.0.0.1:${server.port}/${turn}",wire_api="responses"}`];
      connection = new CodexAppServerConnection({
        launchScript: `exec ${args.map(quote).join(' ')}`, cwd: root,
        environment: async () => ({ CODEX_HOME: root }),
        onNotification: (message) => { if (message.method === 'turn/completed') completed = message.params.turn; },
      });
      const result = await connection.call(threadId ? 'thread/resume' : 'thread/start', {
        ...(threadId ? { threadId } : {}), model, modelProvider: provider,
        cwd: root, approvalPolicy: 'never', sandbox: 'danger-full-access',
      });
      if (threadId) expect(result.thread.id).toBe(threadId);
      threadId = result.thread.id;
      expect(result.modelProvider).toBe(provider);
      await connection.call('turn/start', {
        threadId, input: [{ type: 'text', text: `Continue turn ${turn}` }],
        additionalContext: codexToolInterfaceContext(turn === 1 ? `openrouter:${model}` : model),
      });
      const deadline = Date.now() + 20_000;
      while (!completed && Date.now() < deadline) await Bun.sleep(20);
      expect(completed?.status).toBe('completed');
      await connection.close();
      connection = undefined;
      const turnRequests = requests.filter((entry) => entry.turn === turn).map((entry) => entry.body);
      expect(turnRequests).toHaveLength(2);
      const output = turnRequests[1].input.at(-1);
      expect(output.type).toBe(turn === 1 ? 'function_call_output' : 'custom_tool_call_output');
      expect(JSON.stringify(output.output)).toContain('tool-switch-ok');
      const history = turnRequests[0].input;
      expect(history.some((item: any) => JSON.stringify(item).includes('Keep this configured project rule.'))).toBe(true);
      if (turn === 1) {
        expect(turnRequests[0].instructions).toContain('functions.exec');
        expect(turnRequests[0].tools.some((tool: any) => tool.name === 'exec_command')).toBe(true);
        expect(turnRequests[0].tools.some((tool: any) => tool.name === 'exec')).toBe(false);
        const guidance = history.filter((item: any) => item.role === 'developer' && JSON.stringify(item).includes('<drone_hub_tool_interface>'));
        expect(guidance).toHaveLength(1);
        expect(JSON.stringify(guidance)).toContain('current tool definitions take precedence');
      }
      if (turn > 0) expect(history.some((item: any) => item.call_id === `call-${turn - 1}`)).toBe(true);
    }
  } finally {
    await connection?.close();
    server.stop(true);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 75_000);

function fixtureResponse(body: any, turn: number): Response {
  const hasOutput = ['function_call_output', 'custom_tool_call_output'].includes(body.input.at(-1)?.type);
  const item = hasOutput
    ? { id: `msg-${turn}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }] }
    : turn === 1
      ? { id: `tool-${turn}`, call_id: `call-${turn}`, type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'printf tool-switch-ok', max_output_tokens: 100 }) }
      : { id: `tool-${turn}`, call_id: `call-${turn}`, type: 'custom_tool_call', name: 'exec', input: 'text(await tools.exec_command({cmd: "printf tool-switch-ok", max_output_tokens: 100}));' };
  const response = { id: `response-${turn}-${hasOutput}`, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } };
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}

function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
