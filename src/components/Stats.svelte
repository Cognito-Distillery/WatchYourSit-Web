<script lang="ts">
  export interface PostureStat {
    type: string;
    label: string;
    totalSec: number;
    count: number;
  }

  interface Props {
    stats: PostureStat[];
    elapsedSec: number;
  }

  let { stats, elapsedSec }: Props = $props();

  function fmt(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}분 ${s}초` : `${s}초`;
  }

  const goodSec = $derived(
    Math.max(0, elapsedSec - stats.reduce((sum, s) => sum + s.totalSec, 0))
  );
  const goodPct = $derived(elapsedSec > 0 ? Math.round((goodSec / elapsedSec) * 100) : 100);
</script>

<div class="stats-panel">
  <div class="stats-header">
    <h3>자세 통계</h3>
    <span class="elapsed">{fmt(elapsedSec)}</span>
  </div>

  <div class="good-bar">
    <div class="good-info">
      <span>바른 자세</span>
      <span class="pct">{goodPct}%</span>
    </div>
    <div class="bar-track">
      <div class="bar-fill good-fill" style="width: {goodPct}%"></div>
    </div>
  </div>

  {#each stats as stat}
    {@const pct = elapsedSec > 0 ? Math.round((stat.totalSec / elapsedSec) * 100) : 0}
    <div class="stat-row">
      <div class="stat-info">
        <span class="stat-label">{stat.label}</span>
        <span class="stat-detail">{stat.count}회 / {fmt(stat.totalSec)}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill bad-fill" style="width: {pct}%"></div>
      </div>
    </div>
  {/each}

  {#if stats.length === 0}
    <p class="no-data">아직 감지된 문제가 없습니다.</p>
  {/if}
</div>

<style>
  .stats-panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 12px;
    border: 1px solid #1a1a1a;
  }
  .stats-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h3 {
    margin: 0;
    font-size: 0.95rem;
    color: #666;
    font-weight: 400;
  }
  .elapsed {
    font-size: 0.75rem;
    color: #444;
  }
  .good-bar, .stat-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .good-info, .stat-info {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
  }
  .good-info span:first-child { color: #888; }
  .pct {
    color: #999;
    font-weight: 500;
  }
  .stat-label { color: #777; }
  .stat-detail {
    color: #444;
    font-size: 0.75rem;
  }
  .bar-track {
    height: 3px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 2px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s;
  }
  .good-fill { background: #555; }
  .bad-fill { background: #888; }
  .no-data {
    color: #333;
    font-size: 0.85rem;
    text-align: center;
    margin: 0.5rem 0;
  }
</style>
