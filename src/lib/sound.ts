let audioCtx: AudioContext | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let beepCount = 0;
const MAX_BEEPS = 10;

function beep() {
  if (!audioCtx) audioCtx = new AudioContext();
  const ctx = audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.frequency.value = 520;
  osc.type = "sine";

  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.3);
}

export function startAlarm() {
  if (intervalId) return;
  beepCount = 0;
  beep();
  beepCount++;
  intervalId = setInterval(() => {
    if (beepCount >= MAX_BEEPS) {
      stopAlarm();
      return;
    }
    beep();
    beepCount++;
  }, 1000);
}

export function stopAlarm() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
