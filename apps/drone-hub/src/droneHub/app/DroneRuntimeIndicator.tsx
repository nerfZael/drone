import React from 'react';

export type DroneRuntime = 'container' | 'host';

export function droneRuntimeIconToneClass(runtime: DroneRuntime): string {
  return runtime === 'container'
    ? '!text-[var(--accent)]'
    : '!text-[var(--green)]';
}

export function DroneRuntimeIcon({
  runtime,
  className = 'h-3.5 w-3.5',
}: {
  runtime: DroneRuntime;
  className?: string;
}) {
  if (runtime === 'host') {
    return (
      <svg
        data-drone-runtime-icon="host"
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }

  return (
    <svg
      data-drone-runtime-icon="container"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4.4 7.7 7.6 4.2 7.6-4.2M12 12v9" />
    </svg>
  );
}

export function DroneRuntimeLabel({ runtime }: { runtime: DroneRuntime }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className={droneRuntimeIconToneClass(runtime)}>
        <DroneRuntimeIcon runtime={runtime} />
      </span>
      <span className="truncate">{runtime === 'container' ? 'Container' : 'Host'}</span>
    </span>
  );
}

export function DroneRuntimeIndicator({ runtime }: { runtime: DroneRuntime }) {
  const label = runtime === 'container' ? 'Container' : 'Host';

  return (
    <span
      data-drone-runtime-indicator={runtime}
      aria-label={`Execution target: ${label}`}
      title={`Execution target: ${label} (set when this drone was created)`}
      className="inline-flex min-h-7 items-center text-[.6875rem] font-medium text-[var(--chat-composer-model-fg)]"
    >
      <DroneRuntimeLabel runtime={runtime} />
    </span>
  );
}
