import { expect, test } from 'bun:test';
import { fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai';
import { createBlipSession } from '@blip/core';
import { summaryText } from '../../../blip/packages/core/tests/helpers/compaction-fixtures';
import { HubSessionRepository } from '../src/hub/assistant/hub-session-repository';
import { CompanionSkills } from '../src/hub/companion/companion-skills';
import { writeCompanionInstructions } from '../src/hub/companion/companion-instructions';
import { CompanionTelemetryService } from '../src/hub/companion/companion-telemetry';
import { boundedCompanionActivityEvent } from '../src/hub/companion/companion-transport-shared';
import { withTempDroneDataDir } from './test-helpers';

test('Companion restores exact saved instructions through repeated measured compactions', async () => {
  await withTempDroneDataDir('companion-compaction-continuation-', async () => {
    const instruction = 'Do not deploy. Confirm before deleting files. Keep /repo/app.ts unchanged.';
    await writeCompanionInstructions(instruction, 0);
    const repository = new HubSessionRepository({ inMemory: true });
    const faux = registerFauxProvider({ api: 'faux-companion-continuation', provider: 'faux-companion-continuation', tokensPerSecond: 0 });
    const skills = new CompanionSkills(() => {});
    const service = new CompanionTelemetryService();
    const telemetry = service.begin({ messageId: 'message', runId: 'run', transport: 'websocket', coldStart: false });
    const activity: Array<{ type: string }> = [];
    let continuations = 0;
    faux.setResponses([
      fauxAssistantMessage('Observed evidence. '.repeat(500)),
      // Deliberately omit the instructions to exercise exact skill restoration.
      fauxAssistantMessage(summaryText('Investigate the remaining issue.')),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(instruction);
        expect(context.messages.filter((message) => message.role === 'toolResult' && message.toolName === 'read_skill')).toHaveLength(1);
        continuations++;
        return fauxAssistantMessage('More evidence. '.repeat(500));
      },
      fauxAssistantMessage(summaryText('Investigate the remaining issue.')),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(instruction);
        expect(context.messages.filter((message) => message.role === 'toolResult' && message.toolName === 'read_skill')).toHaveLength(1);
        continuations++;
        return fauxAssistantMessage('Ready for the remaining checks.');
      },
    ]);
    const session = await createBlipSession({
      workspaceRoot: 'drone-hub', model: { ...faux.getModel(), contextWindow: 32_000, maxTokens: 2048 },
      permissionMode: 'workspace-write', toolProfile: 'no-shell-workspace-write', sessionRepository: repository,
      toolProviders: [skills], promptContext: skills.promptContext.bind(skills), transformContext: skills.transformContext.bind(skills),
      compactionSettings: { auto: false, reserveTokens: 2048, summaryMaxTokens: 1024, keepRecentTokens: 0, keepRecentTurns: 0 },
      eventSink: (event) => {
        telemetry.observe(event);
        const visible = boundedCompanionActivityEvent(event);
        if (visible) activity.push(visible);
      },
    });
    try {
      await session.prompt('Investigate the issue.');
      await session.compact();
      await session.prompt('Continue.');
      await session.compact();
      await session.prompt('Continue again.');
      await telemetry.finish('completed');
      expect(continuations).toBe(2);
      expect(activity.filter((event) => event.type.startsWith('compaction_')).map((event) => event.type))
        .toEqual(['compaction_started', 'compaction_completed', 'compaction_started', 'compaction_completed']);
      const report = service.report();
      expect(report.compaction).toMatchObject({ attemptCount: 2, measuredAttemptCount: 2, modelCallCount: 2, modelResponseCount: 2, fallbackCount: 0 });
      expect(JSON.stringify(report)).not.toContain(instruction);
      expect((await repository.readMessages(session.state)).filter((message) => message.role === 'toolResult' && message.toolName === 'read_skill')).toHaveLength(1);
    } finally {
      session.close(); repository.close(); faux.unregister();
    }
  });
});
