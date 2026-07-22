export function chatResponseStopVisible(input: {
  waiting: boolean;
  hasStopAction: boolean;
  voiceRecordingActive: boolean;
}): boolean {
  return input.waiting && input.hasStopAction && !input.voiceRecordingActive;
}
