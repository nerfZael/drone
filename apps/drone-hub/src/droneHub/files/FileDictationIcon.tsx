export function FileDictationIcon({ active }: { active: boolean }) {
  return (
    <span className="relative inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
      {active ? (
        <span className="absolute inset-0 rounded-full bg-[var(--red)] opacity-20 animate-pulse" />
      ) : null}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
      </svg>
    </span>
  );
}
