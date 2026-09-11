const rect = {
  type: 'object', additionalProperties: false,
  properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 }, width: { type: 'number', exclusiveMinimum: 0, maximum: 1 }, height: { type: 'number', exclusiveMinimum: 0, maximum: 1 } },
  required: ['x', 'y', 'width', 'height'],
};

export const chatWindowLayoutProperties = {
  workspaceId: { type: 'string', description: 'Workspace ID from get_chat_window_layout.' },
  layoutRevision: { type: 'string', description: 'Revision from the latest layout read or successful arrangement.' },
  mode: { type: 'string', enum: ['tile', 'pack', 'stack', 'custom', 'undo'] },
  windows: { anyOf: [{ type: 'string', enum: ['all_floating'] }, { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100, uniqueItems: true }], description: 'Defaults to all floating windows. Ordered back to front for stack/custom; detached windows must come after side chats.' },
  area: { ...rect, description: 'Available area as workspace fractions, defaults to the entire workspace. Floating windows can cover the main chat.' },
  columns: { type: 'integer', minimum: 1, maximum: 100, description: 'Tile/pack columns. Omit for automatic selection.' },
  gap: { type: 'number', minimum: 0, maximum: 128, description: 'Pixel gap for tile/pack; default 8. Use 0 to fill without gaps.' },
  anchor: { type: 'string', enum: ['top_left', 'top_right', 'bottom_left', 'bottom_right'], description: 'Pack/stack anchor, default bottom_right.' },
  size: { type: 'object', additionalProperties: false, properties: { width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 } }, required: ['width', 'height'], description: 'Preferred pixel size for pack/stack. Pack may shrink to fit within minimum sizes.' },
  offset: { type: 'object', additionalProperties: false, properties: { x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 } }, required: ['x', 'y'], description: 'Stack offset in pixels, default 32 in each direction.' },
  placements: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, properties: { windowId: { type: 'string' }, bounds: rect }, required: ['windowId', 'bounds'] }, description: 'Custom rectangle for every selected window, expressed as workspace fractions. Overlap is allowed.' },
};
