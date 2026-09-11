export const workspaceWindowLayoutProperties = {
  workspaceId: { type: 'string', description: 'Workspace ID returned by get_workspace_window_layout.' },
  layoutRevision: { type: 'string', description: 'Revision from the latest read or arrangement.' },
  mode: { type: 'string', enum: ['rows', 'columns', 'custom', 'undo'], description: 'Rows stacks panels vertically; columns puts them side by side. Custom uses the split tree. Defaults to custom when layout is supplied.' },
  panelIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string' }, description: 'Ordered existing panel IDs for rows/columns. Defaults to every docked panel. Include all docked panels; optionally include floating panels to dock them.' },
  layout: { ...nodeSchema(0), description: 'Custom split tree. A leaf {panels:[id]} is one pane; multiple IDs make tabs. A row splits left/right; a column splits top/bottom. Children have equal space unless positive weights are supplied. Include every docked panel exactly once. Example three above and one below: {direction:"column",children:[{direction:"row",children:[{panels:["a"]},{panels:["b"]},{panels:["c"]}]},{panels:["d"]}]}.' },
};

function nodeSchema(depth: number): Record<string, unknown> {
  const leaf = { type: 'object', additionalProperties: false, properties: { panels: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100, uniqueItems: true } }, required: ['panels'] };
  if (depth === 8) return leaf;
  return { anyOf: [leaf, { type: 'object', additionalProperties: false, properties: {
    direction: { type: 'string', enum: ['row', 'column'] },
    children: { type: 'array', minItems: 2, maxItems: 100, items: nodeSchema(depth + 1) },
    weights: { type: 'array', minItems: 2, maxItems: 100, items: { type: 'number', exclusiveMinimum: 0, maximum: 10000 } },
  }, required: ['direction', 'children'] }] };
}
