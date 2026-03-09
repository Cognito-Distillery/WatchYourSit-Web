import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type CameraPosition = "left" | "front" | "right";

/** Front view metrics: symmetry-based */
export interface FrontMetrics {
  view: "front";
  /** Vertical gap between ears and shoulders (larger = upright) */
  earShoulderYGap: number;
  /** Left shoulder y - right shoulder y */
  shoulderTilt: number;
  /** Left ear y - right ear y */
  headTilt: number;
  /** Ear-shoulder distance / shoulder width */
  earShoulderDistRatio: number;
}

/** Side view metrics: x-axis displacement + partial symmetry */
export interface SideMetrics {
  view: "side";
  /** Horizontal offset of ear from shoulder (forward head = larger offset) */
  earShoulderXOffset: number;
  /** Vertical gap between ear and shoulder (slouch = smaller) */
  earShoulderYGap: number;
  /** Nose y relative to ear y (head drop) */
  noseEarYDiff: number;
  /** Left shoulder y - right shoulder y (still partially visible at 45deg) */
  shoulderTilt: number;
  /** Left ear y - right ear y */
  headTilt: number;
}

export type PostureMetrics = FrontMetrics | SideMetrics;

export type CalibrationData = PostureMetrics;

export interface PostureWarning {
  type: "forward-head" | "shoulder-tilt" | "head-tilt" | "slouch";
  label: string;
  severity: number; // 0-1
}

function avg(a: number, b: number): number {
  return (a + b) / 2;
}

export function computeMetrics(
  landmarks: NormalizedLandmark[],
  cameraPosition: CameraPosition
): PostureMetrics | null {
  const nose = landmarks[0];
  const leftEar = landmarks[7];
  const rightEar = landmarks[8];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];

  if (!nose || !leftEar || !rightEar || !leftShoulder || !rightShoulder) {
    return null;
  }

  const earX = avg(leftEar.x, rightEar.x);
  const earY = avg(leftEar.y, rightEar.y);
  const shoulderX = avg(leftShoulder.x, rightShoulder.x);
  const shoulderY = avg(leftShoulder.y, rightShoulder.y);

  if (cameraPosition === "front") {
    const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
    const earShoulderDist = Math.sqrt(
      (earX - shoulderX) ** 2 + (earY - shoulderY) ** 2
    );
    return {
      view: "front",
      earShoulderYGap: shoulderY - earY,
      shoulderTilt: leftShoulder.y - rightShoulder.y,
      headTilt: leftEar.y - rightEar.y,
      earShoulderDistRatio: shoulderWidth > 0 ? earShoulderDist / shoulderWidth : 0,
    };
  }

  // Side view (left or right)
  // For left camera: user faces right, ear forward = ear.x < shoulder.x
  // For right camera: user faces left, ear forward = ear.x > shoulder.x
  // We normalize so positive = forward
  const sign = cameraPosition === "left" ? -1 : 1;
  return {
    view: "side",
    earShoulderXOffset: sign * (earX - shoulderX),
    earShoulderYGap: shoulderY - earY,
    noseEarYDiff: nose.y - earY,
    shoulderTilt: leftShoulder.y - rightShoulder.y,
    headTilt: leftEar.y - rightEar.y,
  };
}

export function calibrate(samples: PostureMetrics[]): CalibrationData {
  const n = samples.length;

  if (samples[0].view === "front") {
    const fronts = samples as FrontMetrics[];
    return {
      view: "front",
      earShoulderYGap: fronts.reduce((s, m) => s + m.earShoulderYGap, 0) / n,
      shoulderTilt: fronts.reduce((s, m) => s + m.shoulderTilt, 0) / n,
      headTilt: fronts.reduce((s, m) => s + m.headTilt, 0) / n,
      earShoulderDistRatio: fronts.reduce((s, m) => s + m.earShoulderDistRatio, 0) / n,
    };
  }

  const sides = samples as SideMetrics[];
  return {
    view: "side",
    earShoulderXOffset: sides.reduce((s, m) => s + m.earShoulderXOffset, 0) / n,
    earShoulderYGap: sides.reduce((s, m) => s + m.earShoulderYGap, 0) / n,
    noseEarYDiff: sides.reduce((s, m) => s + m.noseEarYDiff, 0) / n,
    shoulderTilt: sides.reduce((s, m) => s + m.shoulderTilt, 0) / n,
    headTilt: sides.reduce((s, m) => s + m.headTilt, 0) / n,
  };
}

// --- Thresholds ---

const FRONT_TH = {
  forwardHead: 0.15,  // earShoulderYGap decrease ratio
  shoulderTilt: 0.02, // absolute y diff
  headTilt: 0.02,     // absolute y diff
  slouch: 0.15,       // earShoulderDistRatio decrease ratio
};

