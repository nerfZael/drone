export const WORKFLOW_ASSISTANT_SYSTEM_PROMPT_LINE =
  'Use list_workflows and get_workflow before changing workflows; execute_workflow always creates a run that waits for user approval.';

export const WORKFLOW_ASSISTANT_TOOL_SUMMARIES = [
  {
    name: 'list_workflows',
    label: 'List workflows',
    category: 'context',
    description: 'List reusable workflows owned by a drone.',
  },
  {
    name: 'get_workflow',
    label: 'Get workflow',
    category: 'context',
    description: 'Read a workflow definition and version.',
  },
  {
    name: 'list_workflow_runs',
    label: 'List workflow runs',
    category: 'context',
    description: 'List workflow execution requests and statuses.',
  },
  {
    name: 'get_workflow_run',
    label: 'Get workflow run',
    category: 'context',
    description: 'Inspect a workflow run and its agent invocations.',
  },
  {
    name: 'create_workflow',
    label: 'Create workflow',
    category: 'actions',
    description: 'Create a validated structured workflow for a drone.',
  },
  {
    name: 'update_workflow',
    label: 'Update workflow',
    category: 'actions',
    description: 'Update a workflow using optimistic version checks.',
  },
  {
    name: 'delete_workflow',
    label: 'Delete workflow',
    category: 'actions',
    description: 'Delete a workflow, its run history, and its chats or child drones.',
  },
  {
    name: 'execute_workflow',
    label: 'Execute workflow',
    category: 'actions',
    description: 'Request a workflow run that waits for user approval.',
  },
  {
    name: 'cancel_workflow_run',
    label: 'Cancel workflow run',
    category: 'actions',
    description: 'Cancel an active workflow run.',
  },
] as const;
