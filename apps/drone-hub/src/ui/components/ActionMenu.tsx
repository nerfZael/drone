import * as React from 'react';
import { DropdownMenu } from 'radix-ui';
import { cn } from '../cn';
import { UiToolbarButton, UiToolbarIconButton, type UiToolbarControlSize } from './Toolbar';

export type UiActionMenuItemTone = 'neutral' | 'danger';

export type UiActionMenuItem = {
  kind?: 'item';
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  meta?: React.ReactNode;
  disabled?: boolean;
  tone?: UiActionMenuItemTone;
  checked?: boolean;
  selectionRole?: 'checkbox' | 'radio';
};

export type UiActionMenuSeparator = { kind: 'separator'; id: string };
export type UiActionMenuLabel = { kind: 'label'; id: string; label: React.ReactNode };
export type UiActionMenuEntry = UiActionMenuItem | UiActionMenuSeparator | UiActionMenuLabel;

export type UiActionMenuProps = {
  label: string;
  icon?: React.ReactNode;
  triggerContent?: React.ReactNode;
  entries: ReadonlyArray<UiActionMenuEntry>;
  onSelect: (id: string) => void;
  align?: 'start' | 'end';
  size?: UiToolbarControlSize;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  portal?: boolean;
  className?: string;
  panelClassName?: string;
};

export function UiActionMenu({
  label,
  icon,
  triggerContent,
  entries,
  onSelect,
  align = 'end',
  size = 'small',
  disabled = false,
  open: openProp,
  onOpenChange,
  portal = true,
  className,
  panelClassName,
}: UiActionMenuProps) {
  const controlled = typeof openProp === 'boolean';
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlled ? openProp : internalOpen;
  const hasTriggerContent = triggerContent !== undefined;

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (!controlled) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlled, onOpenChange],
  );

  React.useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open, setOpen]);

  const content = (
    <DropdownMenu.Content
      aria-label={label}
      align={align}
      sideOffset={6}
      collisionPadding={6}
      className={cn(
        'z-[200] max-h-[calc(100vh-0.75rem)] min-w-52 max-w-[calc(100vw-0.75rem)] overflow-y-auto rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] p-1 shadow-[var(--edge-highlight),var(--shadow-menu)] backdrop-blur-md animate-menu-in motion-reduce:animate-none',
        panelClassName,
      )}
    >
      {entries.map((entry) => {
        if (entry.kind === 'separator') {
          return (
            <DropdownMenu.Separator
              key={entry.id}
              className="-mx-1 my-1 border-t border-[var(--border-subtle)]"
            />
          );
        }
        if (entry.kind === 'label') {
          return (
            <DropdownMenu.Label key={entry.id} className="px-2.5 py-1 dh-type-eyebrow">
              {entry.label}
            </DropdownMenu.Label>
          );
        }
        return renderMenuItem(entry, onSelect);
      })}
    </DropdownMenu.Content>
  );

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <div className={cn('relative inline-flex', className)}>
        <DropdownMenu.Trigger asChild>
          {hasTriggerContent ? (
            <UiToolbarButton aria-label={label} size={size} active={open} disabled={disabled}>
              {triggerContent}
            </UiToolbarButton>
          ) : (
            <UiToolbarIconButton label={label} icon={icon} size={size} active={open} disabled={disabled} />
          )}
        </DropdownMenu.Trigger>
        {portal && typeof document !== 'undefined' ? <DropdownMenu.Portal>{content}</DropdownMenu.Portal> : content}
      </div>
    </DropdownMenu.Root>
  );
}

function renderMenuItem(entry: UiActionMenuItem, onSelect: (id: string) => void) {
  const itemProps = {
    disabled: entry.disabled,
    onSelect: () => onSelect(entry.id),
    className: cn(
      'flex min-h-8 w-full select-none items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-left dh-type-menu-item outline-none transition-colors duration-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      entry.tone === 'danger'
        ? 'text-[var(--red)] data-[highlighted]:bg-[var(--red-subtle)]'
        : 'text-[var(--fg-secondary)] data-[highlighted]:bg-[var(--hover)]',
    ),
    children: <MenuItemContent entry={entry} />,
  };

  if (entry.selectionRole === 'checkbox') {
    return <DropdownMenu.CheckboxItem key={entry.id} checked={Boolean(entry.checked)} {...itemProps} />;
  }
  if (entry.selectionRole === 'radio') {
    return (
      <DropdownMenu.RadioGroup key={entry.id} value={entry.checked ? entry.id : ''}>
        <DropdownMenu.RadioItem value={entry.id} {...itemProps} />
      </DropdownMenu.RadioGroup>
    );
  }
  return <DropdownMenu.Item key={entry.id} {...itemProps} />;
}

function MenuItemContent({ entry }: { entry: UiActionMenuItem }) {
  return (
    <>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
        {entry.selectionRole ? (
          <DropdownMenu.ItemIndicator>
            <Checkmark />
          </DropdownMenu.ItemIndicator>
        ) : (
          entry.icon
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {entry.meta ? <span className="shrink-0 dh-type-menu-meta">{entry.meta}</span> : null}
    </>
  );
}

function Checkmark() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
      <path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
