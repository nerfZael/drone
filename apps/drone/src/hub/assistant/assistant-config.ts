import type { LlmProviderId } from '../hub-settings';
import {
  WORKFLOW_ASSISTANT_SYSTEM_PROMPT_LINE,
  WORKFLOW_ASSISTANT_TOOL_SUMMARIES,
} from '../workflows/workflow-assistant-tools';
import { WORKFLOW_MCP_TOOL_NAMES } from '../workflows/workflow-tool-names';
import type { AssistantThinkingLevel, AssistantToolSummary } from './assistant-contracts';

export const ASSISTANT_THREAD_MESSAGE_LIMIT = 80;
export const ASSISTANT_SYSTEM_PROMPT_MAX_CHARS = 20_000;
export const CHAT_MESSAGE_DEFAULT_LIMIT = 10;
export const CHAT_MESSAGE_MAX_LIMIT = 50;
export const CHAT_MESSAGE_RESPONSE_MAX_BYTES = 500_000;
export const CHAT_IDLE_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const CHAT_IDLE_MAX_TIMEOUT_MS = 30 * 60 * 1000;
export const CHAT_IDLE_DEFAULT_POLL_INTERVAL_MS = 1000;
export const CHAT_IDLE_DEFAULT_IDLE_FOR_MS = 1000;
export const CHAT_IDLE_SUBSCRIPTION_EXPIRES_AFTER_MS = 24 * 60 * 60 * 1000;
export const CHAT_IDLE_MAX_SUBSCRIPTIONS = 200;
export const CHAT_IDLE_MAX_TARGETS = 20;
export const DRONE_READY_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const DRONE_READY_POLL_INTERVAL_MS = 250;
export const ASSISTANT_BASH_DEFAULT_TIMEOUT_MS = 30 * 60_000;
export const ASSISTANT_BASH_MAX_TIMEOUT_MS = 60 * 60_000;
export const ASSISTANT_SEARCH_MAX_CONTEXT_LINES = 10;
export const ASSISTANT_CHANGED_FILES_LIMIT = 200;
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol';
export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';
export const DEFAULT_THREAD_TITLE = 'New thread';
export const ASSISTANT_SYSTEM_PROMPT_RUNTIME_APPENDIX =
  'Current existing-drone access scope is appended at run time. It limits operations that target existing drones; enabled global creation tools are governed separately.';
export const ASSISTANT_CHAT_IDLE_PROMPT_LINE_LEGACY =
  'When you send a drone chat message and need the result later, call subscribe_to_chats_idle on the target chat. This returns immediately so you can continue other work. If there is nothing else to do, end your turn; the system will resume this thread when the subscribed chats become idle.';
export const ASSISTANT_CHAT_IDLE_PROMPT_LINE =
  'When you send drone chat messages and need results later, call subscribe_to_any_chat_idle to resume as soon as one target chat is idle, or subscribe_to_all_chats_idle to resume only after every target chat is idle. These tools return immediately so you can continue other work. If there is nothing else to do, end your turn; the system will resume this thread when the subscription fires.';
export const ASSISTANT_MULTI_TARGET_PROMPT_LINE =
  'Use list_targets to discover the workspaces enabled for this chat, including its optional private Artifacts workspace. Use set_target to choose the default workspace before a sequence of file operations, or pass target explicitly on an individual workspace tool. When two or more workspaces are available, use transfer_files to copy a file or folder directly between them.';
export const ASSISTANT_SINGLE_TARGET_PROMPT_LINE =
  "Filesystem tools are bound to this thread's only workspace. Call them without a target argument; list_targets and set_target are intentionally unavailable.";
export const ASSISTANT_NO_TARGET_PROMPT_LINE =
  'No workspace is enabled for this chat. Workspace file, patch, Git, shell, target-selection, and transfer tools are intentionally unavailable until the user enables a workspace.';
