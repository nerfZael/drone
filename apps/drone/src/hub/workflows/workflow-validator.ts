import { workflowDefinitionSchema } from './workflow-schema';
import { normalizeWorkflowPermissions, workflowPermissionIssue } from './workflow-permissions';
import type {
  WorkflowDefinition,
  WorkflowDefinitionIssue,
  WorkflowJsonSchema,
  WorkflowJsonValue,
  WorkflowNode,
  WorkflowValueRef,
} from './workflow-types';

const MAX_DEFINITION_BYTES = 256 * 1024;
const MAX_AGENTS = 32;
const MAX_NODES = 100;
const MAX_DEPTH = 12;

export class WorkflowDefinitionValidationError extends Error {
  readonly statusCode = 400;

  constructor(readonly issues: WorkflowDefinitionIssue[]) {
    super(issues[0]?.message || 'invalid workflow definition');
    this.name = 'WorkflowDefinitionValidationError';
  }
}

function zodPath(path: PropertyKey[]): string {
  return path.map(String).join('.');
}

function issue(path: string, code: string, message: string): WorkflowDefinitionIssue {
  return { path, code, message };
}

type ResultAvailability = {
  definite: Set<string>;
  possible: Set<string>;
};

function cloneAvailability(input: ResultAvailability): ResultAvailability {
  return {
    definite: new Set(input.definite),
    possible: new Set(input.possible),
  };
}

function addAvailableResult(availability: ResultAvailability, resultId: string): void {
  availability.definite.add(resultId);
  availability.possible.add(resultId);
}

function visitValueRef(
  ref: WorkflowValueRef & { optional?: boolean },
  path: string,
  insideForEach: boolean,
  knownResults: Set<string>,
  availability: ResultAvailability,
  repeatOptionalResults: Set<string>,
  issues: WorkflowDefinitionIssue[],
): void {
  if (ref.source === 'item' && !insideForEach) {
    issues.push(
      issue(path, 'item_outside_for_each', 'item references are valid only inside forEach bodies'),
    );
  }
  if (ref.source !== 'result') return;
  if (!knownResults.has(ref.result)) {
    issues.push(issue(path, 'unknown_result', `unknown workflow result: ${ref.result}`));
    return;
  }
  const available = ref.optional
    ? availability.possible.has(ref.result) || repeatOptionalResults.has(ref.result)
    : availability.definite.has(ref.result);
  if (!available) {
    issues.push(
      issue(
        path,
        'result_not_available',
        `workflow result is not available at this point: ${ref.result}`,
      ),
    );
  }
}

function collectNodeResultIds(node: WorkflowNode, phaseId: string, results: Set<string>): void {
  results.add(`${phaseId}.${node.id}`);
  switch (node.type) {
    case 'sequence':
    case 'parallel':
      node.children.forEach((child) => collectNodeResultIds(child, phaseId, results));
      return;
    case 'forEach':
    case 'repeat':
      collectNodeResultIds(node.body, phaseId, results);
      return;
    case 'if':
      collectNodeResultIds(node.then, phaseId, results);
      if (node.else) collectNodeResultIds(node.else, phaseId, results);
      return;
    case 'call':
      return;
  }
}

