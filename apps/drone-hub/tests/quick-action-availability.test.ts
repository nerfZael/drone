import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the expression evaluated by the real app model during rendering.
// The lifecycle-only smoke harness cannot catch a state write in these arguments.
const source = readFileSync(new URL('../src/use-drone-hub-app-model.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('model.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let expression: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(file) === 'useDroneHubLifecycleEffects') {
    const argument = node.arguments[0];
    if (argument && ts.isObjectLiteralExpression(argument)) {
      const property = argument.properties.find((entry) => ts.isPropertyAssignment(entry) && entry.name.getText(file) === 'quickActionUnavailable');
      if (property && ts.isPropertyAssignment(property)) expression = property.initializer;
    }
  }
  ts.forEachChild(node, visit);
}
visit(file);
if (!expression) throw new Error('Quick action availability was not found in the app model');
const evaluate = new Function('currentDrone', 'selectedDrone', 'selectedGroupMultiChat', 'selectedDroneIds', 'resolveCurrentSelectionDraftContext', `return (${expression.getText(file)});`);
const stateChangingResolver = () => { throw new Error('Availability must not call the draft resolver: it writes spawn context during render'); };
const drone = Object.freeze({ id: 'selected-drone', group: 'Current group', repoPath: '/repo' });

describe('quick action availability during app rendering', () => {
  test('a selected drone enables chat and group creation without writing application state', () => {
    const result = evaluate(drone, drone.id, null, [drone.id], stateChangingResolver);
    expect(result.createDroneChat).toBeUndefined();
    expect(result.createDraftDroneInCurrentGroup).toBeUndefined();
    expect(result.cloneDroneChat).toBeUndefined();
  });

  test('home and an unloaded selection disable actions without resolving draft context', () => {
    for (const selection of [null, 'loading-drone']) {
      const result = evaluate(null, selection, null, [], stateChangingResolver);
      expect(result.createDroneChat).toBe('Select a drone chat');
      expect(result.createDraftDroneInCurrentGroup).toBe('Select a drone or group');
    }
  });

  test('multi-chat disables single-chat creation even when a drone remains selected', () => {
    const result = evaluate(drone, drone.id, 'Current group', [drone.id], stateChangingResolver);
    expect(result.createDroneChat).toBe('Select a drone chat');
    expect(result.createDraftDroneInCurrentGroup).toBe('Select a drone or group');
    expect(result.toggleSelectedDronePinned).toBeUndefined();
  });
});
