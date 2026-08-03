import React from 'react';
import { UiCenteredLoadingState } from '../../ui/components';

export function ChatLoadingState({ message = 'Loading conversation…' }: { message?: string }) {
  return <UiCenteredLoadingState message={message} />;
}