export const ASSISTANT_SYSTEM_PROMPT_DEFAULT = [
  'You are the Built-in agent, a concise operator embedded in the app.',
  'You help the user understand available drones and coordinate work across drone chats.',
  'Drone Hub MCP tools are opt-in. Use Drone Hub tool instructions only for tools enabled in this chat; never assume a missing tool is available.',
  'Use web_search for current information, documentation, news, prices, schedules, or facts that may have changed. Use fetch_content when the user gives a direct URL to read, inspect, summarize, or analyze. Cite source URLs in the final answer.',
  'Use list_drones before referring to specific drones unless the user already provided an exact drone id.',
  'Use list_chats to discover chats and read_chat in pages when you need drone conversation context.',
  WORKFLOW_ASSISTANT_SYSTEM_PROMPT_LINE,
  ASSISTANT_MULTI_TARGET_PROMPT_LINE,
  'Use list_files, search_files, read_file, write_file, and apply_patch to inspect and modify files in a workspace target. Prefer apply_patch for coordinated code edits.',
  'File results keep path as the runtime path and include relativePath when the path can be expressed relative to the drone workspace or repo root.',
  'Use get_working_tree_status as a read-only review helper before reviewing or editing; it only works for repo-attached drone targets.',
  'Use read_file line ranges and search_files context when you only need a focused section of a file.',
  'Use bash only when a command is the right tool for inspection, tests, builds, or small scripted checks in a workspace that grants execute access. Bash is approval-gated, non-interactive, and not for background processes.',
  'Use set_thinking_level when the user asks to change how much the agent thinks. It changes this chat to another supported thinking level for the same selected model and does not require approval.',
  'Use create_group for empty repository-scoped groups, set_drone_group for moving drones to one group, reorder_drones for sidebar order, open_drone_chat for UI navigation, highlight_drones to visually point out drones for about 10 seconds, and open_whiteboard/close_whiteboard for whiteboard panel navigation. Prefer immutable groupId values from list_groups when names are duplicated across repositories.',
  'Use whiteboard tools for simple diagrams, rectangles, arrows, and labels. Prefer structured shapes over raw scene JSON. Use capture_whiteboard when you need to inspect or share the full visible board as an image.',
  'File paths are interpreted by drone id plus path. Relative paths resolve inside the target drone workspace, usually the repo root for repo-backed drones.',
  'Chat timelines contain user messages and agent messages. Queued or pending user messages appear in the same timeline with a non-completed status.',
  ASSISTANT_CHAT_IDLE_PROMPT_LINE,
  'Do not load more chat pages than needed. Start with the latest page.',
  'Creating or cloning drones, creating chats, creating repository-scoped groups, opening chats, highlighting drones, and reordering the sidebar do not require approval. create_group requires the owning repoPath, except for the empty repoPath scope used by drones without a repository. create_drone creates a container child of this chat owner and automatically grants this chat read, write, and execute access; clone_drone does the same but also requires read access to its source. Those child operations are unavailable when this chat owner runs directly on the host. Creating a chat requires write access to its target and is unavailable on host-runtime targets. Renaming drones, changing drone groups, sending a user message to a drone, and running bash in a drone require user approval; explain briefly what you intend to do.',
  'File write tools require write access to the target drone and should be used carefully for concrete code or content edits.',
  'If an approval-gated write tool returns successfully, the user already approved that action. Do not ask for the same approval again.',
  'When creating a drone, omit fields you want inherited from the current open drone. Runtime is always container. Only set repoBranchSource=remote when the user asked for a remote branch and you have a remoteBranch value.',
  'Use clone_drone when the user asks for a copy of an existing ready container drone. Create and clone return after the new drone is ready; if you provided an initial message, subscribe to the new drone default chat when you need to resume after the drone responds.',
  'Do not claim a drone completed work unless the drone transcript or user says so.',
  'Keep responses practical and short.',
].join('\n');
const ASSISTANT_TOOL_SUMMARY_DEFINITIONS: AssistantToolSummary[] = [
  {
    name: 'list_drones',
    label: 'List drones',
    category: 'drones',
    description: 'List drones visible to this chat.',
  },
  {
    name: 'list_repos',
    label: 'List repositories',
    category: 'drones',
    description: 'List repositories known to Drone Hub.',
  },
  {
    name: 'list_groups',
    label: 'List groups',
    category: 'drones',
    description: 'List repository-scoped Drone Hub groups and immutable ids.',
  },
  {
    name: 'web_search',
    label: 'Web search',
    category: 'context',
    description: 'Search the web for current information and source URLs.',
  },
  {
    name: 'fetch_content',
    label: 'Fetch content',
    category: 'context',
    description: 'Fetch readable page content from a URL.',
  },
  {
    name: 'list_whiteboards',
    label: 'List whiteboards',
    category: 'context',
    description: 'List backend-saved Drone Hub whiteboards.',
  },
  {
    name: 'read_whiteboard',
    label: 'Read whiteboard',
    category: 'context',
    description: 'Read a whiteboard scene summary and elements.',
  },
  {
    name: 'create_whiteboard',
    label: 'Create whiteboard',
    category: 'actions',
    description: 'Create a new backend-saved whiteboard.',
  },
  {
    name: 'update_whiteboard',
    label: 'Update whiteboard',
    category: 'actions',
    description: 'Add, delete, or update simple whiteboard shapes.',
  },
  {
    name: 'capture_whiteboard',
    label: 'Capture whiteboard',
    category: 'context',
    description: 'Render the full visible whiteboard as a PNG image.',
  },
  {
    name: 'open_whiteboard',
    label: 'Open whiteboard',
    category: 'actions',
    description: 'Open the Whiteboard panel in Drone Hub.',
  },
  {
    name: 'close_whiteboard',
    label: 'Close whiteboard',
    category: 'actions',
    description: 'Close the Whiteboard panel in Drone Hub.',
  },
  {
    name: 'get_system_prompt',
    label: 'Get system prompt',
    category: 'prompts',
    description: 'Read the global and current chat system prompts.',
  },
  {
    name: 'update_system_prompt',
    label: 'Update system prompt',
    category: 'prompts',
    description: 'Update only this chat system prompt.',
  },
  {
    name: 'set_thinking_level',
    label: 'Set thinking level',
    category: 'actions',
    description:
      'Change this chat to a supported thinking level for its current model.',
  },
  {
    name: 'list_targets',
    label: 'List workspace targets',
    category: 'files',
    description: 'List the workspaces enabled for this chat.',
  },
  {
    name: 'set_target',
    label: 'Set workspace target',
    category: 'files',
    description: 'Choose the default target for later workspace tool calls.',
  },
  {
    name: 'transfer_files',
    label: 'Transfer files',
    category: 'files',
    description: 'Copy a file or folder between two accessible workspace targets.',
  },
  {
    name: 'list_files',
    label: 'List files',
    category: 'files',
    description: 'List files and folders in a workspace target.',
  },
  {
    name: 'get_working_tree_status',
    label: 'Get working tree status',
    category: 'files',
    description: 'Inspect Git status in a repo-backed workspace target.',
  },
  {
    name: 'read_file',
    label: 'Read file',
    category: 'files',
    description: 'Read a UTF-8 text file from a workspace target.',
  },
  {
    name: 'search_files',
    label: 'Search files',
    category: 'files',
    description: 'Search text files in a workspace target.',
  },
  {
    name: 'write_file',
    label: 'Write file',
    category: 'files',
    description: 'Create or overwrite a UTF-8 text file in a writable workspace target.',
  },
  {
    name: 'delete_file',
    label: 'Delete file',
    category: 'files',
    description: 'Delete a file from a writable workspace target.',
  },
  {
    name: 'create_directory',
    label: 'Create directory',
    category: 'files',
    description: 'Create a directory in a writable workspace target.',
  },
  {
    name: 'delete_directory',
    label: 'Delete directory',
    category: 'files',
    description: 'Delete a directory from a writable workspace target.',
  },
  {
    name: 'move_path',
    label: 'Move path',
    category: 'files',
    description: 'Move or rename a file or directory in a writable workspace target.',
  },
  {
    name: 'bash',
    label: 'Run bash',
    category: 'actions',
    description: 'Run a non-interactive bash command in a shell-capable workspace target.',
  },
  {
    name: 'apply_patch',
    label: 'Apply patch',
    category: 'actions',
    description: 'Apply a patch envelope to a writable workspace target.',
  },
  {
    name: 'list_chats',
    label: 'List chats',
    category: 'chats',
    description: 'List chats for a drone.',
  },
  {
    name: 'read_chat',
    label: 'Read chat',
    category: 'chats',
    description: 'Read a paginated timeline for a drone chat.',
  },
  {
    name: 'subscribe_to_any_chat_idle',
    label: 'Subscribe to any chat idle',
    category: 'chats',
    description: 'Resume this thread when any subscribed drone chat becomes idle.',
  },
  {
    name: 'subscribe_to_all_chats_idle',
    label: 'Subscribe to all chats idle',
    category: 'chats',
    description: 'Resume this thread when all subscribed drone chats become idle.',
  },
  {
    name: 'list_chat_idle_subscriptions',
    label: 'List chat idle subscriptions',
    category: 'chats',
    description: 'List durable chat-idle subscriptions associated with this assistant session.',
  },
  {
    name: 'cancel_chat_idle_subscription',
    label: 'Cancel chat idle subscription',
    category: 'chats',
    description: 'Cancel a durable chat-idle subscription.',
  },
  ...WORKFLOW_ASSISTANT_TOOL_SUMMARIES,
  {
    name: 'create_drone',
    label: 'Create drone',
    category: 'drones',
    description: 'Create a new container drone.',
  },
  {
    name: 'clone_drone',
    label: 'Clone drone',
    category: 'actions',
    description: 'Clone an existing container drone into a new container drone.',
  },
  {
    name: 'create_chat',
    label: 'Create chat',
    category: 'actions',
    description: 'Create a new chat in an existing drone.',
  },
  {
    name: 'open_drone_chat',
    label: 'Open drone chat',
    category: 'actions',
    description: 'Open an existing drone chat in the Drone Hub UI.',
  },
  {
    name: 'open_drone',
    label: 'Open drone',
    category: 'actions',
    description: 'Open a drone in the Drone Hub UI.',
  },
  {
    name: 'highlight_drones',
    label: 'Highlight drones',
    category: 'actions',
    description: 'Temporarily highlight one or more drones in the Drone Hub UI.',
  },
  {
    name: 'create_group',
    label: 'Create group',
    category: 'actions',
    description: 'Create an empty group scoped to one repository.',
  },
  {
    name: 'reorder_drones',
    label: 'Reorder drones',
    category: 'actions',
    description: 'Reorder drones within one repository-scoped sidebar group.',
  },
  {
    name: 'rename_drones',
    label: 'Rename drones',
    category: 'actions',
    description: 'Rename one or more drones after user approval.',
  },
  {
    name: 'set_drone_group',
    label: 'Set drone group',
    category: 'actions',
    description: 'Move drones to a group after user approval.',
  },
  {
    name: 'send_message',
    label: 'Send message',
    category: 'actions',
    description: 'Send a user message to a drone chat after approval.',
  },
];
const DRONE_HUB_MCP_TOOL_NAMES = new Set([
  'list_drones',
  'list_repos',
  'list_groups',
  'create_group',
  'set_drone_group',
  'rename_drones',
  'reorder_drones',
  'open_drone_chat',
  'open_drone',
  'highlight_drones',
  'list_whiteboards',
  'read_whiteboard',
  'create_whiteboard',
  'update_whiteboard',
  'capture_whiteboard',
  'open_whiteboard',
  'close_whiteboard',
  'create_drone',
  'clone_drone',
  'list_chats',
  'create_chat',
  'send_message',
  'subscribe_to_any_chat_idle',
  'subscribe_to_all_chats_idle',
  'list_chat_idle_subscriptions',
  'cancel_chat_idle_subscription',
  'read_chat',
  ...WORKFLOW_MCP_TOOL_NAMES,
]);
export const ASSISTANT_TOOL_SUMMARIES: AssistantToolSummary[] =
  ASSISTANT_TOOL_SUMMARY_DEFINITIONS.map((tool) =>
    DRONE_HUB_MCP_TOOL_NAMES.has(tool.name)
      ? { ...tool, group: { kind: 'mcp', id: 'drone-hub', label: 'Drone Hub' } }
      : tool,
  );
