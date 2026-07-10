import type { LlmProviderId } from '../hub-settings';
import type { AssistantThinkingLevel, AssistantToolSummary } from './assistant-contracts';

export const ASSISTANT_THREAD_MESSAGE_LIMIT = 80;
export const ASSISTANT_REGISTRY_MAX_THREADS = 24;
export const ASSISTANT_SYSTEM_PROMPT_MAX_CHARS = 20_000;
export const ASSISTANT_OVERVIEW_PROMPT_MAX_CHARS = 20_000;
export const ASSISTANT_OVERVIEW_INPUT_MAX_CHARS = 48_000;
export const ASSISTANT_PROMPT_MAX_ATTACHMENTS = 8;
export const ASSISTANT_PROMPT_MAX_ATTACHMENT_BYTES_EACH = 6 * 1024 * 1024;
export const ASSISTANT_PROMPT_MAX_ATTACHMENT_BYTES_TOTAL = 20 * 1024 * 1024;
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
export const ASSISTANT_VOICE_AUTO_SPEAK_MAX_CHARS = 600;
export const DRONE_READY_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const DRONE_READY_POLL_INTERVAL_MS = 250;
export const ASSISTANT_BASH_DEFAULT_TIMEOUT_MS = 30_000;
export const ASSISTANT_BASH_MAX_TIMEOUT_MS = 120_000;
export const ASSISTANT_SEARCH_MAX_CONTEXT_LINES = 10;
export const ASSISTANT_CHANGED_FILES_LIMIT = 200;
export const DEFAULT_OPENAI_MODEL = 'gpt-5.5';
export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_CODEX_MODEL = 'gpt-5.5';
export const DEFAULT_THREAD_TITLE = 'New thread';
export const ASSISTANT_SYSTEM_PROMPT_RUNTIME_APPENDIX =
  'Current access scope is appended at run time. The assistant must not claim read or write access outside that scope.';
export const ASSISTANT_CHAT_IDLE_PROMPT_LINE_LEGACY =
  'When you send a drone chat message and need the result later, call subscribe_to_chats_idle on the target chat. This returns immediately so you can continue other work. If there is nothing else to do, end your turn; the system will resume this thread when the subscribed chats become idle.';
export const ASSISTANT_CHAT_IDLE_PROMPT_LINE =
  'When you send drone chat messages and need results later, call subscribe_to_any_chat_idle to resume as soon as one target chat is idle, or subscribe_to_all_chats_idle to resume only after every target chat is idle. These tools return immediately so you can continue other work. If there is nothing else to do, end your turn; the system will resume this thread when the subscription fires.';
