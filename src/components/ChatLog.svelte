<script lang="ts">
  import { tick } from "svelte";

  export interface ChatMessage {
    id: number;
    time: string;
    type: "good" | "warning" | "info";
    text: string;
  }

  interface Props {
    messages: ChatMessage[];
  }

  let { messages }: Props = $props();

  let scrollEl: HTMLDivElement;

  $effect(() => {
    if (messages.length) {
      tick().then(() => {
        if (scrollEl) {
          scrollEl.scrollTop = scrollEl.scrollHeight;
        }
      });
    }
  });
</script>

<div class="chat-log" bind:this={scrollEl}>
  {#if messages.length === 0}
    <p class="empty">검사 결과가 여기에 표시됩니다.</p>
  {:else}
    {#each messages as msg (msg.id)}
      <div class="msg {msg.type}">
        <span class="time">{msg.time}</span>
        <span class="bubble">{msg.text}</span>
      </div>
    {/each}
  {/if}
</div>

<style>
  .chat-log {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 12px;
    border: 1px solid #1a1a1a;
    min-height: 0;
  }
  .empty {
    color: #333;
    text-align: center;
    margin: auto;
    font-size: 0.9rem;
  }
  .msg {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    animation: fadeIn 0.2s ease;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .time {
    font-size: 0.75rem;
    color: #333;
    min-width: 50px;
    padding-top: 0.25rem;
    flex-shrink: 0;
  }
  .bubble {
    font-size: 0.9rem;
    padding: 0.4rem 0.75rem;
    border-radius: 8px;
    line-height: 1.4;
  }
  .good .bubble {
    background: rgba(60, 220, 100, 0.08);
    color: #5cb870;
    border: 1px solid rgba(60, 220, 100, 0.15);
  }
  .warning .bubble {
    background: rgba(255, 60, 60, 0.08);
    color: #cc6666;
    border: 1px solid rgba(255, 60, 60, 0.15);
  }
  .info .bubble {
    background: rgba(255, 255, 255, 0.03);
    color: #555;
    border: 1px solid #1a1a1a;
  }
</style>
