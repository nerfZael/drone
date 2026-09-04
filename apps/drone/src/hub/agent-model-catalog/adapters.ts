import type { BuiltinAgentId } from '../chat-types';

type AgentModelCatalogAdapter = {
  binary: string;
  explicitCommands: readonly string[];
  hostSupported: boolean;
  modelCacheCommand?: string;
};

const CODEX_CACHE_COMMAND = [
  'set -euo pipefail',
  'paths=("${CODEX_HOME:-$HOME/.codex}/models_cache.json" "$HOME/.codex/models_cache.json" "/root/.codex/models_cache.json" "/dvm-data/home/.codex/models_cache.json")',
  'for p in "${paths[@]}"; do',
  '  if [ -f "$p" ]; then',
  '    cat "$p"',
  '    exit 0',
  '  fi',
  'done',
  'exit 1',
].join('\n');

const CLAUDE_EMBEDDED_MODELS_COMMAND = [
  'set -euo pipefail',
  'bin="$(command -v claude)"',
  `LC_ALL=C grep -aoE 'id:"claude-[^"]+",family:"(haiku|sonnet|opus|fable)",display_name:"[^"]+"' "$bin" | sort -u`,
].join('\n');

const ADAPTERS: Record<BuiltinAgentId, AgentModelCatalogAdapter> = {
  cursor: {
    binary: 'agent',
    explicitCommands: ['agent --list-models', 'agent models'],
    hostSupported: true,
  },
  codex: {
    binary: 'codex',
    explicitCommands: [
      'codex models --json',
      'codex models list --json',
      'codex models',
      'codex models list',
    ],
    hostSupported: true,
    modelCacheCommand: CODEX_CACHE_COMMAND,
  },
  claude: {
    binary: 'claude',
    // Claude Code has no model-list subcommand. Passing `models` is interpreted
    // as a prompt and starts a paid agent turn, so discovery must stay on the
    // non-interactive metadata embedded in the installed CLI.
    explicitCommands: [],
    hostSupported: true,
    modelCacheCommand: CLAUDE_EMBEDDED_MODELS_COMMAND,
  },
  opencode: {
    binary: 'opencode',
    explicitCommands: ['opencode models --json', 'opencode models'],
    hostSupported: true,
  },
  pi: {
    binary: 'pi',
    explicitCommands: ['pi --list-models'],
    hostSupported: true,
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

export const AGENT_MODEL_CATALOG_AGENT_IDS = Object.freeze(
  Object.keys(ADAPTERS) as BuiltinAgentId[],
);

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