function visitNode(input: {
  node: WorkflowNode;
  path: string;
  phaseId: string;
  agentIds: Set<string>;
  nodeIds: Set<string>;
  insideForEach: boolean;
  depth: number;
  issues: WorkflowDefinitionIssue[];
  count: { value: number };
  knownResults: Set<string>;
  availability: ResultAvailability;
  repeatOptionalResults: Set<string>;
}): void {
  const { node, path, issues } = input;
  input.count.value += 1;
  if (input.count.value > MAX_NODES) {
    issues.push(issue(path, 'too_many_nodes', `workflow has more than ${MAX_NODES} nodes`));
    return;
  }
  if (input.depth > MAX_DEPTH) {
    issues.push(issue(path, 'nesting_too_deep', `workflow nesting exceeds ${MAX_DEPTH}`));
    return;
  }
  if (input.nodeIds.has(node.id)) {
    issues.push(issue(`${path}.id`, 'duplicate_node_id', `duplicate node id: ${node.id}`));
  } else {
    input.nodeIds.add(node.id);
  }

  switch (node.type) {
    case 'call':
      if (!input.agentIds.has(node.agent)) {
        issues.push(
          issue(`${path}.agent`, 'unknown_agent', `unknown workflow agent: ${node.agent}`),
        );
      }
      for (let index = 0; index < (node.contextFrom?.length ?? 0); index += 1) {
        visitValueRef(
          node.contextFrom![index],
          `${path}.contextFrom.${index}`,
          input.insideForEach,
          input.knownResults,
          input.availability,
          input.repeatOptionalResults,
          issues,
        );
      }
      addAvailableResult(input.availability, `${input.phaseId}.${node.id}`);
      return;
    case 'sequence':
      node.children.forEach((child, index) =>
        visitNode({
          ...input,
          node: child,
          path: `${path}.children.${index}`,
          depth: input.depth + 1,
        }),
      );
      addAvailableResult(input.availability, `${input.phaseId}.${node.id}`);
      return;
    case 'parallel': {
      const branches = node.children.map(() => cloneAvailability(input.availability));
      node.children.forEach((child, index) =>
        visitNode({
          ...input,
          node: child,
          path: `${path}.children.${index}`,
          depth: input.depth + 1,
          availability: branches[index]!,
        }),
      );
      for (const branch of branches) {
        for (const resultId of branch.definite) input.availability.definite.add(resultId);
        for (const resultId of branch.possible) input.availability.possible.add(resultId);
      }
      addAvailableResult(input.availability, `${input.phaseId}.${node.id}`);
      return;
    }
    case 'forEach':
      visitValueRef(
        node.itemsFrom,
        `${path}.itemsFrom`,
        input.insideForEach,
        input.knownResults,
        input.availability,
        input.repeatOptionalResults,
        issues,
      );
      {
        const bodyAvailability = cloneAvailability(input.availability);
        visitNode({
          ...input,
          node: node.body,
          path: `${path}.body`,
          insideForEach: true,
          depth: input.depth + 1,
          availability: bodyAvailability,
        });
        for (const resultId of bodyAvailability.possible) {
          input.availability.possible.add(resultId);
        }
      }
      addAvailableResult(input.availability, `${input.phaseId}.${node.id}`);
      return;
    case 'if': {
      visitValueRef(
        node.condition.value,
        `${path}.condition.value`,
        input.insideForEach,
        input.knownResults,
        input.availability,
        input.repeatOptionalResults,
        issues,
      );
      const thenAvailability = cloneAvailability(input.availability);
      visitNode({
        ...input,
        node: node.then,
        path: `${path}.then`,
        depth: input.depth + 1,
        availability: thenAvailability,
      });
      const elseAvailability = cloneAvailability(input.availability);
      if (node.else) {
        visitNode({
          ...input,
          node: node.else,
          path: `${path}.else`,
          depth: input.depth + 1,
          availability: elseAvailability,
        });
      }
      for (const resultId of thenAvailability.possible) {
        input.availability.possible.add(resultId);
      }
      for (const resultId of elseAvailability.possible) {
        input.availability.possible.add(resultId);
      }
      for (const resultId of thenAvailability.definite) {
        if (elseAvailability.definite.has(resultId)) {
          input.availability.definite.add(resultId);
        }
      }
      addAvailableResult(input.availability, `${input.phaseId}.${node.id}`);
      return;
    }
    case 'repeat': {
      const repeatResults = new Set(input.repeatOptionalResults);
      collectNodeResultIds(node.body, input.phaseId, repeatResults);
      visitNode({
        ...input,
        node: node.body,
        path: `${path}.body`,
        depth: input.depth + 1,
        repeatOptionalResults: repeatResults,
      });
      visitValueRef(
        node.until.value,
        `${path}.until.value`,
        input.insideForEach,
        input.knownResults,
        input.availability,
        input.repeatOptionalResults,
        issues,
      );
      addAvailableResult(input.availability, `${input.phaseId}.${node.id}`);
      return;
    }
  }
}

