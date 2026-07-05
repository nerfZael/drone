const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { LoggingMessageNotificationSchema } = require('@modelcontextprotocol/sdk/types.js');

function normalizeMcpInputSchema(schema) {
  const value = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : {};
  return {
    type: 'object',
    properties: value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties) ? value.properties : {},
    required: Array.isArray(value.required) ? value.required.map((item) => String(item)).filter(Boolean) : [],
    additionalProperties: value.additionalProperties === true,
  };
}

function mcpRequestMeta(context = {}) {
  const meta = {};
  for (const key of ['requestId', 'threadId', 'runId', 'toolCallId', 'toolName', 'extensionId', 'localToolName']) {
    const value = String(context[key] || '').trim();
    if (value) meta[`voice-stream-next/${key}`] = value;
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

async function connectStdioServer(serverConfig, helpers = {}) {
  const log = helpers.log;
  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
    cwd: serverConfig.cwd || undefined,
    env: serverConfig.env && Object.keys(serverConfig.env).length > 0 ? { ...process.env, ...serverConfig.env } : undefined,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => {
    log?.('mcp:stderr', {
      serverId: serverConfig.id,
      message: String(chunk || '').trim().slice(0, 2000),
    });
  });

  const client = new Client({
    name: 'voice-stream-next-desktop',
    version: '0.1.0',
  });
  if (typeof helpers.onNotification === 'function') {
    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => helpers.onNotification(serverConfig, notification));
  }
  await client.connect(transport);
  return { client, transport };
}

function toolApproval(serverConfig, toolName) {
  const toolApprovals = serverConfig.toolApprovals && typeof serverConfig.toolApprovals === 'object' && !Array.isArray(serverConfig.toolApprovals)
    ? serverConfig.toolApprovals
    : {};
  const approval = String(toolApprovals[toolName] || serverConfig.approval || '').trim();
  return approval || 'always';
}

function toolApprovalEvaluator(helpers, serverConfig, originalName, localName) {
  if (typeof helpers?.approvalEvaluatorForTool !== 'function') return null;
  try {
    const evaluator = helpers.approvalEvaluatorForTool(serverConfig, originalName, localName);
    return typeof evaluator === 'function' ? evaluator : null;
  } catch (error) {
    helpers?.log?.('mcp:approvalEvaluatorFailed', {
      serverId: serverConfig.id,
      toolName: originalName,
      error: error?.message || String(error),
    });
    return null;
  }
}

function mcpToolLabel(tool) {
  return String(tool.title || tool.annotations?.title || tool.name || 'MCP tool').trim();
}

function mcpToolDescription(tool, serverName) {
  const description = String(tool.description || '').trim();
  if (description) return description;
  return `Run ${tool.name} on ${serverName}.`;
}

async function loadMcpServer(serverConfig, helpers) {
  const log = helpers?.log;
  if (serverConfig.transport !== 'stdio') throw new Error(`unsupported MCP transport: ${serverConfig.transport}`);
  if (!serverConfig.command) throw new Error('MCP stdio server command is required');

  const { client, transport } = await connectStdioServer(serverConfig, helpers);
  const listedTools = await client.listTools();
  const manifest = {
    id: serverConfig.extensionId,
    name: serverConfig.name,
    version: '0.0.0',
    sourceKind: 'mcp',
    tools: [],
    skills: [],
  };
  const toolExecutors = [];
  const seenLocalNames = new Set();

  for (const tool of listedTools.tools || []) {
    const originalName = String(tool?.name || '').trim();
    const localName = helpers.safeName(originalName);
    if (!originalName || !localName) continue;
    if (seenLocalNames.has(localName)) throw new Error(`duplicate MCP tool name after normalization: ${originalName}`);
    seenLocalNames.add(localName);
    const approval = toolApproval(serverConfig, originalName);
    const approvalEvaluator = toolApprovalEvaluator(helpers, serverConfig, originalName, localName);
    manifest.tools.push({
      name: localName,
      label: mcpToolLabel(tool),
      description: mcpToolDescription(tool, serverConfig.name),
      inputSchema: normalizeMcpInputSchema(tool.inputSchema),
      approval,
      supportedTargets: serverConfig.supportedTargets,
      defaultTarget: serverConfig.defaultTarget,
      ...(serverConfig.targetSlot ? { targetSlot: serverConfig.targetSlot } : {}),
    });
    toolExecutors.push({
      extensionId: serverConfig.extensionId,
      name: localName,
      originalName,
      execute: async (args, context = {}) => {
        const result = await client.callTool({
          name: originalName,
          arguments: args && typeof args === 'object' && !Array.isArray(args) ? args : {},
          _meta: mcpRequestMeta(context),
        });
        if (typeof helpers?.afterToolExecute === 'function') {
          try {
            await helpers.afterToolExecute(serverConfig, originalName, args, result, context);
          } catch (error) {
            log?.('mcp:afterToolExecuteFailed', {
              serverId: serverConfig.id,
              toolName: originalName,
              error: error?.message || String(error),
            });
          }
        }
        return result;
      },
      approval: approvalEvaluator,
    });
  }

  if (manifest.tools.length === 0) {
    await client.close();
    throw new Error('MCP server did not expose any tools');
  }

  return {
    manifest,
    toolExecutors,
    deactivate: async () => {
      await client.close();
      await transport.close?.();
    },
  };
}

module.exports = {
  loadMcpServer,
  mcpRequestMeta,
  normalizeMcpInputSchema,
};
