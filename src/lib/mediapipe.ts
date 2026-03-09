import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

let landmarker: PoseLandmarker | null = null;

export async function initPoseLandmarker(): Promise<PoseLandmarker> {
  if (landmarker) return landmarker;

  const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });

  return landmarker;
}

export function detectPose(
  video: HTMLVideoElement,
  timestampMs: number
): PoseLandmarkerResult | null {
  if (!landmarker) return null;
  return landmarker.detectForVideo(video, timestampMs);
}

const LANDMARK_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;

const KEY_LANDMARKS = [0, 7, 8, 11, 12]; // nose, ears, shoulders

export function drawLandmarks(
  canvas: HTMLCanvasElement,
  result: PoseLandmarkerResult,
  status: "neutral" | "warning" | "good" = "neutral"
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || !result.landmarks.length) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const drawingUtils = new DrawingUtils(ctx);

  for (const landmarks of result.landmarks) {
    // Draw connections (subtle)
    const colors = {
      neutral: { conn: "rgba(255,255,255,0.1)", dot: "rgba(255,255,255,0.15)", key: "rgba(255,255,255,0.7)" },
      warning: { conn: "rgba(255,60,60,0.25)", dot: "rgba(255,60,60,0.35)", key: "rgba(255,60,60,0.9)" },
      good:    { conn: "rgba(60,220,100,0.25)", dot: "rgba(60,220,100,0.35)", key: "rgba(60,220,100,0.9)" },
    }[status];

    const connColor = colors.conn;
    const dotColor = colors.dot;
    const keyColor = colors.key;

    drawingUtils.drawConnectors(landmarks, LANDMARK_CONNECTIONS, {
      color: connColor,
      lineWidth: 1,
    });

    drawingUtils.drawLandmarks(landmarks, {
      color: dotColor,
      radius: 2,
    });

    const keyPoints = KEY_LANDMARKS.map((i) => landmarks[i]).filter(Boolean);
    drawingUtils.drawLandmarks(keyPoints, {
      color: keyColor,
      radius: 4,
    });
  }
}
