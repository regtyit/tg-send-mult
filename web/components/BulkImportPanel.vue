<template>
  <v-card class="mb-6 pa-4">
    <v-card-title class="text-subtitle-1 px-0 pt-0">{{ title }}</v-card-title>
    <p v-if="hint" class="text-caption text-medium-emphasis mb-3">{{ hint }}</p>
    <v-tabs v-model="tab" density="compact" class="mb-3">
      <v-tab value="csv">CSV</v-tab>
      <v-tab value="json">JSON</v-tab>
    </v-tabs>
    <v-tabs-window v-model="tab">
      <v-tabs-window-item value="csv">
        <v-file-input
          v-model="csvFile"
          label="Upload CSV file"
          variant="outlined"
          density="comfortable"
          accept=".csv,text/csv,text/plain"
          class="mb-2"
          @update:model-value="onCsvFile"
        />
        <v-textarea v-model="csvText" rows="6" variant="outlined" label="Or paste CSV" />
      </v-tabs-window-item>
      <v-tabs-window-item value="json">
        <v-textarea v-model="jsonText" rows="8" variant="outlined" label="JSON array" />
      </v-tabs-window-item>
    </v-tabs-window>
    <slot name="extra-fields" />
    <v-btn
      color="primary"
      class="mt-3"
      :loading="loading"
      :disabled="loading"
      @click="emitImport"
    >
      {{ buttonLabel }}
    </v-btn>
    <v-alert v-if="resultSummary" type="info" variant="tonal" class="mt-3" density="compact">
      {{ resultSummary }}
    </v-alert>
  </v-card>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title?: string;
    hint?: string;
    buttonLabel?: string;
    loading?: boolean;
    resultSummary?: string;
  }>(),
  {
    title: 'Bulk import',
    buttonLabel: 'Import',
    loading: false,
    resultSummary: '',
  },
);

const emit = defineEmits<{
  import: [payload: { csv?: string; json?: string }];
}>();

const tab = ref('csv');
const csvText = ref('');
const jsonText = ref('');
const csvFile = ref<File[]>([]);

async function onCsvFile(files: File | File[] | null): Promise<void> {
  const f = Array.isArray(files) ? files[0] : files;
  if (!f) return;
  csvText.value = await f.text();
}

function emitImport(): void {
  if (tab.value === 'json' && jsonText.value.trim()) {
    emit('import', { json: jsonText.value });
    return;
  }
  if (csvText.value.trim()) {
    emit('import', { csv: csvText.value });
  }
}
</script>
