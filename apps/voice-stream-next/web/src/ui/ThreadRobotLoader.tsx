import type React from 'react';

type ThreadRobotLoaderProps = {
  label?: string;
};

const THREADS = [
  { d: 'M96 96 C62 84 50 54 28 40', delay: '0s', tone: 'green' },
  { d: 'M103 91 C122 58 152 48 174 26', delay: '-.38s', tone: 'blue' },
  { d: 'M111 101 C146 92 166 106 190 96', delay: '-.76s', tone: 'yellow' },
  { d: 'M105 112 C128 144 158 148 178 174', delay: '-1.14s', tone: 'green' },
  { d: 'M94 113 C68 140 52 154 24 164', delay: '-1.52s', tone: 'blue' },
  { d: 'M88 101 C54 108 36 94 12 104', delay: '-1.9s', tone: 'yellow' },
  { d: 'M100 86 C98 58 84 34 92 10', delay: '-2.28s', tone: 'green' },
  { d: 'M100 118 C98 145 110 166 102 190', delay: '-2.66s', tone: 'blue' },
];

export function ThreadRobotLoader({ label = 'Loading Voice Stream' }: ThreadRobotLoaderProps) {
  return (
    <div className="thread-loader" role="status" aria-live="polite" aria-label={label}>
      <svg className="thread-loader__svg" viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <filter id="thread-loader-glow" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="2.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="thread-loader__threads">
          {THREADS.map((thread) => (
            <path
              key={thread.d}
              className={`thread-loader__thread thread-loader__thread--${thread.tone}`}
              d={thread.d}
              pathLength="100"
              style={{ '--thread-delay': thread.delay } as React.CSSProperties}
            />
          ))}
        </g>

        <circle className="thread-loader__pulse" cx="100" cy="100" r="42" />
        <path className="thread-loader__antenna" d="M100 59 V42 M91 42 H109" />
        <circle className="thread-loader__antenna-dot" cx="100" cy="36" r="4" />

        <rect className="thread-loader__head" x="64" y="60" width="72" height="70" rx="16" />
        <path className="thread-loader__ear" d="M57 82 H64 V108 H57 Z M136 82 H143 V108 H136 Z" />
        <circle className="thread-loader__eye thread-loader__eye--left" cx="85" cy="92" r="6" />
        <circle className="thread-loader__eye thread-loader__eye--right" cx="115" cy="92" r="6" />
        <path className="thread-loader__mouth" d="M84 112 C93 116 107 116 116 112" />
        <path className="thread-loader__panel-line" d="M78 76 H91 M109 76 H122 M100 130 V140" />
        <path className="thread-loader__neck" d="M84 140 H116" />
      </svg>
    </div>
  );
}