export const ASSISTANT_ALL_TOOL_NAMES = ASSISTANT_TOOL_SUMMARIES.map((tool) => tool.name);
export const ASSISTANT_WORKSPACE_TOOL_CAPABILITIES = {
  list_files: 'files.list',
  get_working_tree_status: 'git.status',
  read_file: 'files.read',
  search_files: 'files.search',
  write_file: 'files.write',
  delete_file: 'files.delete',
  create_directory: 'directories.create',
  delete_directory: 'directories.delete',
  move_path: 'files.move',
  bash: 'shell.execute',
  apply_patch: 'patch.apply',
} as const;
export const ASSISTANT_READ_ONLY_DENIED_TOOL_NAMES = new Set([
  'transfer_files',
  'create_whiteboard',
  'update_whiteboard',
  'create_drone',
  'clone_drone',
  'create_chat',
  'create_group',
  'reorder_drones',
  'rename_drones',
  'set_drone_group',
  'set_drone_groups',
  'message_drone',
  'send_message',
  'cancel_chat_idle_subscription',
  'create_workflow',
  'update_workflow',
  'delete_workflow',
  'execute_workflow',
  'cancel_workflow_run',
]);
export const ASSISTANT_PRE_MCP_OPT_IN_DEFAULT_ENABLED_TOOL_NAMES = ASSISTANT_ALL_TOOL_NAMES.filter(
  (name) =>
    name !== 'get_system_prompt' &&
    name !== 'update_system_prompt' &&
    name !== 'set_thinking_level',
);
export const ASSISTANT_DRONE_HUB_MCP_TOOL_NAMES = ASSISTANT_TOOL_SUMMARIES.filter(
  (tool) => tool.group?.kind === 'mcp' && tool.group.id === 'drone-hub',
).map((tool) => tool.name);
const ASSISTANT_DRONE_HUB_MCP_TOOL_NAME_SET = new Set(ASSISTANT_DRONE_HUB_MCP_TOOL_NAMES);
export const ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES =
  ASSISTANT_PRE_MCP_OPT_IN_DEFAULT_ENABLED_TOOL_NAMES.filter(
    (name) => !ASSISTANT_DRONE_HUB_MCP_TOOL_NAME_SET.has(name),
  );
