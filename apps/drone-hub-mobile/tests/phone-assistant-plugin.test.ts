import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
const { addAssistantLifecycle } = createRequire(import.meta.url)('../plugins/with-phone-assistant.js');

test('prebuild adds cold and warm assistant handoffs once', () => {
  const source = 'import android.os.Bundle\nclass MainActivity : ReactActivity() {\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(null)\n  }\n}';
  const result = addAssistantLifecycle(source);
  expect(result).toContain('CompanionAssistantLaunch.attach(this)');
  expect(result).toContain('CompanionAssistantLaunch.accept(this, intent)');
  expect(result.indexOf('CompanionAssistantLaunch.accept')).toBeLessThan(result.indexOf('super.onNewIntent'));
  expect(addAssistantLifecycle(result)).toBe(result);
});

test('prebuild refuses to silently omit a handoff when the activity template changes', () => {
  expect(() => addAssistantLifecycle('class MainActivity {}')).toThrow('onCreate');
  expect(() => addAssistantLifecycle('super.onCreate(null)\noverride fun onNewIntent')).toThrow('onNewIntent');
  expect(() => addAssistantLifecycle('CompanionAssistantLaunch.attach(this)')).toThrow('incomplete');
  expect(() => addAssistantLifecycle('super.onCreate(null)')).toThrow('template');
});
