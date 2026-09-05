const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("events");
const { spawn } = require("child_process");
const { Worker } = require("worker_threads");

const VIDEO_WIDTH = 540;
const VIDEO_HEIGHT = 1168;
const FRAMES_PER_SECOND = 20;
const DURATION_SECONDS = 8;
const MAX_WORKERS = 16;
const TOTAL_FRAMES = DURATION_SECONDS * FRAMES_PER_SECOND;
const ROOT_DIRECTORY = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT_DIRECTORY, "shape-demo.mp4");
const WORKER_PATH = path.join(__dirname, "render-frame-worker.cjs");

async function renderDemo() {
  const frameDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "shape-video-"));
  const workerCount = Math.min(MAX_WORKERS, os.availableParallelism(), TOTAL_FRAMES);
  let renderedFrames = 0;

  try {
    process.stdout.write(`Rendering ${TOTAL_FRAMES} native-resolution frames with ${workerCount} workers\n`);
    await Promise.all(
      Array.from({ length: workerCount }, (_, workerIndex) =>
        runWorker(workerIndex, workerCount, frameDirectory, () => {
          renderedFrames += 1;
          if (renderedFrames % FRAMES_PER_SECOND === 0 || renderedFrames === TOTAL_FRAMES) {
            process.stdout.write(`Rendered ${renderedFrames} / ${TOTAL_FRAMES} frames\n`);
          }
        }),
      ),
    );

    await encodeFrames(frameDirectory);
    process.stdout.write(`Saved ${OUTPUT_PATH}\n`);
  } finally {
    fs.rmSync(frameDirectory, { force: true, recursive: true });
  }
}

function runWorker(workerIndex, workerCount, frameDirectory, onFrame) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: {
        frameDirectory,
        framesPerSecond: FRAMES_PER_SECOND,
        height: VIDEO_HEIGHT,
        rootDirectory: ROOT_DIRECTORY,
        totalFrames: TOTAL_FRAMES,
        width: VIDEO_WIDTH,
        workerCount,
        workerIndex,
      },
    });

    worker.on("message", onFrame);
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Frame worker ${workerIndex} exited with code ${code}.`));
    });
  });
}

async function encodeFrames(frameDirectory) {
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(FRAMES_PER_SECOND),
      "-i",
      path.join(frameDirectory, "%04d.png"),
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
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  const [exitCode] = await once(ffmpeg, "close");

  if (exitCode !== 0) {
    throw new Error(`ffmpeg exited with code ${exitCode}.`);
  }
}

renderDemo().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
