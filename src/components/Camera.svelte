<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { initPoseLandmarker, detectPose, drawLandmarks } from "../lib/mediapipe";
  import { computeMetrics, type PostureMetrics, type CameraPosition } from "../lib/posture";
  import type { PoseLandmarkerResult } from "@mediapipe/tasks-vision";

  interface Props {
    running: boolean;
    checkIntervalSec: number;
    cameraPosition: CameraPosition;
    postureStatus?: "neutral" | "warning" | "good";
    onMetrics?: (metrics: PostureMetrics) => void;
    onReady?: () => void;
    onError?: (msg: string) => void;
  }

  let { running, checkIntervalSec, cameraPosition, postureStatus = "neutral", onMetrics, onReady, onError }: Props = $props();

  let videoEl: HTMLVideoElement;
  let canvasEl: HTMLCanvasElement;
  let animFrameId: number = 0;
  let detectIntervalId: ReturnType<typeof setInterval> | null = null;
  let lastResult: PoseLandmarkerResult | null = null;
  let lastCheckTime = 0;
  let fps = $state(0);
  let detectCount = 0;
  let fpsTimerId: ReturnType<typeof setInterval> | null = null;

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      videoEl.srcObject = stream;
      await videoEl.play();

      canvasEl.width = videoEl.videoWidth;
      canvasEl.height = videoEl.videoHeight;

      await initPoseLandmarker();
      onReady?.();
    } catch (e: any) {
      onError?.(e.message || "카메라를 사용할 수 없습니다.");
    }
  }

  function detect() {
    if (!videoEl || videoEl.readyState < 2) return;

    const now = performance.now();
    const result = detectPose(videoEl, now);
    if (result) {
      detectCount++;
      lastResult = result;

      if (running && result.landmarks.length > 0) {
        const intervalMs = checkIntervalSec * 1000;
        const shouldCheck = intervalMs <= 0 || now - lastCheckTime >= intervalMs;
        if (shouldCheck) {
          const m = computeMetrics(result.landmarks[0], cameraPosition);
          if (m) {
            onMetrics?.(m);
            lastCheckTime = now;
          }
        }
      }
    }
  }

  // Primary loop: rAF for full speed when visible
  function mainLoop() {
    detect();
    if (lastResult) {
      drawLandmarks(canvasEl, lastResult, postureStatus);
    }
    animFrameId = requestAnimationFrame(mainLoop);
  }

  // Background fallback: setInterval when window is hidden
  function onVisibilityChange() {
    if (document.hidden) {
      // Window hidden: stop rAF, start setInterval fallback
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = 0;
      }
      if (!detectIntervalId) {
        const bgInterval = checkIntervalSec <= 1 ? 100 : 1000;
        detectIntervalId = setInterval(detect, bgInterval);
      }
    } else {
      // Window visible: stop fallback, resume rAF
      if (detectIntervalId) {
        clearInterval(detectIntervalId);
        detectIntervalId = null;
      }
      if (!animFrameId) {
        animFrameId = requestAnimationFrame(mainLoop);
      }
    }
  }

  function startLoops() {
    // FPS counter
    fpsTimerId = setInterval(() => {
      fps = detectCount;
      detectCount = 0;
    }, 1000);

    animFrameId = requestAnimationFrame(mainLoop);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  function stopLoops() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = 0;
    }
    if (detectIntervalId) {
      clearInterval(detectIntervalId);
      detectIntervalId = null;
    }
    if (fpsTimerId) {
      clearInterval(fpsTimerId);
      fpsTimerId = null;
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }

  export function resetCheckTimer() {
    lastCheckTime = 0;
  }

  onMount(() => {
    startCamera().then(() => {
      startLoops();
    });
  });

  onDestroy(() => {
    stopLoops();
    if (videoEl?.srcObject) {
      (videoEl.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    }
  });
</script>

<div class="camera-container">
  <video bind:this={videoEl} playsinline muted></video>
  <canvas bind:this={canvasEl}></canvas>
  <span class="fps">{fps} fps</span>
</div>

<style>
  .camera-container {
    position: relative;
    width: 100%;
    border-radius: 12px;
    overflow: hidden;
    background: #000;
  }
  video {
    width: 100%;
    display: block;
    transform: scaleX(-1);
  }
  canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    transform: scaleX(-1);
  }
  .fps {
    position: absolute;
    top: 8px;
    left: 8px;
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.7);
    font-family: monospace;
  }
</style>
