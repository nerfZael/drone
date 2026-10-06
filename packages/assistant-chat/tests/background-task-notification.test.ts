import { expect, test } from 'bun:test';

import {
  isBackgroundTaskNotificationPrompt,
  isEventNotificationPrompt,
  parseBackgroundTaskNotificationPrompt,
  renderBackgroundTaskNotificationPrompt,
} from '../src/index';

test('background task notifications round-trip their summaries', () => {
  const summaries = [
    'Monitor "watch <logs> & errors" stream ended',
    'Background command "x" failed',
  ];
  const prompt = renderBackgroundTaskNotificationPrompt(summaries);
  expect(isBackgroundTaskNotificationPrompt(prompt)).toBe(true);
  expect(isEventNotificationPrompt(prompt)).toBe(false);
  expect(parseBackgroundTaskNotificationPrompt(prompt)).toEqual({ summaries });
});

test('ordinary prompts are not background task notifications', () => {
  expect(isBackgroundTaskNotificationPrompt('Please run the tests')).toBe(false);
  expect(parseBackgroundTaskNotificationPrompt('<background-task-notification>')).toBeNull();
});

test('an unterminated notification is shown as the text the user wrote', () => {
  expect(isBackgroundTaskNotificationPrompt('<background-task-notification> pasted by hand')).toBe(
    false,
  );
});
