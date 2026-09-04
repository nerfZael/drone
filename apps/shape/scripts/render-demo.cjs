const fs = require("fs");
const path = require("path");
const { once } = require("events");
const { spawn } = require("child_process");

const CanvasKitInit = require("canvaskit-wasm/bin/full/canvaskit");

const RENDER_WIDTH = 270;
const RENDER_HEIGHT = 584;
const VIDEO_WIDTH = 540;
const VIDEO_HEIGHT = 1168;
const FRAMES_PER_SECOND = 20;
const DURATION_SECONDS = 8;
const ROOT_DIRECTORY = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT_DIRECTORY, "shape-demo.mp4");
const MORPH_TAPS = [0.9, 2.05, 6.65, 6.9, 7.15];
const SHAPE_TAPS = [2.55, 3.1, 3.65, 4.2, 4.75, 5.3, 5.85];

async function renderDemo() {
  const CanvasKit = await CanvasKitInit();
  const effect = CanvasKit.RuntimeEffect.Make(readShaderSource());
  const surface = CanvasKit.MakeSurface(RENDER_WIDTH, RENDER_HEIGHT);

  if (!effect || !surface) {
    throw new Error("Could not initialize the shader renderer.");
  }

  const canvas = surface.getCanvas();
  const paint = new CanvasKit.Paint();
  const ffmpeg = startEncoder();
  const totalFrames = DURATION_SECONDS * FRAMES_PER_SECOND;

  for (let frame = 0; frame < totalFrames; frame += 1) {
    const time = frame / FRAMES_PER_SECOND;
    const shader = effect.makeShader([
      RENDER_WIDTH,
      RENDER_HEIGHT,
      -0.18 + Math.sin(time * 0.72) * 0.24,
      0.32 + time * 0.48,
      time,
      getAnimatedValue(time, MORPH_TAPS, 0.76, true),
      getAnimatedValue(time, SHAPE_TAPS, 0.62, false),
    ]);

    paint.setShader(shader);
    canvas.drawRect(CanvasKit.XYWHRect(0, 0, RENDER_WIDTH, RENDER_HEIGHT), paint);
    surface.flush();

    const image = surface.makeImageSnapshot();
    const png = image.encodeToBytes();
    image.delete();
    shader.delete();

    if (!png) {
      throw new Error(`Could not encode frame ${frame}.`);
    }

    if (!ffmpeg.stdin.write(Buffer.from(png))) {
      await once(ffmpeg.stdin, "drain");
    }

    if (frame % FRAMES_PER_SECOND === 0) {
      process.stdout.write(`Rendered ${Math.round(time)}s / ${DURATION_SECONDS}s\n`);
    }
  }

  ffmpeg.stdin.end();
  const [exitCode] = await once(ffmpeg, "close");
  paint.delete();
  effect.delete();
  surface.delete();

  if (exitCode !== 0) {
    throw new Error(`ffmpeg exited with code ${exitCode}.`);
  }

  process.stdout.write(`Saved ${OUTPUT_PATH}\n`);
}

function readShaderSource() {
  const shaderFile = fs.readFileSync(path.join(ROOT_DIRECTORY, "src/morph-shader.ts"), "utf8");
  return shaderFile.slice(shaderFile.indexOf("`") + 1, shaderFile.lastIndexOf("`"));
}

function startEncoder() {
  return spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-framerate",
      String(FRAMES_PER_SECOND),
      "-i",
      "pipe:0",
      "-vf",
      `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:flags=lanczos`,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "17",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      OUTPUT_PATH,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
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

renderDemo().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
