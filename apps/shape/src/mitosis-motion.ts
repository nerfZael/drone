type ActiveMitosis = {
  index: number;
  phase: number;
};

type BudCenter = {
  x: number;
  y: number;
  z: number;
};

type BudProjectionInput = {
  height: number;
  index: number;
  morph: number;
  phase: number;
  rotationX: number;
  rotationY: number;
  shape: number;
  width: number;
};

// Keep worklet dependencies above their callers. The worklets Babel transform
// rewrites function declarations to initialized variables, so source-order
// hoisting does not survive in a release bundle.
function mix(start: number, end: number, amount: number) {
  "worklet";
  return start + (end - start) * amount;
}

function smoothProgress(value: number) {
  "worklet";
  return value * value * (3 - 2 * value);
}

function smoothRange(start: number, end: number, value: number) {
  "worklet";
  return smoothProgress(Math.max(0, Math.min(1, (value - start) / (end - start))));
}

function normalize3(x: number, y: number, z: number) {
  "worklet";
  const length = Math.sqrt(x * x + y * y + z * z);
  return { x: x / length, y: y / length, z: z / length };
}

function getSolidSupport(shape: number) {
  "worklet";
  const index = shape % 8;
  if (index === 0) return 0.62;
  if (index === 1) return 0.55;
  if (index === 2) return 1.08;
  if (index === 3) return 0.79;
  if (index === 4) return 0.82;
  if (index === 5) return 0.47;
  if (index === 6) return 0.64;
  return 0.68;
}

function getShapeSupport(shape: number) {
  "worklet";
  const shapeFloor = Math.floor(shape);
  const blend = smoothProgress(shape - shapeFloor);
  return mix(getSolidSupport(shapeFloor), getSolidSupport(shapeFloor + 1), blend);
}

function getTorusWeight(shape: number) {
  "worklet";
  const shapeFloor = Math.floor(shape);
  const index = shapeFloor % 8;
  const nextIndex = (index + 1) % 8;
  const blend = smoothProgress(shape - shapeFloor);
  return (index === 7 ? 1 - blend : 0) + (nextIndex === 7 ? blend : 0);
}

export function getActiveMitosis(seconds: number): ActiveMitosis {
  "worklet";
  if (seconds < 1.1) return { index: -1, phase: -1 };
  const cycleTime = (seconds - 1.1) % 9;
  let index = Math.min(Math.floor(cycleTime / 1.35), 4);
  let localTime = cycleTime - index * 1.35;

  if (index > 0 && localTime < 0.45) {
    index -= 1;
    localTime += 1.35;
  }

  if (localTime >= 1.8) return { index: -1, phase: -1 };
  return { index, phase: localTime / 9 };
}

export function getBudCenter(
  index: number,
  phase: number,
  shape: number,
  morph: number,
): BudCenter {
  "worklet";
  const easedMorph = smoothProgress(morph);
  const support = mix(getShapeSupport(shape), 0.62, easedMorph);
  const emergence = smoothRange(0, 0.10, phase);
  const separation = smoothRange(0.09, 0.17, phase);
  const centerDistance = support - 0.10 + emergence * 0.06 + separation * 0.25;
  const torusBlend = getTorusWeight(shape) * (1 - easedMorph);
  const side = (index - 2) * 0.055;
  const lower = normalize3(side, -1, 0.10 + index * 0.025);
  const torusSide = index < 2.5 ? -0.90 : 0.90;
  const ring = normalize3(torusSide, -0.30, 0.30);
  const direction = normalize3(
    mix(lower.x, ring.x, torusBlend),
    mix(lower.y, ring.y, torusBlend),
    mix(lower.z, ring.z, torusBlend),
  );

  return {
    x: direction.x * centerDistance,
    y: direction.y * centerDistance,
    z: direction.z * centerDistance,
  };
}

export function projectBudCenter(input: BudProjectionInput) {
  "worklet";
  const local = getBudCenter(input.index, input.phase, input.shape, input.morph);
  const sineX = Math.sin(input.rotationX);
  const cosineX = Math.cos(input.rotationX);
  const rotatedX = local.x;
  const rotatedY = cosineX * local.y - sineX * local.z;
  const rotatedZ = sineX * local.y + cosineX * local.z;
  const sineY = Math.sin(input.rotationY);
  const cosineY = Math.cos(input.rotationY);
  const worldX = cosineY * rotatedX + sineY * rotatedZ;
  const worldZ = -sineY * rotatedX + cosineY * rotatedZ;
  const shortestSide = Math.min(input.width, input.height);
  const depth = Math.max(0.8, 3.15 - worldZ);

  return {
    x: input.width * 0.5 + (worldX / depth) * shortestSide,
    y: input.height * 0.5 - (rotatedY / depth) * shortestSide,
  };
}