const SIDE_TH = {
  forwardHead: 0.03,   // x-offset increase (absolute)
  slouch: 0.15,        // earShoulderYGap decrease ratio
  headDrop: 0.03,      // nose-ear y diff increase (absolute)
  shoulderTilt: 0.035, // relaxed vs front (45deg perspective)
  headTilt: 0.035,     // relaxed vs front
};

export function analyzePosture(
  metrics: PostureMetrics,
  baseline: CalibrationData,
): PostureWarning[] {
  if (metrics.view !== baseline.view) return [];

  if (metrics.view === "front" && baseline.view === "front") {
    return analyzeFront(metrics, baseline);
  }
  if (metrics.view === "side" && baseline.view === "side") {
    return analyzeSide(metrics, baseline);
  }
  return [];
}

function analyzeFront(m: FrontMetrics, b: FrontMetrics): PostureWarning[] {
  const warnings: PostureWarning[] = [];

  // Forward head: vertical gap decreased
  const gapDrop = b.earShoulderYGap - m.earShoulderYGap;
  if (gapDrop > FRONT_TH.forwardHead * b.earShoulderYGap) {
    warnings.push({
      type: "forward-head",
      label: "거북목 주의!",
      severity: Math.min(1, gapDrop / (b.earShoulderYGap * FRONT_TH.forwardHead * 2)),
    });
  }

  // Shoulder tilt
  const sDiff = Math.abs(m.shoulderTilt - b.shoulderTilt);
  if (sDiff > FRONT_TH.shoulderTilt) {
    warnings.push({
      type: "shoulder-tilt",
      label: "어깨 비대칭!",
      severity: Math.min(1, sDiff / (FRONT_TH.shoulderTilt * 3)),
    });
  }

  // Head tilt
  const hDiff = Math.abs(m.headTilt - b.headTilt);
  if (hDiff > FRONT_TH.headTilt) {
    warnings.push({
      type: "head-tilt",
      label: "머리 기울임!",
      severity: Math.min(1, hDiff / (FRONT_TH.headTilt * 3)),
    });
  }

  // Slouch
  const distDrop = b.earShoulderDistRatio - m.earShoulderDistRatio;
  if (distDrop > FRONT_TH.slouch * b.earShoulderDistRatio) {
    warnings.push({
      type: "slouch",
      label: "구부정한 자세!",
      severity: Math.min(1, distDrop / (b.earShoulderDistRatio * FRONT_TH.slouch * 2)),
    });
  }

  return warnings;
}

function analyzeSide(m: SideMetrics, b: SideMetrics): PostureWarning[] {
  const warnings: PostureWarning[] = [];

  // Forward head: ear moved forward relative to shoulder (x offset increased)
  const xIncrease = m.earShoulderXOffset - b.earShoulderXOffset;
  if (xIncrease > SIDE_TH.forwardHead) {
    warnings.push({
      type: "forward-head",
      label: "거북목 주의!",
      severity: Math.min(1, xIncrease / (SIDE_TH.forwardHead * 3)),
    });
  }

  // Slouch: vertical gap decreased (shoulders rise toward ears or head drops)
  const gapDrop = b.earShoulderYGap - m.earShoulderYGap;
  if (gapDrop > SIDE_TH.slouch * b.earShoulderYGap) {
    warnings.push({
      type: "slouch",
      label: "구부정한 자세!",
      severity: Math.min(1, gapDrop / (b.earShoulderYGap * SIDE_TH.slouch * 2)),
    });
  }

  // Head drop: nose drops relative to ear (looking down)
  const noseDrop = m.noseEarYDiff - b.noseEarYDiff;
  if (noseDrop > SIDE_TH.headDrop) {
    warnings.push({
      type: "head-tilt",
      label: "고개 숙임!",
      severity: Math.min(1, noseDrop / (SIDE_TH.headDrop * 3)),
    });
  }

  // Shoulder tilt (still partially visible at 45deg)
  const sDiff = Math.abs(m.shoulderTilt - b.shoulderTilt);
  if (sDiff > SIDE_TH.shoulderTilt) {
    warnings.push({
      type: "shoulder-tilt",
      label: "어깨 비대칭!",
      severity: Math.min(1, sDiff / (SIDE_TH.shoulderTilt * 3)),
    });
  }

  // Head tilt
  const hDiff = Math.abs(m.headTilt - b.headTilt);
  if (hDiff > SIDE_TH.headTilt) {
    warnings.push({
      type: "head-tilt",
      label: "머리 기울임!",
      severity: Math.min(1, hDiff / (SIDE_TH.headTilt * 3)),
    });
  }

  return warnings;
}
