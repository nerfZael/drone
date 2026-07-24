import type { BuiltinAgentId } from '../chat-types';

type AgentModelCatalogAdapter = {
  binary: string;
  explicitCommands: readonly string[];
  hostSupported: boolean;
  containerCacheCommand?: string;
};

const CODEX_CACHE_COMMAND = [
  'set -euo pipefail',
  'paths=("$HOME/.codex/models_cache.json" "/root/.codex/models_cache.json" "/dvm-data/home/.codex/models_cache.json")',
  'for p in "${paths[@]}"; do',
  '  if [ -f "$p" ]; then',
  '    cat "$p"',
  '    exit 0',
  '  fi',
  'done',
  'exit 1',
].join('\n');

const ADAPTERS: Record<BuiltinAgentId, AgentModelCatalogAdapter> = {
  cursor: {
    binary: 'agent',
    explicitCommands: ['agent --list-models', 'agent models'],
    hostSupported: false,
  },
  codex: {
    binary: 'codex',
    explicitCommands: [
      'codex models --json',
      'codex models list --json',
      'codex models',
      'codex models list',
    ],
    hostSupported: false,
    containerCacheCommand: CODEX_CACHE_COMMAND,
  },
  claude: {
    binary: 'claude',
    explicitCommands: ['claude models --json', 'claude models'],
    hostSupported: false,
  },
  opencode: {
    binary: 'opencode',
    explicitCommands: ['opencode models --json', 'opencode models'],
    hostSupported: false,
  },
  pi: {
    binary: 'pi',
    explicitCommands: ['pi --list-models'],
    hostSupported: false,
  },
  blip: {
    binary: 'blip',
    explicitCommands: ['blip --list-models'],
    hostSupported: true,
  },
};

export function agentModelCatalogAdapter(agentId: BuiltinAgentId): AgentModelCatalogAdapter {
  return ADAPTERS[agentId];
}

export function modelListCommands(agentId: BuiltinAgentId, helpText: string): string[] {
  const adapter = agentModelCatalogAdapter(agentId);
  const commands: string[] = [];
  const hasModelsCommand = helpText
    .split('\n')
    .map((line) => line.trim())
    .some((line) => /^models?(?:\s{2,}.*)?$/i.test(line));

  if (/--list-models\b/i.test(helpText)) {
    commands.push(`${adapter.binary} --list-models`);
  }
  if (hasModelsCommand) {
    commands.push(
      `${adapter.binary} models --json`,
      `${adapter.binary} models list --json`,
      `${adapter.binary} models`,
      `${adapter.binary} models list`,
    );
  }
  commands.push(...adapter.explicitCommands);
  return Array.from(new Set(commands.map((command) => command.trim()).filter(Boolean)));
}
