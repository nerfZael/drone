function optionalArg(name, value) {
  const text = String(value || '').trim();
  return text ? [name, text] : [];
}

function detachedHubStartArgs(cliPath, env = process.env, platform = process.platform) {
  const defaultContainerMcpHost = platform === 'linux' ? '172.17.0.1' : '0.0.0.0';
  const args = [
    cliPath,
    'hub',
    'start',
    '--json',
    '--ui-mode',
    'static',
    '--port',
    String(env.DRONE_HUB_APP_PORT || '0'),
    '--api-port',
    String(env.DRONE_HUB_APP_API_PORT || '0'),
    '--host',
    String(env.DRONE_HUB_APP_HOST || '127.0.0.1'),
    '--container-mcp-host',
    String(env.DRONE_HUB_APP_CONTAINER_MCP_HOST || defaultContainerMcpHost),
    '--container-mcp-port',
    String(env.DRONE_HUB_APP_CONTAINER_MCP_PORT || '8788'),
    ...optionalArg('--static-ui-dir', env.DRONE_HUB_STATIC_UI_DIR),
    ...optionalArg('--container-mcp-url', env.DRONE_HUB_APP_CONTAINER_MCP_URL),
  ];
  return args;
}

function parseDetachedHubStartOutput(raw) {
  const output = String(raw || '').trim();
  const firstBrace = output.indexOf('{');
  const lastBrace = output.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error('Hub launcher did not return its connection details.');
  }
  let payload;
  try {
    payload = JSON.parse(output.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error('Hub launcher returned invalid connection details.');
  }
  if (!payload || payload.ok !== true) {
    throw new Error(String(payload?.error || 'Hub launcher failed.'));
  }
  const directUrl = String(payload.uiUrl || '').trim();
  if (directUrl) return { payload, uiUrl: directUrl };
  const uiPort = Number(payload.state?.uiPort);
  if (!Number.isInteger(uiPort) || uiPort <= 0 || uiPort > 65535) {
    throw new Error('Hub launcher returned no usable UI address.');
  }
  return { payload, uiUrl: `http://127.0.0.1:${uiPort}` };
}

module.exports = { detachedHubStartArgs, parseDetachedHubStartOutput };
