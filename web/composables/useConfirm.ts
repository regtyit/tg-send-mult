import { ref } from 'vue';

export interface ConfirmField {
  key: string;
  label: string;
  value: string;
  type?: 'text' | 'textarea';
  required?: boolean;
}

export interface ConfirmRequest {
  id: number;
  title: string;
  message?: string;
  okText: string;
  cancelText: string;
  okColor: string;
  fields: ConfirmField[];
  resolve: (result: { ok: boolean; values: Record<string, string> }) => void;
}

const queue = ref<ConfirmRequest[]>([]);
let nextId = 1;

export interface ConfirmOptions {
  title: string;
  message?: string;
  okText?: string;
  cancelText?: string;
  okColor?: string;
  fields?: ConfirmField[];
}

export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<{ ok: boolean; values: Record<string, string> }> {
    return new Promise((resolve) => {
      queue.value.push({
        id: nextId++,
        title: options.title,
        message: options.message,
        okText: options.okText ?? 'Confirm',
        cancelText: options.cancelText ?? 'Cancel',
        okColor: options.okColor ?? 'primary',
        fields: (options.fields ?? []).map((f) => ({
          key: f.key,
          label: f.label,
          value: f.value ?? '',
          type: f.type ?? 'text',
          required: f.required ?? false,
        })),
        resolve,
      });
    });
  }

  /**
   * Convenience: ask the user to confirm a destructive action.
   * Returns true on confirm, false on cancel.
   */
  async function confirmDestructive(title: string, message?: string): Promise<boolean> {
    const r = await confirm({
      title,
      message,
      okText: 'Delete',
      cancelText: 'Cancel',
      okColor: 'error',
    });
    return r.ok;
  }

  return { confirm, confirmDestructive };
}

export function useConfirmQueue() {
  function resolveTop(ok: boolean, values: Record<string, string>): void {
    const top = queue.value[0];
    if (!top) return;
    queue.value = queue.value.slice(1);
    top.resolve({ ok, values });
  }
  return { queue, resolveTop };
}
