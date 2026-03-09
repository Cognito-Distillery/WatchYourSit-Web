<script lang="ts">
  import Camera from "./components/Camera.svelte";
  import ChatLog, { type ChatMessage } from "./components/ChatLog.svelte";
  import Stats, { type PostureStat } from "./components/Stats.svelte";
  import Logo from "./components/Logo.svelte";
  import {
    calibrate,
    analyzePosture,
    resetSmoothing,
    type PostureMetrics,
    type CalibrationData,
    type CameraPosition,
  } from "./lib/posture";
  import { startAlarm, stopAlarm } from "./lib/sound";

  interface SavedConfig {
    id: string;
    name: string;
    cameraPosition: CameraPosition;
    checkInterval: number;
    baseline: CalibrationData;
    createdAt: number;
  }

  const STORAGE_KEY = "watchyoursit-configs";

  function loadConfigs(): SavedConfig[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function saveConfigs(configs: SavedConfig[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  }

  function deleteConfig(id: string) {
    const configs = loadConfigs().filter(c => c.id !== id);
    saveConfigs(configs);
    savedConfigs = configs;
  }

  const CAM_POS_LABELS: Record<CameraPosition, string> = {
    left: "좌측",
    front: "정면",
    right: "우측",
  };

  type AppState = "idle" | "new-config" | "pick-config" | "calibrating" | "monitoring";

  let state: AppState = $state("idle");
  let cameraReady = $state(false);
  let errorMsg = $state("");
  let countdown = $state(3);
  let checkInterval = $state(5);
  let cameraPosition: CameraPosition = $state("front");
  let configName = $state("");
  let messages: ChatMessage[] = $state([]);
  let postureStatus: "neutral" | "warning" | "good" = $state("neutral");
  let paused = $state(false);
  let privacyMode = $state(false);
  let savedConfigs: SavedConfig[] = $state(loadConfigs());

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
    "forward-lean": "앞으로 기울어짐",
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

    for (const type of activeWarningTypes) {
      const existing = stats.find((s) => s.type === type);
      if (existing) {
        existing.totalSec += deltaSec;
      }
    }

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
      if (!activeWarningTypes.has(type)) {
        existing.count++;
      }
    }

    activeWarningTypes = newTypes;
    stats = [...stats];
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

  function goNewConfig() {
    state = "new-config";
    configName = "";
    cameraPosition = "front";
    checkInterval = 5;
  }

  function goPickConfig() {
    savedConfigs = loadConfigs();
    state = "pick-config";
  }

  function loadSavedConfig(config: SavedConfig) {
    configName = config.name;
    cameraPosition = config.cameraPosition;
    checkInterval = config.checkInterval;
    baseline = config.baseline;
    resetSmoothing();
    state = "monitoring";
    startElapsedTimer();
    addMessage("info", `"${config.name}" 설정으로 모니터링을 시작합니다.`);
  }

  function startCalibration() {
    state = "calibrating";
    calibrationSamples = [];
    countdown = 3;
    resetSmoothing();

    const interval = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(interval);
        setTimeout(() => {
          if (calibrationSamples.length > 0) {
            baseline = calibrate(calibrationSamples);

            // Save to localStorage
            const newConfig: SavedConfig = {
              id: crypto.randomUUID(),
              name: configName || "이름 없음",
              cameraPosition,
              checkInterval,
              baseline,
              createdAt: Date.now(),
            };
            const configs = loadConfigs();
            configs.unshift(newConfig);
            saveConfigs(configs);
            savedConfigs = configs;

            state = "monitoring";
            startElapsedTimer();
            addMessage("info", "기준 자세 등록 완료! 모니터링을 시작합니다.");
          } else {
            state = "new-config";
            errorMsg = "등록 실패: 자세를 감지할 수 없습니다. 카메라에 상체가 보이는지 확인하세요.";
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

  function goHome() {
    state = "idle";
    baseline = null;
    resetSmoothing();
    messages = [];
    msgId = 0;
    wasWarning = false;
    lastWarningKey = "";
    postureStatus = "neutral";
    paused = false;
    privacyMode = false;
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

  function formatInterval(sec: number): string {
    return sec === 0 ? "연속" : sec < 60 ? `${sec}초` : `${sec / 60}분`;
  }

  function formatDate(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })
      + " " + d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }

  const CAM_POS_DESC: Record<CameraPosition, string> = {
    left: "카메라가 내 왼쪽에 위치",
    front: "카메라가 정면에 위치",
    right: "카메라가 내 오른쪽에 위치",
  };
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
      {privacyMode}
      {onMetrics}
      onReady={onCameraReady}
      onError={onCameraError}
    />

    {#if state === "idle"}
      <p class="intro">카메라로 자세를 분석해 거북목, 구부정한 자세 등을 알려드립니다.</p>
      <div class="choose-buttons">
        <button class="choose-btn" onclick={goNewConfig}>
          <span class="choose-icon">+</span>
          <span class="choose-label">새 설정</span>
          <span class="choose-desc">기준 자세를 새로 등록합니다</span>
        </button>
        <button class="choose-btn" onclick={goPickConfig} disabled={loadConfigs().length === 0}>
          <span class="choose-icon">↻</span>
          <span class="choose-label">이전 설정</span>
          <span class="choose-desc">{loadConfigs().length > 0 ? `저장된 설정 ${loadConfigs().length}개` : '저장된 설정이 없습니다'}</span>
        </button>
      </div>

    {:else if state === "new-config"}
      <div class="controls">
        <div class="config-form">
          <div class="setting">
            <label for="config-name">설정 이름</label>
            <input id="config-name" type="text" bind:value={configName} placeholder="예: 사무실, 카페" />
          </div>
          <div class="setting-group">
            <div class="setting">
              <label for="cam-pos">카메라 위치</label>
              <select id="cam-pos" bind:value={cameraPosition}>
                <option value="left">좌측</option>
                <option value="front">정면</option>
                <option value="right">우측</option>
              </select>
            </div>
            <p class="setting-help">{CAM_POS_DESC[cameraPosition]}</p>
          </div>
          <div class="setting-group">
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
            <p class="setting-help">자세를 얼마나 자주 확인할지 설정합니다</p>
          </div>
        </div>
        <div class="guide-box">
          <p>화면에 올바른 자세가 보이는 상태에서 시작하세요.</p>
          <p>3초 카운트다운 후 약 3초간 기준 자세를 기록합니다.</p>
        </div>
        <div class="btn-row">
          <button class="btn-back" onclick={() => state = 'idle'}>뒤로</button>
          <button onclick={startCalibration} disabled={!cameraReady}>
            {cameraReady ? "기준 자세 등록" : "카메라 로딩 중..."}
          </button>
        </div>
      </div>

    {:else if state === "pick-config"}
      <p class="hint">이전에 저장한 설정을 선택하면 바로 모니터링을 시작합니다.</p>
      <div class="config-list">
        {#each savedConfigs as config (config.id)}
          <div class="config-item">
            <button class="config-select" onclick={() => loadSavedConfig(config)}>
              <div class="config-info">
                <span class="config-name">{config.name}</span>
                <span class="config-date">{formatDate(config.createdAt)}</span>
              </div>
              <span class="config-meta">
                {CAM_POS_LABELS[config.cameraPosition]} · {formatInterval(config.checkInterval)}
              </span>
            </button>
            <button class="config-delete" onclick={() => deleteConfig(config.id)}>×</button>
          </div>
        {/each}
      </div>
      <button class="btn-back" onclick={() => state = 'idle'}>뒤로</button>

    {:else if state === "calibrating"}
      <div class="calibration-status">
        {#if countdown > 0}
          <p class="countdown">{countdown}</p>
          <p>올바른 자세를 유지하세요</p>
        {:else}
          <p class="collecting">기준 자세 기록 중...</p>
        {/if}
      </div>
    {:else if state === "monitoring"}
      <div class="controls">
        <span class="interval-label">
          {paused ? '일시정지' : checkInterval === 0 ? '연속 검사 중' : `${checkInterval}초마다 검사 중`}
        </span>
        <div class="btn-row">
          <button onclick={() => privacyMode = !privacyMode} class="btn-privacy" class:active={privacyMode} title="카메라 영상을 숨기고 뼈대만 표시합니다">
            {privacyMode ? '카메라 보기' : '프라이버시'}
          </button>
          <button onclick={togglePause} class="btn-pause">
            {paused ? '재개' : '일시정지'}
          </button>
          <button onclick={goHome} class="btn-recal">처음으로</button>
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
  .intro {
    color: #555;
    font-size: 0.9rem;
    margin: 0;
    text-align: center;
  }

  /* Choose screen */
  .choose-buttons {
    display: flex;
    gap: 1rem;
    width: 100%;
  }
  .choose-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1.5rem 1rem;
    background: #141414;
    border: 1px solid #2a2a2a;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .choose-btn:hover:not(:disabled) {
    background: #1a1a1a;
    border-color: #444;
  }
  .choose-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .choose-icon {
    font-size: 2rem;
    color: #888;
    line-height: 1;
  }
  .choose-label {
    font-size: 1.1rem;
    color: #ccc;
    font-weight: 500;
  }
  .choose-desc {
    font-size: 0.8rem;
    color: #555;
  }

  /* Config form */
  .config-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    max-width: 360px;
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
  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .setting-help {
    color: #444;
    font-size: 0.75rem;
    margin: 0;
    padding-left: 0.1rem;
  }
  .guide-box {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid #222;
    border-radius: 8px;
    padding: 0.75rem 1rem;
    max-width: 360px;
  }
  .guide-box p {
    color: #555;
    font-size: 0.8rem;
    margin: 0.15rem 0;
  }
  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.9rem;
  }
  .setting label {
    color: #555;
    flex-shrink: 0;
  }
  .setting select,
  .setting input {
    background: #141414;
    color: #aaa;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    padding: 0.4rem 0.6rem;
    font-size: 0.9rem;
    flex: 1;
    min-width: 0;
  }
  .setting input::placeholder {
    color: #444;
  }
  .interval-label {
    color: #555;
    font-size: 0.85rem;
  }

  /* Config list */
  .config-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    max-height: 280px;
    overflow-y: auto;
  }
  .config-item {
    display: flex;
    align-items: center;
    background: #141414;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    overflow: hidden;
    transition: all 0.2s;
  }
  .config-item:hover {
    border-color: #444;
  }
  .config-select {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    background: none;
    border: none;
    border-radius: 0;
    cursor: pointer;
    text-align: left;
  }
  .config-select:hover {
    background: #1a1a1a;
  }
  .config-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1;
  }
  .config-name {
    font-size: 0.95rem;
    color: #ccc;
    font-weight: 500;
  }
  .config-date {
    font-size: 0.7rem;
    color: #444;
  }
  .config-meta {
    font-size: 0.8rem;
    color: #555;
    flex-shrink: 0;
  }
  .config-delete {
    background: none;
    border: none;
    border-left: 1px solid #2a2a2a;
    color: #444;
    font-size: 1.1rem;
    cursor: pointer;
    padding: 0.85rem 0.75rem;
    line-height: 1;
    flex-shrink: 0;
    border-radius: 0;
  }
  .config-delete:hover {
    color: #ff4444;
    background: rgba(255, 68, 68, 0.05);
  }

  /* Buttons */
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
  .btn-back {
    background: transparent;
    border: 1px solid #333;
    color: #555;
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
  }
  .btn-back:hover {
    border-color: #555;
    color: #999;
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
  .btn-privacy {
    background: transparent;
    border: 1px solid #444;
    color: #aaa;
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
  }
  .btn-privacy:hover {
    border-color: #666;
    color: #ccc;
  }
  .btn-privacy.active {
    border-color: #5a5aff;
    color: #8a8aff;
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
