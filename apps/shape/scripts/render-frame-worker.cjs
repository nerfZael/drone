const fs = require("fs");
const path = require("path");
const { parentPort, workerData } = require("worker_threads");

const CanvasKitInit = require("canvaskit-wasm/bin/full/canvaskit");

const MORPH_TAPS = [0.9, 2.05, 6.65, 6.9, 7.15];
const SHAPE_TAPS = [2.55, 3.1, 3.65, 4.2, 4.75, 5.3, 5.85];

async function renderFrames() {
  const CanvasKit = await CanvasKitInit();
  const effect = CanvasKit.RuntimeEffect.Make(readShaderSource());
  const surface = CanvasKit.MakeSurface(workerData.width, workerData.height);

  if (!effect || !surface) {
    throw new Error("Could not initialize the shader renderer.");
  }

  const canvas = surface.getCanvas();
  const paint = new CanvasKit.Paint();

  for (
    let frame = workerData.workerIndex;
    frame < workerData.totalFrames;
    frame += workerData.workerCount
  ) {
    const time = frame / workerData.framesPerSecond;
    const shader = effect.makeShader([
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
    surface.flush();

    const image = surface.makeImageSnapshot();
    const png = image.encodeToBytes();
    image.delete();
    shader.delete();

    if (!png) {
      throw new Error(`Could not encode frame ${frame}.`);
    }

    const fileName = `${String(frame).padStart(4, "0")}.png`;
    fs.writeFileSync(path.join(workerData.frameDirectory, fileName), png);
    parentPort.postMessage(frame);
  }

  paint.delete();
  effect.delete();
  surface.delete();
}

function readShaderSource() {
  const shaderFile = fs.readFileSync(
    path.join(workerData.rootDirectory, "src/morph-shader.ts"),
    "utf8",
  );
  return shaderFile.slice(shaderFile.indexOf("`") + 1, shaderFile.lastIndexOf("`"));
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