export const ASSISTANT_DEFAULT_TOOL_MIGRATION_NAMES = [
  'transfer_files',
  'rename_drones',
  'open_drone_chat',
  'highlight_drones',
  'create_group',
  'reorder_drones',
  'list_whiteboards',
  'read_whiteboard',
  'create_whiteboard',
  'update_whiteboard',
  'capture_whiteboard',
  'open_whiteboard',
  'close_whiteboard',
];
export const ASSISTANT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES =
  ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES.filter((name) => name !== 'create_chat');
export const ASSISTANT_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES =
  ASSISTANT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES.filter(
    (name) => name !== 'subscribe_to_any_chat_idle' && name !== 'subscribe_to_all_chats_idle',
  ).concat('subscribe_to_chats_idle');
export const ASSISTANT_PRE_FETCH_CONTENT_DEFAULT_ENABLED_TOOL_NAMES =
  ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES.filter((name) => name !== 'fetch_content');
export const ASSISTANT_PRE_FETCH_CONTENT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES =
  ASSISTANT_PRE_FETCH_CONTENT_DEFAULT_ENABLED_TOOL_NAMES.filter((name) => name !== 'create_chat');
export const ASSISTANT_PRE_FETCH_CONTENT_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES =
  ASSISTANT_PRE_FETCH_CONTENT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES.filter(
    (name) => name !== 'subscribe_to_any_chat_idle' && name !== 'subscribe_to_all_chats_idle',
  ).concat('subscribe_to_chats_idle');
