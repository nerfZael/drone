const fs = require("fs");
const path = require("path");
const { parentPort, workerData } = require("worker_threads");

const CanvasKitInit = require("canvaskit-wasm/bin/full/canvaskit");

const MORPH_TAPS = [0.9, 2.05, 6.65, 6.9, 7.15];
const SHAPE_TAPS = [2.55, 3.1, 3.65, 4.2, 4.75, 5.3, 5.85];
const CHILD_LIFETIME_SECONDS = 9;
const CHILD_NAMES = ["FastRabbit", "QuickFox", "SwiftOtter", "BrightOwl", "NimbleWolf"];
const CHILD_COUNT = CHILD_NAMES.length;
const LABEL_OFFSET = 38;
const LABEL_FONT_PATHS = [
  process.env.SHAPE_DEMO_FONT,
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
].filter(Boolean);

async function renderFrames() {
  const CanvasKit = await CanvasKitInit();
  const mainEffect = CanvasKit.RuntimeEffect.Make(readShaderSource("morph-shader.ts"));
  const miniEffect = CanvasKit.RuntimeEffect.Make(readShaderSource("mini-prism-shader.ts"));
  const surface = CanvasKit.MakeSurface(workerData.width, workerData.height);

  if (!mainEffect || !miniEffect || !surface) {
    throw new Error("Could not initialize the shader renderer.");
  }

  const canvas = surface.getCanvas();
  const paint = new CanvasKit.Paint();
  const labelPaint = new CanvasKit.Paint();
  const fontData = readFontData();
  const typeface = CanvasKit.Typeface.MakeFreeTypeFaceFromData(fontData);

  if (!typeface) {
    throw new Error("Could not initialize the demo label typeface.");
  }

  const displayScale = workerData.width / 390;
  const labelFont = new CanvasKit.Font(typeface, 9.5 * displayScale);
  labelPaint.setAntiAlias(true);

  for (
    let frame = workerData.workerIndex;
    frame < workerData.totalFrames;
    frame += workerData.workerCount
  ) {
    const time = frame / workerData.framesPerSecond;
    const rotationX = -0.18 + Math.sin(time * 0.72) * 0.24;
    const rotationY = 0.32 + time * 0.48;
    const morph = getAnimatedValue(time, MORPH_TAPS, 0.76, true);
    const shape = getAnimatedValue(time, SHAPE_TAPS, 0.62, false);
    const activeMitosis = getActiveMitosis(time);
    const budCenter = activeMitosis.index < 0
      ? { x: 0, y: 0, z: 0 }
      : getBudCenter(activeMitosis.index, activeMitosis.phase, shape, morph);
    let shader = mainEffect.makeShader([
      workerData.width,
      workerData.height,
      rotationX,
      rotationY,
      time,
      budCenter.x,
      budCenter.y,
      budCenter.z,
      activeMitosis.phase,
      morph,
      shape,
      1,
    ]);

    paint.setShader(shader);
    canvas.drawRect(CanvasKit.XYWHRect(0, 0, workerData.width, workerData.height), paint);
    shader.delete();

    const childBoxSize = 96 * displayScale;
    const childMotions = [];
    for (let index = 0; index < CHILD_COUNT; index += 1) {
      const motion = getMiniMotion({
        height: workerData.height,
        index,
        morph,
        rotationX,
        rotationY: rotationY + time * 0.16,
        shape,
        time,
        width: workerData.width,
      });
      childMotions.push(motion);
      shader = miniEffect.makeShader([
        motion.centerX,
        motion.centerY,
        childBoxSize,
        time,
        motion.phase,
        index / CHILD_COUNT,
        motion.opacity,
        1,
      ]);
      paint.setShader(shader);
      canvas.drawRect(
        CanvasKit.XYWHRect(
          motion.centerX - childBoxSize / 2,
          motion.centerY - childBoxSize / 2,
          childBoxSize,
          childBoxSize,
        ),
        paint,
      );
      shader.delete();
    }

    for (let index = 0; index < CHILD_COUNT; index += 1) {
      const motion = childMotions[index];
      const name = CHILD_NAMES[index];
      const glyphs = labelFont.getGlyphIDs(name);
      const labelWidth = labelFont
        .getGlyphWidths(glyphs)
        .reduce((sum, glyphWidth) => sum + glyphWidth, 0);
      labelPaint.setColor(CanvasKit.Color(184, 178, 206, motion.labelOpacity));
      canvas.drawText(
        name,
        motion.centerX - labelWidth / 2,
        motion.centerY + LABEL_OFFSET * displayScale,
        labelPaint,
        labelFont,
      );
    }

    surface.flush();
    const image = surface.makeImageSnapshot();
    const png = image.encodeToBytes();
    image.delete();

    if (!png) {
      throw new Error(`Could not encode frame ${frame}.`);
    }

    const fileName = `${String(frame).padStart(4, "0")}.png`;
    fs.writeFileSync(path.join(workerData.frameDirectory, fileName), png);
    parentPort.postMessage(frame);
  }

  paint.delete();
  labelPaint.delete();
  labelFont.delete();
  typeface.delete();
  mainEffect.delete();
  miniEffect.delete();
  surface.delete();
}

