<script lang="ts">
  import Camera from "./components/Camera.svelte";
  import ChatLog, { type ChatMessage } from "./components/ChatLog.svelte";
  import Stats, { type PostureStat } from "./components/Stats.svelte";
  import Logo from "./components/Logo.svelte";
  import {
    calibrate,
    analyzePosture,
    type PostureMetrics,
    type CalibrationData,
    type CameraPosition,
  } from "./lib/posture";
  import { startAlarm, stopAlarm } from "./lib/sound";

  type AppState = "idle" | "calibrating" | "monitoring";

  let state: AppState = $state("idle");
  let cameraReady = $state(false);
  let errorMsg = $state("");
  let countdown = $state(3);
  let checkInterval = $state(5);
  let cameraPosition: CameraPosition = $state("front");
  let messages: ChatMessage[] = $state([]);
  let postureStatus: "neutral" | "warning" | "good" = $state("neutral");
  let paused = $state(false);

  let calibrationSamples: PostureMetrics[] = [];
  let baseline: CalibrationData | null = null;
  let msgId = 0;
  let wasWarning = false;
  let lastWarningKey = "";

  // Stats tracking
  let stats: PostureStat[] = $state([]);
  let elapsedSec = $state(0);
  let monitoringStart = 0;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let activeWarningTypes: Set<string> = new Set();
  let lastCheckTimestamp = 0;

  const POSTURE_LABELS: Record<string, string> = {
    "forward-head": "거북목",
    "shoulder-tilt": "어깨 비대칭",
    "head-tilt": "머리 기울임",
    "slouch": "구부정한 자세",
  };

  function startElapsedTimer() {
    monitoringStart = Date.now();
    lastCheckTimestamp = Date.now();
    elapsedTimer = setInterval(() => {
      elapsedSec = Math.floor((Date.now() - monitoringStart) / 1000);
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  function updateStats(warningTypes: string[]) {
    const now = Date.now();
    const deltaSec = Math.round((now - lastCheckTimestamp) / 1000);
    lastCheckTimestamp = now;

    // Add time to types that were active since last check
    for (const type of activeWarningTypes) {
      const existing = stats.find((s) => s.type === type);
      if (existing) {
        existing.totalSec += deltaSec;
      }
    }

    // Update active types and counts
    const newTypes = new Set(warningTypes);
    for (const type of warningTypes) {
      let existing = stats.find((s) => s.type === type);
      if (!existing) {
        stats.push({
          type,
          label: POSTURE_LABELS[type] || type,
          totalSec: 0,
          count: 0,
        });
        existing = stats[stats.length - 1];
      }
      // Count a new occurrence if this type wasn't active before
      if (!activeWarningTypes.has(type)) {
        existing.count++;
      }
    }

    activeWarningTypes = newTypes;
    stats = [...stats]; // trigger reactivity
  }

  function now(): string {
    return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function addMessage(type: ChatMessage["type"], text: string) {
    messages = [...messages, { id: ++msgId, time: now(), type, text }];
  }

  function onCameraReady() {
    cameraReady = true;
  }

  function onCameraError(msg: string) {
    errorMsg = msg;
  }

  function startCalibration() {
    state = "calibrating";
    calibrationSamples = [];
    countdown = 3;

    const interval = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(interval);
        setTimeout(() => {
          if (calibrationSamples.length > 0) {
            baseline = calibrate(calibrationSamples);
            state = "monitoring";
            startElapsedTimer();
            addMessage("info", "캘리브레이션 완료! 자세 모니터링을 시작합니다.");
          } else {
            state = "idle";
            errorMsg = "캘리브레이션 실패: 자세를 감지할 수 없습니다.";
          }
        }, 3000);
      }
    }, 1000);
  }

  function onMetrics(metrics: PostureMetrics) {
    if (state === "calibrating" && countdown <= 0) {
      calibrationSamples.push(metrics);
      return;
    }

    if (state === "monitoring" && baseline && !paused) {
      const warnings = analyzePosture(metrics, baseline);
      updateStats(warnings.map((w) => w.type));

      if (warnings.length === 0) {
        stopAlarm();
        if (wasWarning) {
          postureStatus = "good";
          addMessage("good", "자세가 좋아졌습니다!");
          wasWarning = false;
          lastWarningKey = "";
        } else if (postureStatus === "good") {
          postureStatus = "neutral";
        }
      } else {
        postureStatus = "warning";
        if (!wasWarning) {
          startAlarm();
        }
        wasWarning = true;
        const key = warnings.map((w) => w.type).sort().join(",");
        if (key !== lastWarningKey) {
          lastWarningKey = key;
          const labels = warnings.map((w) => w.label).join(" / ");
          addMessage("warning", labels);
        }
      }
    }
  }

  function recalibrate() {
    state = "idle";
    baseline = null;
    messages = [];
    msgId = 0;
    wasWarning = false;
    lastWarningKey = "";
    postureStatus = "neutral";
    paused = false;
    stopAlarm();
    stopElapsedTimer();
    stats = [];
    elapsedSec = 0;
    activeWarningTypes = new Set();
  }

  function togglePause() {
    paused = !paused;
    if (paused) {
      postureStatus = "neutral";
      wasWarning = false;
      stopAlarm();
      addMessage("info", "일시정지됨");
    } else {
      addMessage("info", "모니터링 재개");
    }
  }

  function clearLog() {
    messages = [];
  }

</script>

<div class="layout">
  <div class="left-panel">
    <div class="brand">
      <Logo size={28} />
      <h1>WatchYourSit</h1>
    </div>

    {#if errorMsg}
      <div class="error">{errorMsg}</div>
    {/if}

    <Camera
      running={state === "calibrating" || state === "monitoring"}
      checkIntervalSec={state === "calibrating" ? 0 : checkInterval}
      {cameraPosition}
      {postureStatus}
      {onMetrics}
      onReady={onCameraReady}
      onError={onCameraError}
    />

    {#if state === "idle"}
      <div class="controls">
        <p class="hint">올바른 자세를 취한 후 캘리브레이션을 시작하세요.</p>
        <div class="settings-row">
          <div class="setting">
            <label for="cam-pos">카메라 위치</label>
            <select id="cam-pos" bind:value={cameraPosition}>
              <option value="left">좌측</option>
              <option value="front">정면</option>
              <option value="right">우측</option>
            </select>
          </div>
          <div class="setting">
            <label for="interval">검사 간격</label>
            <select id="interval" bind:value={checkInterval}>
              <option value={0}>연속</option>
              <option value={1}>1초</option>
              <option value={3}>3초</option>
              <option value={5}>5초</option>
              <option value={10}>10초</option>
              <option value={15}>15초</option>
              <option value={30}>30초</option>
              <option value={60}>1분</option>
            </select>
          </div>
        </div>
        <button onclick={startCalibration} disabled={!cameraReady}>
          {cameraReady ? "캘리브레이션 시작" : "카메라 로딩 중..."}
        </button>
      </div>
    {:else if state === "calibrating"}
      <div class="calibration-status">
        {#if countdown > 0}
          <p class="countdown">{countdown}</p>
          <p>올바른 자세를 유지하세요</p>
        {:else}
          <p class="collecting">기준값 수집 중...</p>
        {/if}
      </div>
    {:else if state === "monitoring"}
      <div class="controls">
        <span class="interval-label">
          {paused ? '일시정지' : checkInterval === 0 ? '연속 검사 중' : `${checkInterval}초마다 검사 중`}
        </span>
        <div class="btn-row">
          <button onclick={togglePause} class="btn-pause">
            {paused ? '재개' : '일시정지'}
          </button>
          <button onclick={recalibrate} class="btn-recal">재캘리브레이션</button>
        </div>
      </div>
    {/if}
  </div>

  <div class="right-panel">
    <div class="panel-header">
      <h2>검사 기록</h2>
      {#if messages.length > 0}
        <button class="clear-btn" onclick={clearLog}>지우기</button>
      {/if}
    </div>
    <ChatLog {messages} />

    <div class="stats-area">
      <Stats {stats} {elapsedSec} />
    </div>
  </div>
</div>

<style>
  .layout {
    display: flex;
    gap: 1.5rem;
    padding: 1.5rem;
    height: 100vh;
    width: 100%;
    overflow: hidden;
  }
  .left-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    flex: 2;
    min-width: 0;
  }
  .right-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: #e0e0e0;
  }
  h1 {
    font-size: 1.5rem;
    margin: 0;
    color: #e0e0e0;
    font-weight: 300;
    letter-spacing: 0.02em;
  }
  h2 {
    font-size: 1.1rem;
    margin: 0;
    color: #666;
    font-weight: 400;
  }
  .clear-btn {
    background: none;
    border: none;
    color: #444;
    font-size: 0.8rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
  }
  .clear-btn:hover {
    color: #888;
  }
  .error {
    color: #999;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid #333;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    width: 100%;
    text-align: center;
  }
  .controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }
  .hint {
    color: #555;
    margin: 0;
    font-size: 0.9rem;
  }
  .settings-row {
    display: flex;
    gap: 1.25rem;
  }
  .setting {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
  }
  .setting label {
    color: #555;
  }
  .setting select {
    background: #141414;
    color: #aaa;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    font-size: 0.9rem;
  }
  .interval-label {
    color: #555;
    font-size: 0.85rem;
  }
  button {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    border-radius: 8px;
    border: 1px solid #333;
    background: #1a1a1a;
    color: #ccc;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  button:hover {
    background: #222;
    border-color: #444;
    color: #fff;
  }
  button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .btn-row {
    display: flex;
    gap: 0.75rem;
  }
  .btn-pause {
    background: transparent;
    border: 1px solid #444;
    color: #aaa;
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
  }
  .btn-pause:hover {
    border-color: #666;
    color: #ccc;
  }
  .btn-recal {
    background: transparent;
    border: 1px solid #333;
    color: #555;
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
  }
  .btn-recal:hover {
    border-color: #555;
    color: #999;
  }
  .calibration-status {
    text-align: center;
  }
  .countdown {
    font-size: 3rem;
    font-weight: 200;
    margin: 0;
    color: #e0e0e0;
  }
  .collecting {
    color: #888;
    font-weight: 400;
  }

  .stats-area {
    margin-top: 0.75rem;
    flex-shrink: 0;
  }

  @media (max-width: 800px) {
    .layout {
      flex-direction: column;
    }
    .left-panel {
      width: 100%;
    }
    .right-panel {
      min-height: 300px;
    }
  }
</style>
