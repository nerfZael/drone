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
    let shader = mainEffect.makeShader([
      workerData.width,
      workerData.height,
      -0.18 + Math.sin(time * 0.72) * 0.24,
      0.32 + time * 0.48,
      time,
      getAnimatedValue(time, MORPH_TAPS, 0.76, true),
      getAnimatedValue(time, SHAPE_TAPS, 0.62, false),
      1,
    ]);

    paint.setShader(shader);
    canvas.drawRect(CanvasKit.XYWHRect(0, 0, workerData.width, workerData.height), paint);
    shader.delete();

    const childObjectSize = 96 * displayScale;
    const childRenderSize = 144 * displayScale;
    const childMotions = [];
    for (let index = 0; index < CHILD_COUNT; index += 1) {
      const motion = getMiniMotion(time, index, workerData.width, workerData.height);
      childMotions.push(motion);
      shader = miniEffect.makeShader([
        motion.centerX,
        motion.centerY,
        motion.attachmentX,
        motion.attachmentY,
        childObjectSize,
        time,
        motion.phase,
        index / CHILD_COUNT,
        motion.opacity,
        1,
      ]);
      paint.setShader(shader);
      canvas.drawRect(
        CanvasKit.XYWHRect(
          motion.centerX - childRenderSize / 2,
          motion.centerY - childRenderSize / 2,
          childRenderSize,
          childRenderSize,
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

function getMiniMotion(time, index, width, height) {
  const startDelay = 1.1 + index * 1.35;
  const localTime = time - startDelay;
  const isActive = localTime >= 0 ? 1 : 0;
  const phase = (Math.max(localTime, 0) % CHILD_LIFETIME_SECONDS) / CHILD_LIFETIME_SECONDS;
  const travel = phase < 0.14
    ? 0
    : 1 - Math.pow(1 - Math.min(1, (phase - 0.14) / 0.28), 3);
  const laneWidth = Math.min(width * 0.16, 64 * (width / 390));
  const laneOffset = (index - (CHILD_COUNT - 1) / 2) * laneWidth;
  const attachmentOffset = (index - (CHILD_COUNT - 1) / 2) * width * 0.014;
  const separation = Math.sin(Math.min(1, travel) * Math.PI) * width * 0.025;
  const direction = index % 2 === 0 ? -1 : 1;
  const attachmentX = width * 0.5 + attachmentOffset;
  const attachmentY = height * 0.603;
  const budProgress = 1 - Math.pow(1 - Math.min(1, phase / 0.11), 3);
  const budY = attachmentY + height * 0.028 * budProgress;
  const fadeIn = Math.min(1, phase / 0.035);
  const fadeOut = 1 - Math.max(0, Math.min(1, (phase - 0.90) / 0.10));
  const labelReveal = Math.max(0, Math.min(1, (phase - 0.28) / 0.08));

  return {
    attachmentX,
    attachmentY,
    centerX: attachmentX + (laneOffset - attachmentOffset) * travel
      + separation * direction,
    centerY: budY + (height * 0.87 - budY) * travel,
    labelOpacity: isActive * fadeOut * labelReveal * 0.72,
    opacity: isActive * fadeIn * fadeOut,
    phase,
  };
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