export const ASSISTANT_PRE_WEB_SEARCH_DEFAULT_ENABLED_TOOL_NAMES =
  ASSISTANT_PRE_FETCH_CONTENT_DEFAULT_ENABLED_TOOL_NAMES.filter((name) => name !== 'web_search');
export const ASSISTANT_PRE_WEB_SEARCH_LEGACY_DEFAULT_ENABLED_TOOL_NAMES =
  ASSISTANT_PRE_WEB_SEARCH_DEFAULT_ENABLED_TOOL_NAMES.filter((name) => name !== 'create_chat');
export const ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES =
  ASSISTANT_PRE_WEB_SEARCH_LEGACY_DEFAULT_ENABLED_TOOL_NAMES.filter(
    (name) => name !== 'subscribe_to_any_chat_idle' && name !== 'subscribe_to_all_chats_idle',
  ).concat('subscribe_to_chats_idle');
type AssistantModelOptionDefinition = {
  provider: LlmProviderId;
  id: string;
  name: string;
  thinkingLevel: AssistantThinkingLevel;
};

const ASSISTANT_REASONING_LEVELS: AssistantThinkingLevel[] = ['off', 'low', 'medium', 'high'];

function reasoningModelOptions(
  provider: LlmProviderId,
  id: string,
  name: string,
): AssistantModelOptionDefinition[] {
  return ASSISTANT_REASONING_LEVELS.map((thinkingLevel) => ({ provider, id, name, thinkingLevel }));
}

export const ASSISTANT_MODEL_OPTIONS: AssistantModelOptionDefinition[] = [
  ...reasoningModelOptions('openai', 'gpt-5.6-sol', 'GPT-5.6 Sol'),
  ...reasoningModelOptions('openai', 'gpt-5.6-terra', 'GPT-5.6 Terra'),
  ...reasoningModelOptions('openai', 'gpt-5.6-luna', 'GPT-5.6 Luna'),
  ...reasoningModelOptions('openai', 'gpt-5.5', 'GPT-5.5'),
  ...reasoningModelOptions('codex', 'gpt-5.6-sol', 'GPT-5.6 Sol'),
  ...reasoningModelOptions('codex', 'gpt-5.6-terra', 'GPT-5.6 Terra'),
  ...reasoningModelOptions('codex', 'gpt-5.6-luna', 'GPT-5.6 Luna'),
  ...reasoningModelOptions('codex', 'gpt-5.5', 'GPT-5.5'),
  {
    provider: 'gemini',
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    thinkingLevel: 'medium',
  },
];
