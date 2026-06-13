import { useMemo, type CSSProperties } from 'react';

type CircuitRobotLoaderProps = {
  label?: string;
};

const CIRCUIT_RAYS = [
  { d: 'M67 86 H30 V67 H-54 V48 H-210 V30 H-520', delay: '-.18s' },
  { d: 'M130 88 H162 V70 H246 V52 H402 V34 H620', delay: '-2.74s' },
  { d: 'M96 59 V30 H74 V-32 H94 V-182 H72 V-440', delay: '-1.31s' },
  { d: 'M104 130 V158 H128 V226 H108 V384 H128 V660', delay: '-3.63s' },
  { d: 'M78 70 H58 V48 H18 V26 H-132 V6 H-430', delay: '-4.22s' },
  { d: 'M122 124 H150 V146 H202 V170 H370 V190 H560', delay: '-.82s' },
  { d: 'M88 62 V40 H54 V20 H22 V-70 H-250', delay: '-2.21s' },
  { d: 'M112 62 V42 H148 V20 H182 V-74 H380', delay: '-4.51s' },
  { d: 'M68 98 H16 V82 H-78 V62 H-252 V42 H-560', delay: '-1.76s' },
  { d: 'M132 98 H182 V82 H282 V104 H424 V84 H660', delay: '-3.08s' },
  { d: 'M92 130 V156 H66 V214 H42 V360 H-260', delay: '-.44s' },
  { d: 'M108 59 V36 H132 V-24 H110 V-170 H136 V-460', delay: '-2.52s' },
  { d: 'M70 110 H34 V130 H-70 V150 H-252 V172 H-520', delay: '-4.04s' },
  { d: 'M128 76 H158 V56 H214 V34 H380 V12 H600', delay: '-1.03s' },
  { d: 'M82 124 H58 V146 H10 V170 H-150 V192 H-440', delay: '-3.91s' },
  { d: 'M118 68 H142 V46 H190 V24 H336 V4 H540', delay: '-2.03s' },
  { d: 'M100 58 V24 H118 V-28 H96 V-206 H116 V-520', delay: '-.64s' },
  { d: 'M100 130 V162 H84 V238 H104 V398 H86 V660', delay: '-3.34s' },
  { d: 'M132 110 H170 V130 H258 V110 H410 V132 H650', delay: '-1.57s' },
  { d: 'M76 78 H44 V58 H-28 V38 H-190 V18 H-500', delay: '-2.96s' },
  { d: 'M124 116 H154 V138 H218 V160 H356 V184 H590', delay: '-.27s' },
  { d: 'M86 128 V150 H56 V190 H28 V330 H-230', delay: '-4.38s' },
  { d: 'M114 128 V150 H148 V192 H176 V330 H390', delay: '-1.18s' },
  { d: 'M68 92 H4 V110 H-102 V130 H-292 V150 H-600', delay: '-2.39s' },
];

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomTraceStyle(index: number): CSSProperties {
  return {
    '--ray-delay': `-${randomBetween(0, 4.73).toFixed(2)}s`,
    '--ray-duration': `${randomBetween(4.25, 5.35).toFixed(2)}s`,
    '--ray-dasharray': `${Math.round(randomBetween(36, 58))} ${Math.round(randomBetween(760, 980))}`,
    '--ray-opacity-peak': randomBetween(.72, .96).toFixed(2),
    '--ray-stroke-width': randomBetween(1.05, 1.45).toFixed(2),
    '--ray-sort': index,
  } as CSSProperties;
}

export function CircuitRobotLoader({ label = 'Loading Voice Stream' }: CircuitRobotLoaderProps) {
  const rays = useMemo(
    () =>
      CIRCUIT_RAYS.map((ray, index) => ({ ...ray, style: randomTraceStyle(index) }))
        .sort(() => Math.random() - .5),
    [],
  );

  return (
    <div className="circuit-loader" role="status" aria-live="polite" aria-label={label}>
      <svg className="circuit-loader__svg" viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <filter id="circuit-loader-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="circuit-loader__rays">
          {rays.map((ray) => (
            <g key={ray.d} style={ray.style}>
              <path className="circuit-loader__ray" d={ray.d} />
            </g>
          ))}
        </g>

        <circle className="circuit-loader__halo" cx="100" cy="96" r="48" />
        <path className="circuit-loader__antenna" d="M100 56 V40 M91 40 H109" />
        <circle className="circuit-loader__antenna-node" cx="100" cy="34" r="4" />

        <rect className="circuit-loader__head" x="66" y="58" width="68" height="68" rx="13" />
        <path className="circuit-loader__chin" d="M78 126 H122 L116 138 H84 Z" />
        <path className="circuit-loader__ear" d="M60 80 H66 V106 H60 Z M134 80 H140 V106 H134 Z" />

        <circle className="circuit-loader__eye circuit-loader__eye--left" cx="86" cy="89" r="6" />
        <circle className="circuit-loader__eye circuit-loader__eye--right" cx="114" cy="89" r="6" />
        <path className="circuit-loader__mouth" d="M85 108 H115" />
        <path className="circuit-loader__face-circuit" d="M76 74 H89 M111 74 H124 M100 58 V70" />
      </svg>
    </div>
  );
}