function readFontData() {
  const fontPath = LABEL_FONT_PATHS.find((candidate) => fs.existsSync(candidate));

  if (!fontPath) {
    throw new Error("No demo font found. Set SHAPE_DEMO_FONT to a .ttf file.");
  }

  const data = fs.readFileSync(fontPath);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function readShaderSource(fileName) {
  const shaderFile = fs.readFileSync(
    path.join(workerData.rootDirectory, "src", fileName),
    "utf8",
  );
  return shaderFile.slice(shaderFile.indexOf("`") + 1, shaderFile.lastIndexOf("`"));
}

function getMiniMotion(input) {
  const startDelay = 1.1 + input.index * 1.35;
  const localTime = input.time - startDelay;
  const isActive = localTime >= 0 ? 1 : 0;
  const phase = (Math.max(localTime, 0) % CHILD_LIFETIME_SECONDS) / CHILD_LIFETIME_SECONDS;
  const travel = phase < 0.20
    ? 0
    : 1 - Math.pow(1 - Math.min(1, (phase - 0.20) / 0.26), 3);
  const laneWidth = Math.min(input.width * 0.16, 64 * (input.width / 390));
  const laneOffset = (input.index - (CHILD_COUNT - 1) / 2) * laneWidth;
  const separation = Math.sin(Math.min(1, travel) * Math.PI) * input.width * 0.025;
  const direction = input.index % 2 === 0 ? -1 : 1;
  const origin = projectBudCenter({ ...input, phase: Math.min(phase, 0.17) });
  const centerX = origin.x
    + (input.width * 0.5 + laneOffset - origin.x) * travel
    + separation * direction;
  const centerY = origin.y + (input.height * 0.87 - origin.y) * travel;
  const handoff = Math.max(0, Math.min(1, (phase - 0.175) / 0.025));
  const fadeOut = 1 - Math.max(0, Math.min(1, (phase - 0.90) / 0.10));
  const labelReveal = Math.max(0, Math.min(1, (phase - 0.30) / 0.08));

  return {
    centerX,
    centerY,
    labelOpacity: isActive * fadeOut * labelReveal * 0.72,
    opacity: isActive * handoff * fadeOut,
    phase,
  };
}

function getActiveMitosis(time) {
  if (time < 1.1) return { index: -1, phase: -1 };
  const cycleTime = (time - 1.1) % CHILD_LIFETIME_SECONDS;
  let index = Math.min(Math.floor(cycleTime / 1.35), CHILD_COUNT - 1);
  let localTime = cycleTime - index * 1.35;

  if (index > 0 && localTime < 0.45) {
    index -= 1;
    localTime += 1.35;
  }

  if (localTime >= 1.8) return { index: -1, phase: -1 };
  return { index, phase: localTime / CHILD_LIFETIME_SECONDS };
}

function projectBudCenter(input) {
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

function getBudCenter(index, phase, shape, morph) {
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

function getShapeSupport(shape) {
  const shapeFloor = Math.floor(shape);
  const blend = smoothProgress(shape - shapeFloor);
  return mix(getSolidSupport(shapeFloor), getSolidSupport(shapeFloor + 1), blend);
}

function getTorusWeight(shape) {
  const shapeFloor = Math.floor(shape);
  const index = shapeFloor % 8;
  const nextIndex = (index + 1) % 8;
  const blend = smoothProgress(shape - shapeFloor);
  return (index === 7 ? 1 - blend : 0) + (nextIndex === 7 ? blend : 0);
}

function getSolidSupport(shape) {
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

function normalize3(x, y, z) {
  const length = Math.sqrt(x * x + y * y + z * z);
  return { x: x / length, y: y / length, z: z / length };
}

function smoothRange(start, end, value) {
  return smoothProgress(Math.max(0, Math.min(1, (value - start) / (end - start))));
}

function smoothProgress(value) {
  return value * value * (3 - 2 * value);
}

function mix(start, end, amount) {
  return start + (end - start) * amount;
}

function getAnimatedValue(time, taps, duration, toggles) {
  let target = 0;
  let transition = null;

  for (const tapTime of taps) {
    if (tapTime > time) break;
    const current = transition ? evaluateTransition(transition, tapTime, duration) : target;
    target = toggles ? (target === 0 ? 1 : 0) : target + 1;
    transition = { startTime: tapTime, startValue: current, target };
  }

  return transition ? evaluateTransition(transition, time, duration) : 0;
}

function evaluateTransition(transition, time, duration) {
  const linear = Math.max(0, Math.min(1, (time - transition.startTime) / duration));
  const eased = linear * linear * (3 - 2 * linear);
  return transition.startValue + (transition.target - transition.startValue) * eased;
}

renderFrames().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
