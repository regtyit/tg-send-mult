<template>
  <v-app>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <v-snackbar
      v-for="t in toasts"
      :key="t.id"
      :model-value="true"
      :color="t.kind"
      :timeout="t.timeout"
      location="bottom right"
      multi-line
      role="status"
      aria-live="polite"
      @update:model-value="(v: boolean) => !v && dismiss(t.id)"
    >
      {{ t.text }}
      <template #actions>
        <v-btn variant="text" @click="dismiss(t.id)">Close</v-btn>
      </template>
    </v-snackbar>

    <v-dialog
      v-if="topConfirm"
      :model-value="true"
      max-width="520"
      persistent
      @keydown.esc="cancel"
    >
      <v-card>
        <v-card-title class="text-h6">{{ topConfirm.title }}</v-card-title>
        <v-card-text>
          <p v-if="topConfirm.message" class="mb-3">{{ topConfirm.message }}</p>
          <template v-for="f in topConfirm.fields" :key="f.key">
            <v-textarea
              v-if="f.type === 'textarea'"
              :model-value="values[f.key]"
              :label="f.label"
              variant="outlined"
              density="comfortable"
              class="mb-2"
              rows="3"
              @update:model-value="(v) => (values[f.key] = String(v ?? ''))"
            />
            <v-text-field
              v-else
              :model-value="values[f.key]"
              :label="f.label"
              variant="outlined"
              density="comfortable"
              class="mb-2"
              autofocus
              @update:model-value="(v) => (values[f.key] = String(v ?? ''))"
              @keydown.enter="ok"
            />
          </template>
        </v-card-text>
        <v-card-actions class="px-4 pb-4">
          <v-spacer />
          <v-btn variant="text" @click="cancel">{{ topConfirm.cancelText }}</v-btn>
          <v-btn :color="topConfirm.okColor" variant="flat" :disabled="!canSubmit" @click="ok">
            {{ topConfirm.okText }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';

const { toasts, dismiss } = useToast();
const { queue, resolveTop } = useConfirmQueue();

const topConfirm = computed(() => queue.value[0] ?? null);
const values = reactive<Record<string, string>>({});

watch(
  topConfirm,
  (req) => {
    Object.keys(values).forEach((k) => delete values[k]);
    if (req) {
      for (const f of req.fields) values[f.key] = f.value;
    }
  },
  { immediate: true },
);

const canSubmit = computed(() => {
  if (!topConfirm.value) return false;
  for (const f of topConfirm.value.fields) {
    if (f.required && !(values[f.key] ?? '').trim()) return false;
  }
  return true;
});

function ok(): void {
  if (!canSubmit.value) return;
  resolveTop(true, { ...values });
}

function cancel(): void {
  resolveTop(false, {});
}
</script>
