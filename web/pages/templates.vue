<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4 font-weight-bold">Templates</h1>
      <v-spacer />
      <v-btn variant="text" :loading="loading" :disabled="loading" prepend-icon="mdi-refresh" @click="load">
        Refresh
      </v-btn>
    </div>
    <v-row>
      <v-col cols="12" md="6">
        <v-card class="pa-4">
          <v-card-title class="text-subtitle-1 px-0 pt-0">New template</v-card-title>
          <v-text-field
            v-model="name"
            label="Unique name"
            variant="outlined"
            class="mb-2"
            :disabled="saving"
          />
          <v-textarea
            v-model="body"
            rows="8"
            variant="outlined"
            class="mb-2"
            label="Template body"
            :disabled="saving"
          />
          <div class="d-flex align-center gap-4 mb-2">
            <v-chip
              :color="bodyLength > TELEGRAM_MESSAGE_MAX_CHARS ? 'error' : 'success'"
              size="small"
              variant="flat"
              :aria-label="`Character count: ${bodyLength} of ${TELEGRAM_MESSAGE_MAX_CHARS}`"
            >
              {{ bodyLength }} / {{ TELEGRAM_MESSAGE_MAX_CHARS }} chars
            </v-chip>
            <span v-if="bodyLength > TELEGRAM_MESSAGE_MAX_CHARS" class="text-error text-caption">
              Exceeds Telegram single-message limit; campaign sends will fail for this template.
            </span>
            <span class="text-caption text-medium-emphasis d-block">
              After placeholders expand, the rendered text must also stay within the limit (server checks per contact).
            </span>
          </div>
          <v-btn color="primary" :loading="saving" :disabled="saving || !canSave" @click="create">Save</v-btn>
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card class="pa-4">
          <v-card-title class="text-subtitle-1 px-0 pt-0">
            Spintax preview (sample name = Alex)
          </v-card-title>
          <v-sheet border rounded class="pa-4 text-body-2" min-height="120">
            {{ preview }}
          </v-sheet>
          <p class="text-caption text-medium-emphasis mt-2">Preview updates as you edit.</p>
        </v-card>
      </v-col>
    </v-row>

    <v-progress-circular v-if="loading && rows.length === 0" indeterminate class="mt-6" />
    <v-alert
      v-else-if="loadErr"
      type="error"
      variant="tonal"
      class="mt-6"
      density="compact"
      role="alert"
      aria-live="polite"
    >
      Failed to load templates: {{ loadErr }}
    </v-alert>
    <v-list v-else-if="rows.length" class="mt-6 rounded border" lines="three">
      <v-list-item v-for="t in rows" :key="t._id">
        <v-list-item-title class="text-primary">{{ t.name }}</v-list-item-title>
        <v-list-item-subtitle class="text-wrap">{{ t.body }}</v-list-item-subtitle>
      </v-list-item>
    </v-list>
    <v-alert v-else type="info" variant="tonal" class="mt-6" density="compact">
      No templates yet. Save your first one above.
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import { previewTemplate } from '~/utils/spintax';
import { TELEGRAM_MESSAGE_MAX_CHARS } from '~/utils/telegramLimits';
import { errorText } from '~/composables/useToast';

interface Template {
  _id: string;
  name: string;
  body: string;
}

const { apiFetch } = useBasicAuth();
const toast = useToast();
const rows = ref<Template[]>([]);
const name = ref('');
const body = ref('');
const preview = ref('');
const saving = ref(false);
const loading = ref(true);
const loadErr = ref('');

const bodyLength = computed(() => body.value.length);
const canSave = computed(
  () => name.value.trim().length > 0 && body.value.length > 0 && bodyLength.value <= TELEGRAM_MESSAGE_MAX_CHARS,
);

watchEffect(() => {
  preview.value = previewTemplate(body.value, { name: 'Alex' });
});

async function load(): Promise<void> {
  loading.value = true;
  loadErr.value = '';
  try {
    rows.value = await apiFetch<Template[]>('/api/templates');
  } catch (e) {
    loadErr.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

async function create(): Promise<void> {
  if (!name.value.trim()) {
    toast.warning('Pick a unique template name.');
    return;
  }
  if (bodyLength.value > TELEGRAM_MESSAGE_MAX_CHARS) {
    toast.error(`Body exceeds ${TELEGRAM_MESSAGE_MAX_CHARS} chars.`);
    return;
  }
  saving.value = true;
  try {
    await apiFetch('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: name.value, body: body.value }),
    });
    toast.success(`Template "${name.value}" saved.`);
    name.value = '';
    body.value = '';
    await load();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  load();
});
</script>
