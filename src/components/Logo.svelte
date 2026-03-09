<script lang="ts">
  interface Props {
    size?: number;
  }

  let { size = 32 }: Props = $props();
</script>

<svg width={size} height={size} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M40 85C40 85 70 55 100 55C130 55 160 85 160 85" stroke="currentColor" stroke-width="12" stroke-linecap="round"/>
  <circle cx="100" cy="95" r="8" fill="currentColor"/>
  <circle cx="65" cy="135" r="8" fill="currentColor"/>
  <circle cx="135" cy="135" r="8" fill="currentColor"/>
  <path d="M100 95V165" stroke="currentColor" stroke-width="4" stroke-dasharray="8 8" stroke-opacity="0.4"/>
  <path d="M65 135H135" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-opacity="0.2"/>
</svg>
