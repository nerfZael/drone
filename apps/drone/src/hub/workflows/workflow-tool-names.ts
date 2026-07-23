export const WORKFLOW_MCP_TOOL_NAMES = [
  'list_workflows',
  'get_workflow',
  'create_workflow',
  'update_workflow',
  'delete_workflow',
  'execute_workflow',
  'list_workflow_runs',
  'get_workflow_run',
  'cancel_workflow_run',
] as const;

export const WORKFLOW_WRITE_SCOPED_TOOL_NAMES = [
  'create_workflow',
  'update_workflow',
  'delete_workflow',
  'execute_workflow',
  'cancel_workflow_run',
] as const;

export const WORKFLOW_DRONE_DEFAULTED_TOOL_NAMES = WORKFLOW_MCP_TOOL_NAMES;
