import React from 'react';

function SkeletonLine({ w }: { w: string }) {
  return <div className="h-2.5 rounded bg-[var(--border-subtle)] animate-pulse" style={{ width: w }} />;
}

export function TranscriptSkeleton({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="max-w-[900px] mx-auto px-6 py-6 flex flex-col gap-8">
      <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--yellow)] animate-pulse-dot" />
        {message}
      </div>
      {[1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3 opacity-30">
          <SkeletonLine w="60px" />
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded bg-[var(--border-subtle)] animate-pulse flex-shrink-0" />
            <div className="flex-1 flex flex-col gap-2">
              <SkeletonLine w="40px" />
              <div className="bg-[rgba(0,0,0,.08)] rounded-lg p-4 flex flex-col gap-2">
                <SkeletonLine w="80%" />
                <SkeletonLine w="55%" />
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded bg-[var(--border-subtle)] animate-pulse flex-shrink-0" />
            <div className="flex-1 flex flex-col gap-2">
              <SkeletonLine w="40px" />
              <div className="bg-[rgba(0,0,0,.08)] rounded-lg p-4 flex flex-col gap-2">
                <SkeletonLine w="90%" />
                <SkeletonLine w="70%" />
                <SkeletonLine w="45%" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
