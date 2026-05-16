import { ref } from 'vue';

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
  timeout: number;
}

const toasts = ref<ToastMessage[]>([]);
let nextId = 1;

function push(kind: ToastKind, text: string, timeout = 4000): number {
  const id = nextId++;
  toasts.value.push({ id, kind, text, timeout });
  return id;
}

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function useToast() {
  return {
    toasts,
    success: (text: string, timeout?: number) => push('success', text, timeout ?? 3000),
    info: (text: string, timeout?: number) => push('info', text, timeout ?? 3500),
    warning: (text: string, timeout?: number) => push('warning', text, timeout ?? 5000),
    error: (text: string, timeout?: number) => push('error', text, timeout ?? 6000),
    dismiss,
  };
}

/**
 * Helper to extract a human-readable message from an unknown error value.
 * Pages already use this pattern repeatedly, so we centralise it here.
 */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
