import { onBeforeUnmount, onMounted, ref } from 'vue';

export interface UsePollingOptions {
  intervalMs: number;
  immediate?: boolean;
  pauseOnHidden?: boolean;
}

export function usePolling(fn: () => void | Promise<void>, options: UsePollingOptions) {
  const { intervalMs, immediate = true, pauseOnHidden = true } = options;
  const running = ref(false);
  const lastError = ref<unknown>(null);
  const lastRunAt = ref<number | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;
  let isVisible = true;

  async function tick() {
    if (running.value) return;
    if (pauseOnHidden && !isVisible) return;
    running.value = true;
    try {
      await fn();
      lastError.value = null;
      lastRunAt.value = Date.now();
    } catch (e) {
      lastError.value = e;
    } finally {
      running.value = false;
    }
  }

  function start() {
    stop();
    timer = setInterval(tick, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function onVisibilityChange() {
    if (typeof document === 'undefined') return;
    isVisible = !document.hidden;
    if (isVisible) {
      tick();
    }
  }

  onMounted(() => {
    if (typeof document !== 'undefined') {
      isVisible = !document.hidden;
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    if (immediate) tick();
    start();
  });

  onBeforeUnmount(() => {
    stop();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  });

  return { running, lastError, lastRunAt, refresh: tick, start, stop };
}