export function parseWorkflowDefinition(input: unknown): WorkflowDefinition {
  const serializedBytes = Buffer.byteLength(JSON.stringify(input ?? null), 'utf8');
  if (serializedBytes > MAX_DEFINITION_BYTES) {
    throw new WorkflowDefinitionValidationError([
      issue(
        '',
        'definition_too_large',
        `workflow definition exceeds ${MAX_DEFINITION_BYTES} bytes`,
      ),
    ]);
  }
  const parsed = workflowDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowDefinitionValidationError(
      parsed.error.issues.map((entry) => issue(zodPath(entry.path), entry.code, entry.message)),
    );
  }

  const definition = parsed.data as WorkflowDefinition;
  const issues: WorkflowDefinitionIssue[] = [];
  const agentEntries = Object.entries(definition.agents);
  if (agentEntries.length === 0) {
    issues.push(issue('agents', 'missing_agents', 'at least one workflow agent is required'));
  }
  if (agentEntries.length > MAX_AGENTS) {
    issues.push(issue('agents', 'too_many_agents', `workflow has more than ${MAX_AGENTS} agents`));
  }
  for (const [agentId, agent] of agentEntries) {
    const permissionError = workflowPermissionIssue(agent.permissions);
    if (permissionError) {
      issues.push(issue(`agents.${agentId}.permissions`, 'invalid_permissions', permissionError));
    } else {
      agent.permissions = normalizeWorkflowPermissions(agent.permissions);
      if (
        agent.runner.agent.id === 'codex' &&
        agent.permissions.includes('workspace:write') &&
        !agent.permissions.includes('process:execute')
      ) {
        issues.push(
          issue(
            `agents.${agentId}.permissions`,
            'unsupported_codex_permissions',
            'Codex workflow agents require process:execute when workspace:write is enabled',
          ),
        );
      }
    }
  }

  const phaseIds = new Set<string>();
  const agentIds = new Set(agentEntries.map(([id]) => id));
  const count = { value: 0 };
  const knownResults = new Set<string>();
  const availability: ResultAvailability = {
    definite: new Set(),
    possible: new Set(),
  };
  definition.phases.forEach((phase) => {
    knownResults.add(phase.id);
    collectNodeResultIds(phase.run, phase.id, knownResults);
  });
  definition.phases.forEach((phase, phaseIndex) => {
    if (phaseIds.has(phase.id)) {
      issues.push(
        issue(`phases.${phaseIndex}.id`, 'duplicate_phase_id', `duplicate phase id: ${phase.id}`),
      );
    } else {
      phaseIds.add(phase.id);
    }
    visitNode({
      node: phase.run,
      path: `phases.${phaseIndex}.run`,
      phaseId: phase.id,
      agentIds,
      nodeIds: new Set(),
      insideForEach: false,
      depth: 1,
      issues,
      count,
      knownResults,
      availability,
      repeatOptionalResults: new Set(),
    });
    addAvailableResult(availability, phase.id);
  });

  if (definition.outputFrom) {
    if (!knownResults.has(definition.outputFrom)) {
      issues.push(
        issue(
          'outputFrom',
          'unknown_result',
          `unknown workflow output result: ${definition.outputFrom}`,
        ),
      );
    } else if (!availability.definite.has(definition.outputFrom)) {
      issues.push(
        issue(
          'outputFrom',
          'result_not_available',
          `workflow output result is not guaranteed to be available: ${definition.outputFrom}`,
        ),
      );
    }
  }
  if (issues.length > 0) throw new WorkflowDefinitionValidationError(issues);
  return definition;
}

function pointerSegments(pointer: string): string[] {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function readWorkflowJsonPointer(
  value: WorkflowJsonValue | undefined,
  pointer = '',
): { found: boolean; value: WorkflowJsonValue | undefined } {
  if (value === undefined) return { found: false, value: undefined };
  let current: WorkflowJsonValue | undefined = value;
  for (const segment of pointerSegments(pointer)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
      continue;
    }
    if (current && typeof current === 'object') {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return { found: false, value: undefined };
      }
      current = (current as Record<string, WorkflowJsonValue>)[segment];
      continue;
    }
    return { found: false, value: undefined };
  }
  return { found: true, value: current };
}

export function validateWorkflowJsonSchema(
  schema: WorkflowJsonSchema,
  value: WorkflowJsonValue,
  path = '$',
): string[] {
  const errors: string[] = [];
  switch (schema.type) {
    case 'null':
      if (value !== null) errors.push(`${path} must be null`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path} must be a boolean`);
      break;
    case 'string':
      if (typeof value !== 'string') errors.push(`${path} must be a string`);
      else if (schema.enum && !schema.enum.includes(value))
        errors.push(`${path} is not an allowed value`);
      break;
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value))
        errors.push(`${path} must be a number`);
      else {
        if (schema.type === 'integer' && !Number.isInteger(value))
          errors.push(`${path} must be an integer`);
        if (schema.minimum !== undefined && value < schema.minimum)
          errors.push(`${path} must be >= ${schema.minimum}`);
        if (schema.maximum !== undefined && value > schema.maximum)
          errors.push(`${path} must be <= ${schema.maximum}`);
      }
      break;
    case 'array':
      if (!Array.isArray(value)) errors.push(`${path} must be an array`);
      else {
        if (schema.maxItems !== undefined && value.length > schema.maxItems) {
          errors.push(`${path} must contain at most ${schema.maxItems} items`);
        }
        value.forEach((item, index) =>
          errors.push(...validateWorkflowJsonSchema(schema.items, item, `${path}[${index}]`)),
        );
      }
      break;
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path} must be an object`);
      } else {
        const object = value as Record<string, WorkflowJsonValue>;
        for (const required of schema.required ?? []) {
          if (!Object.prototype.hasOwnProperty.call(object, required)) {
            errors.push(`${path}.${required} is required`);
          }
        }
        for (const [key, item] of Object.entries(object)) {
          const propertySchema = schema.properties[key];
          if (!propertySchema) errors.push(`${path}.${key} is not allowed`);
          else errors.push(...validateWorkflowJsonSchema(propertySchema, item, `${path}.${key}`));
        }
      }
      break;
  }
  return errors;
}