export const ASSISTANT_SYSTEM_PROMPT_DEFAULT = [
  'You are Drone Hub Assistant, a concise operator assistant embedded in the Drone Hub app.',
  'You help the user understand available drones and coordinate work across drone chats.',
  'Use get_current_context when the user asks about the current, active, selected, or open drone/chat, or before acting on phrases like "this drone".',
  'Use web_search for current information, documentation, news, prices, schedules, or facts that may have changed. Use fetch_content when the user gives a direct URL to read, inspect, summarize, or analyze. Cite source URLs in the final answer.',
  'Use list_drones before referring to specific drones unless the user already provided an exact drone id.',
  'Use get_chat_overview before reading chat details, then read_chat_messages in pages when you need conversation context.',
  'Use assistant_files to maintain private, thread-scoped Markdown notes when tracking work, decisions, plans, questions, or handoff details. These files are for the user-facing Artifacts UI and are not visible to drones.',
  'Use list_files, find_files, search_files, read_file, write_file, and apply_patch to inspect and modify files in drones you can access. Prefer apply_patch for coordinated code edits.',
  'File results keep path as the runtime path and include relativePath when the path can be expressed relative to the drone workspace or repo root.',
  'Use list_changed_files as a read-only review helper to inspect repo working tree status before reviewing or editing; it only works for repo-attached drones.',
  'Use read_file line ranges and search_files context when you only need a focused section of a file.',
  'Use bash only when a command is the right tool for inspection, tests, builds, or small scripted checks in an accessible container drone. Bash is approval-gated, non-interactive, and not for background processes.',
  'Use set_thinking_level when the user asks to change how much the assistant thinks. It changes this assistant thread to another supported thinking level for the same selected model and does not require approval.',
  'Use create_new_thread only when the user explicitly asks to start, open, create, clear, reset, or switch to a new assistant thread or session.',
  'Use create_group for empty groups, set_drone_group for moving one batch to one group, set_drone_groups when different drones need different groups or no group, reorder_drones for sidebar order, open_drone_chat for UI navigation, highlight_drones to visually point out drones for about 10 seconds, and open_whiteboard/close_whiteboard for whiteboard panel navigation.',
  'Use whiteboard tools for simple diagrams, rectangles, arrows, and labels. Prefer structured shapes over raw scene JSON. Use capture_whiteboard when you need to inspect or share the full visible board as an image.',
  'File paths are interpreted by drone id plus path. Relative paths resolve inside the target drone workspace, usually the repo root for repo-backed drones.',
  'Chat timelines contain user messages and agent messages. Queued or pending user messages appear in the same timeline with a non-completed status.',
  ASSISTANT_CHAT_IDLE_PROMPT_LINE,
  'Do not load more chat pages than needed. Start with the latest page.',
  'Creating or cloning drones, creating chats, creating groups, opening chats, highlighting drones, and reordering the sidebar do not require approval. Assistant-created drones must use the container (Docker) runtime. Renaming drones, changing drone groups, sending a user message to a drone, and running bash in a drone require user approval; explain briefly what you intend to do.',
  'File write tools require write access to the target drone and should be used carefully for concrete code or content edits.',
  'If an approval-gated write tool returns successfully, the user already approved that action. Do not ask for the same approval again.',
  'Realtime threads can use speak to send short spoken replies back to the voice device that started the request.',
  'When creating a drone, omit fields you want inherited from the current open drone. Runtime is always container even if the source drone uses host runtime. Only set repoBranchSource=remote when the user asked for a remote branch and you have a remoteBranch value.',
  'Use clone_drone when the user asks for a copy of an existing ready container drone. Create and clone return after the new drone is ready; if you provided an initial message, subscribe to the new drone default chat when you need to resume after the drone responds.',
  'Do not claim a drone completed work unless the drone transcript or user says so.',
  'Keep responses practical and short.',
].join('\n');
export const ASSISTANT_TOOL_SUMMARIES: AssistantToolSummary[] = [
  {
    name: 'list_drones',
    label: 'List drones',
    category: 'context',
    description: 'List drones visible to this assistant thread.',
  },
  {
    name: 'get_current_context',
    label: 'Get current context',
    category: 'context',
    description: 'Read the current Drone Hub UI context.',
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
    name: 'assistant_files',
    label: 'Assistant files',
    category: 'files',
    description: 'Maintain private Markdown or text artifacts for this thread.',
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
    description: 'Read the global and current thread system prompts.',
  },
  {
    name: 'update_system_prompt',
    label: 'Update system prompt',
    category: 'prompts',
    description: 'Update only this thread system prompt.',
  },
  {
    name: 'set_thinking_level',
    label: 'Set thinking level',
    category: 'actions',
    description:
      'Change this assistant thread to a supported thinking level for its current model.',
  },
  {
    name: 'create_new_thread',
    label: 'Create new thread',
    category: 'actions',
    description: 'Open a fresh assistant thread or voice session.',
  },
  {
    name: 'inspect_drone',
    label: 'Inspect drone',
    category: 'drones',
    description: 'Inspect one drone by id or name.',
  },
  {
    name: 'list_files',
    label: 'List files',
    category: 'files',
    description: 'List files and folders in one drone.',
  },
  {
    name: 'list_changed_files',
    label: 'List changed files',
    category: 'files',
    description: 'List changed files in one repo-attached drone.',
  },
  {
    name: 'read_file',
    label: 'Read file',
    category: 'files',
    description: 'Read a UTF-8 text file from one drone.',
  },
  {
    name: 'search_files',
    label: 'Search files',
    category: 'files',
    description: 'Search text files in one drone.',
  },
  {
    name: 'find_files',
    label: 'Find files',
    category: 'files',
    description: 'Find file and directory paths in one drone.',
  },
  {
    name: 'write_file',
    label: 'Write file',
    category: 'files',
    description: 'Create or overwrite a UTF-8 text file in one drone.',
  },
  {
    name: 'bash',
    label: 'Run bash',
    category: 'actions',
    description: 'Run a non-interactive bash command in one container drone.',
  },
  {
    name: 'apply_patch',
    label: 'Apply patch',
    category: 'actions',
    description: 'Apply a patch envelope to files in one drone.',
  },
  {
    name: 'get_chat_overview',
    label: 'Get chat overview',
    category: 'chats',
    description: 'Read a lightweight overview of drone chats.',
  },
  {
    name: 'read_chat_messages',
    label: 'Read chat messages',
    category: 'chats',
    description: 'Read a paginated timeline for a drone chat.',
  },
  {
    name: 'search_chat_messages',
    label: 'Search chat messages',
    category: 'chats',
    description: 'Search user and agent messages across drone chats.',
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
    name: 'speak',
    label: 'Speak',
    category: 'actions',
    description: 'Send a short spoken reply to the connected Android or desktop voice device.',
  },
  {
    name: 'create_drone',
    label: 'Create drone',
    category: 'actions',
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
    name: 'highlight_drones',
    label: 'Highlight drones',
    category: 'actions',
    description: 'Temporarily highlight one or more drones in the Drone Hub UI.',
  },
  {
    name: 'create_group',
    label: 'Create group',
    category: 'actions',
    description: 'Create an empty Drone Hub group.',
  },
  {
    name: 'set_drone_groups',
    label: 'Set drone groups',
    category: 'actions',
    description: 'Move different drones into different groups, or clear groups, after approval.',
  },
  {
    name: 'reorder_drones',
    label: 'Reorder drones',
    category: 'actions',
    description: 'Reorder drones in the sidebar.',
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
    name: 'message_drone',
    label: 'Send user message to drone',
    category: 'actions',
    description: 'Send a user message to a drone chat after approval.',
  },
];
export const ASSISTANT_ALL_TOOL_NAMES = ASSISTANT_TOOL_SUMMARIES.map((tool) => tool.name);
export const ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES = ASSISTANT_ALL_TOOL_NAMES.filter(
  (name) =>
    name !== 'get_system_prompt' &&
    name !== 'update_system_prompt' &&
    name !== 'set_thinking_level' &&
    name !== 'create_new_thread' &&
    name !== 'speak',
);
export const ASSISTANT_DEFAULT_TOOL_MIGRATION_NAMES = [
  'rename_drones',
  'open_drone_chat',
  'highlight_drones',
  'create_group',
  'set_drone_groups',
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
export const ASSISTANT_VOICE_DEFAULT_ENABLED_TOOL_NAMES = [
  ...ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES,
  'set_thinking_level',
  'create_new_thread',
  'speak',
];
export const ASSISTANT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES = [
  ...ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES,
  'set_thinking_level',
  'speak',
];
export const ASSISTANT_PRE_FETCH_CONTENT_VOICE_DEFAULT_ENABLED_TOOL_NAMES = [
  ...ASSISTANT_PRE_FETCH_CONTENT_DEFAULT_ENABLED_TOOL_NAMES,
  'set_thinking_level',
  'create_new_thread',
  'speak',
];
export const ASSISTANT_PRE_FETCH_CONTENT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES = [
  ...ASSISTANT_PRE_FETCH_CONTENT_DEFAULT_ENABLED_TOOL_NAMES,
  'set_thinking_level',
  'speak',
];
export const ASSISTANT_PRE_FETCH_CONTENT_PRE_CHAT_IDLE_SPLIT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES =
  [
    ...ASSISTANT_PRE_FETCH_CONTENT_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES,
    'set_thinking_level',
    'speak',
  ];
export const ASSISTANT_PRE_WEB_SEARCH_VOICE_DEFAULT_ENABLED_TOOL_NAMES = [
  ...ASSISTANT_PRE_WEB_SEARCH_DEFAULT_ENABLED_TOOL_NAMES,
  'set_thinking_level',
  'create_new_thread',
  'speak',
];
export const ASSISTANT_PRE_WEB_SEARCH_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES = [
  ...ASSISTANT_PRE_WEB_SEARCH_DEFAULT_ENABLED_TOOL_NAMES,
  'set_thinking_level',
  'speak',
];
export const ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES =
  [
    ...ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES,
    'set_thinking_level',
    'speak',
  ];
export const ASSISTANT_OVERVIEW_PROMPT_DEFAULT = [
  'You write a concise Markdown status overview for an assistant thread in Drone Hub.',
  'Focus on the current state of the work, recent actions, tool calls, approvals, blockers, and next likely step.',
  'Do not invent facts. If the thread does not show a result yet, say that it is still in progress or unknown.',
  'Prefer compact sections and bullets. Keep it useful at a glance.',
  'Use present tense for current work and past tense for completed actions.',
].join('\n');
export const ASSISTANT_MODEL_OPTIONS: Array<{
  provider: LlmProviderId;
  id: string;
  name: string;
  thinkingLevel: AssistantThinkingLevel;
}> = [
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 Instant', thinkingLevel: 'off' },
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 Low', thinkingLevel: 'low' },
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 Medium', thinkingLevel: 'medium' },
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 High', thinkingLevel: 'high' },
  { provider: 'codex', id: 'gpt-5.5', name: 'GPT-5.5 Instant', thinkingLevel: 'off' },
  { provider: 'codex', id: 'gpt-5.5', name: 'GPT-5.5 Low', thinkingLevel: 'low' },
  { provider: 'codex', id: 'gpt-5.5', name: 'GPT-5.5 Medium', thinkingLevel: 'medium' },
  { provider: 'codex', id: 'gpt-5.5', name: 'GPT-5.5 High', thinkingLevel: 'high' },
  {
    provider: 'gemini',
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    thinkingLevel: 'medium',
  },
];
