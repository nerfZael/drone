export const CHANGE_REQUEST_MANAGE_TOOL_NAMES = [
  'create_change_request',
  'close_change_request',
] as const;

export const CHANGE_REQUEST_PUBLIC_UPDATE_TOOL_NAMES = [
  'update_change_request',
  'update_change_request_from_review',
] as const;

export const CHANGE_REQUEST_MERGE_TOOL_NAME = 'merge_change_request' as const;

export const CHANGE_REQUEST_PUBLIC_REVIEW_TOOL_NAMES = [
  'get_change_request',
  'list_change_request_revisions',
  'get_change_request_changes',
  'get_change_request_diff',
  'prepare_change_request_review',
] as const;

export const CHANGE_REQUEST_MCP_TOOL_NAMES = [
  ...CHANGE_REQUEST_PUBLIC_REVIEW_TOOL_NAMES,
  ...CHANGE_REQUEST_PUBLIC_UPDATE_TOOL_NAMES,
  ...CHANGE_REQUEST_MANAGE_TOOL_NAMES,
  CHANGE_REQUEST_MERGE_TOOL_NAME,
] as const;

export const CHANGE_REQUEST_WRITE_SCOPED_TOOL_NAMES = [
  ...CHANGE_REQUEST_MANAGE_TOOL_NAMES,
  CHANGE_REQUEST_MERGE_TOOL_NAME,
] as const;
export const CHANGE_REQUEST_CHAT_WRITE_TOOL_NAMES = CHANGE_REQUEST_MANAGE_TOOL_NAMES;
export const CHANGE_REQUEST_CHAT_EXECUTE_TOOL_NAMES = [CHANGE_REQUEST_MERGE_TOOL_NAME] as const;
