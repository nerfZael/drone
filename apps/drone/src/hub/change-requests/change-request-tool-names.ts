export const CHANGE_REQUEST_MANAGE_TOOL_NAMES = [
  'create_change_request',
  'update_change_request',
  'close_change_request',
] as const;

export const CHANGE_REQUEST_MERGE_TOOL_NAME = 'merge_change_request' as const;

export const CHANGE_REQUEST_MCP_TOOL_NAMES = [
  ...CHANGE_REQUEST_MANAGE_TOOL_NAMES,
  CHANGE_REQUEST_MERGE_TOOL_NAME,
] as const;

export const CHANGE_REQUEST_WRITE_SCOPED_TOOL_NAMES = CHANGE_REQUEST_MCP_TOOL_NAMES;
export const CHANGE_REQUEST_CHAT_WRITE_TOOL_NAMES = CHANGE_REQUEST_MANAGE_TOOL_NAMES;
export const CHANGE_REQUEST_CHAT_EXECUTE_TOOL_NAMES = [CHANGE_REQUEST_MERGE_TOOL_NAME] as const;
