import React from 'react';

import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/components';

type AgentComposerPickerProps = {
  value: string;
  label: string;
  entries: UiMenuSelectEntry[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function AgentComposerPicker({
  value,
  label,
  entries,
  onChange,
  disabled = false,
}: AgentComposerPickerProps) {
  return (
    <UiMenuSelect
      variant="toolbar"
      value={value}
      onValueChange={onChange}
      entries={entries}
      disabled={disabled}
      searchable
      searchPlaceholder="Search agents"
      title="Choose agent"
      triggerLabel={label}
      triggerClassName="!h-8 min-w-[7rem] max-w-[11.25rem] justify-start !gap-1 !border-transparent !bg-transparent px-2 text-[.6875rem] !font-medium normal-case tracking-normal !text-[var(--chat-composer-model-fg)] hover:!opacity-70"
      panelClassName="bottom-full !mt-0 mb-1.5 w-[16.25rem]"
      menuClassName="max-h-[15rem] overflow-y-auto"
      header="Choose agent"
    />
  );
}
