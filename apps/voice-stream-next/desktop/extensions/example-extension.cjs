exports.activate = async function activate(api) {
  api.registerTool({
    name: 'ping',
    label: 'Ping extension',
    description: 'Return a simple response from a local Voice Stream desktop extension.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args) {
      await api.state.set('lastPingAt', new Date().toISOString());
      return {
        ok: true,
        extensionId: api.id,
        message: String(args.message || 'pong'),
        configuredName: api.config.name || null,
      };
    },
  });
};
