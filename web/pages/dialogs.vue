<template>
  <div>
    <h1 class="text-h4 font-weight-bold mb-2">Dialog simulation</h1>
    <p class="text-body-2 text-medium-emphasis mb-2">
      Simulate a natural back-and-forth chat between two senders (or a sender and a contact). Incoming
      messages can be marked read in Telegram (blue checks).
    </p>
    <v-alert type="info" variant="tonal" density="compact" class="mb-4">
      <strong>Quick start:</strong>
      (1) Pick a template or create a script —
      (2) Create a session and pick Sender A + peer —
      (3) Press <strong>Start</strong> or <strong>Step</strong> on the session.
    </v-alert>

    <v-card class="mb-6 pa-4" variant="outlined">
      <v-card-title class="text-subtitle-1 px-0 pt-0">Human dialog templates</v-card-title>
      <p class="text-caption text-medium-emphasis mb-3">
        Ready-made casual scripts (EN + RU). Add to your library, then select in step 2 or the builder.
      </p>
      <v-row dense>
        <v-col
          v-for="p in dialogPresets"
          :key="p.slug"
          cols="12"
          md="6"
        >
          <v-card variant="tonal" class="pa-3 h-100">
            <div class="text-subtitle-2 font-weight-medium mb-1">{{ p.name }}</div>
            <div class="text-caption text-medium-emphasis mb-2">{{ p.description }}</div>
            <div class="text-caption mb-2">
              {{ p.turnCount }} lines · «{{ p.preview }}»
            </div>
            <v-btn
              size="small"
              color="primary"
              variant="tonal"
              :loading="applyingPresetSlug === p.slug"
              @click="applyPreset(p.slug)"
            >
              Add to library
            </v-btn>
          </v-card>
        </v-col>
      </v-row>
      <v-btn
        class="mt-3"
        size="small"
        variant="outlined"
        :loading="applyingAllPresets"
        @click="applyAllPresets"
      >
        Add all templates
      </v-btn>
    </v-card>

    <v-row>
      <v-col cols="12" lg="6">
        <DialogScriptBuilder
          ref="scriptBuilderRef"
          :templates="templates"
          :saving="creatingScript"
          @save="onSaveScript"
        >
          <template #import>
            <BulkImportPanel
              title="Import from file"
              hint="CSV: side, text or templateId, optional waitForText, delaySecMin/Max"
              button-label="Import as new script"
              :loading="importingScript"
              :result-summary="scriptImportSummary"
              @import="importScript"
            />
          </template>
        </DialogScriptBuilder>

        <v-card class="mb-6 pa-4 mt-4" variant="outlined">
          <v-card-title class="text-subtitle-1 px-0 pt-0">Saved scripts</v-card-title>
          <v-data-table
            :headers="scriptHeaders"
            :items="scriptsDisplay"
            :class="DATA_TABLE_CLASS"
            density="compact"
          >
            <template #[`item.summary`]="{ item }">
              <span class="text-caption cell-overflow" :title="item.summary">{{ item.summary }}</span>
            </template>
            <template #[`item.actions`]="{ item }">
              <v-btn size="small" variant="text" @click="scriptId = item._id">Use</v-btn>
              <v-btn size="small" variant="text" color="error" @click="deleteScript(item._id)">Delete</v-btn>
            </template>
          </v-data-table>
        </v-card>

        <v-card class="mb-6 pa-4" variant="outlined">
          <v-card-title class="text-subtitle-1 px-0 pt-0">2. Start a session</v-card-title>
          <p class="text-caption text-medium-emphasis mb-3">
            Connect a saved script to two participants. Sender A always speaks first in the script.
          </p>
          <v-row dense>
            <v-col cols="12">
              <v-text-field v-model="sessionName" label="Session name" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="accountAId"
                :items="senderItems"
                item-title="pickerLabel"
                item-value="_id"
                label="Sender A"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select v-model="peerType" :items="peerTypeItems" label="Peer type" variant="outlined" density="comfortable" />
            </v-col>
            <v-col v-if="peerType === 'account'" cols="12" md="6">
              <v-select
                v-model="peerAccountId"
                :items="senderItems"
                item-title="pickerLabel"
                item-value="_id"
                label="Sender B (peer)"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col v-else cols="12" md="6">
              <v-select
                v-model="peerContactId"
                :items="contactItems"
                item-title="title"
                item-value="_id"
                label="Trusted contact"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12">
              <v-select
                v-model="scriptId"
                :items="scriptsForSelect"
                item-title="pickerLabel"
                item-value="_id"
                label="Dialog script"
                variant="outlined"
                density="comfortable"
                :hint="scripts.length ? 'Pick a script from step 1' : 'Create a script first'"
                persistent-hint
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select v-model="runMode" :items="runModeItems" label="Run mode" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12">
              <v-btn color="primary" :loading="creatingSession" @click="createSession">Create session</v-btn>
            </v-col>
          </v-row>
        </v-card>
      </v-col>

      <v-col cols="12" lg="6">
        <v-card class="mb-6 pa-4">
          <v-card-title class="text-subtitle-1 px-0 pt-0">Sessions</v-card-title>
          <v-data-table
            :headers="sessionHeaders"
            :items="sessionsDisplay"
            :class="DATA_TABLE_CLASS"
            density="compact"
            item-value="_id"
            @click:row="(_e: unknown, ctx: { item: DialogSession }) => selectSession(ctx.item._id)"
          >
            <template #[`item.participants`]="{ item }">
              <span class="text-caption cell-overflow" :title="item.participants">{{ item.participants }}</span>
            </template>
            <template #[`item.status`]="{ item }">
              <v-chip size="small" :color="statusColor(item.status)">{{ item.status }}</v-chip>
            </template>
            <template #[`item.actions`]="{ item }">
              <v-btn size="small" variant="text" @click.stop="startSession(item._id)">Start</v-btn>
              <v-btn size="small" variant="text" @click.stop="stepSession(item._id)">Step</v-btn>
              <v-btn size="small" variant="text" @click.stop="pauseSession(item._id)">Pause</v-btn>
            </template>
          </v-data-table>
        </v-card>

        <v-card v-if="selectedSessionId" class="pa-4">
          <v-card-title class="text-subtitle-1 px-0 pt-0 d-flex align-center">
            Transcript
            <v-spacer />
            <v-btn size="small" variant="text" :loading="loadingTranscript" @click="loadTranscript">Refresh</v-btn>
          </v-card-title>
          <div v-if="transcriptLines.length === 0" class="text-medium-emphasis text-caption">No messages yet.</div>
          <v-list v-else density="compact" class="transcript-list">
            <v-list-item v-for="(line, i) in transcriptLines" :key="i">
              <template #prepend>
                <v-chip size="x-small" :color="line.direction === 'incoming' ? 'info' : 'primary'">
                  {{ line.direction }}
                </v-chip>
              </template>
              <v-list-item-title>{{ line.text }}</v-list-item-title>
              <v-list-item-subtitle>
                {{ line.meta }}
                <v-chip v-if="line.read" size="x-small" color="success" class="ml-1">read</v-chip>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { accountPickerLabel } from '~/utils/accountLabel';
import { DATA_TABLE_CLASS } from '~/utils/tableColumns';

interface DialogPresetSummary {
  slug: string;
  name: string;
  description: string;
  turnCount: number;
  preview: string;
}

interface DialogScript {
  _id: string;
  name: string;
  mode: string;
  turns?: Array<{ side: string; text: string }>;
  rounds?: number;
  questionTemplateId?: string;
  answerTemplateId?: string;
}

interface DialogSession {
  _id: string;
  name: string;
  status: string;
  runMode: string;
  currentTurn: number;
  accountAId?: string;
  peerType?: string;
  peerAccountId?: string;
  peerContactId?: string;
  participants?: string;
}

interface TranscriptLine {
  direction: string;
  text: string;
  meta: string;
  read: boolean;
}

const { apiFetch } = useBasicAuth();
const toast = useToast();

const scripts = ref<DialogScript[]>([]);
const dialogPresets = ref<DialogPresetSummary[]>([]);
const applyingPresetSlug = ref('');
const applyingAllPresets = ref(false);
const sessions = ref<DialogSession[]>([]);
const templates = ref<Array<{ _id: string; name: string }>>([]);
const accounts = ref<
  Array<{ _id: string; label: string; phone: string; role: string; telegramUsername?: string; status?: string }>
>([]);
const contacts = ref<Array<{ _id: string; phoneE164?: string; username?: string; tags?: string[] }>>([]);

const scriptBuilderRef = ref<{ resetForm: () => void; getName: () => string } | null>(null);
const importingScript = ref(false);
const scriptImportSummary = ref('');
const creatingScript = ref(false);

const sessionName = ref('');
const accountAId = ref('');
const peerType = ref<'account' | 'contact'>('account');
const peerAccountId = ref('');
const peerContactId = ref('');
const scriptId = ref('');
const runMode = ref<'auto' | 'manual'>('manual');
const creatingSession = ref(false);

const selectedSessionId = ref('');
const loadingTranscript = ref(false);
const transcriptLines = ref<TranscriptLine[]>([]);

const scriptHeaders = [
  { title: 'Name', key: 'name' },
  { title: 'What it does', key: 'summary' },
  { title: '', key: 'actions', sortable: false },
];

function scriptSummary(s: DialogScript): string {
  if (s.mode === 'template_pairs') {
    const q = templates.value.find((t) => t._id === String(s.questionTemplateId ?? ''))?.name ?? '?';
    const a = templates.value.find((t) => t._id === String(s.answerTemplateId ?? ''))?.name ?? '?';
    const r = s.rounds ?? 1;
    return `${r} round(s): question «${q}» → answer «${a}»`;
  }
  const lines = s.turns ?? [];
  if (!lines.length) return 'No lines yet';
  const bits = lines
    .slice(0, 3)
    .map((t) => `${t.side === 'a' ? 'A' : 'B'}: ${t.text.slice(0, 40)}${t.text.length > 40 ? '…' : ''}`);
  return `${lines.length} line(s) — ${bits.join(' · ')}`;
}

const scriptsDisplay = computed(() =>
  scripts.value.map((s) => ({ ...s, summary: scriptSummary(s) })),
);

const scriptsForSelect = computed(() =>
  scriptsDisplay.value.map((s) => ({
    _id: s._id,
    pickerLabel: `${s.name} — ${s.summary}`,
  })),
);
const sessionHeaders = [
  { title: 'Name', key: 'name' },
  { title: 'Participants', key: 'participants' },
  { title: 'Status', key: 'status' },
  { title: 'Mode', key: 'runMode' },
  { title: 'Turn', key: 'currentTurn' },
  { title: '', key: 'actions', sortable: false },
];

const peerTypeItems = [
  { title: 'Another sender', value: 'account' },
  { title: 'Contact (trusted)', value: 'contact' },
];
const runModeItems = [
  { title: 'Manual step', value: 'manual' },
  { title: 'Automatic', value: 'auto' },
];

const senderItems = computed(() =>
  accounts.value
    .filter((a) => a.role === 'sender')
    .map((a) => ({
      _id: a._id,
      pickerLabel: accountPickerLabel(a),
    })),
);

function sessionParticipants(s: DialogSession): string {
  const a = accounts.value.find((x) => x._id === String(s.accountAId ?? ''));
  const aLabel = a ? accountPickerLabel(a) : String(s.accountAId ?? '?');
  if (s.peerType === 'account') {
    const b = accounts.value.find((x) => x._id === String(s.peerAccountId ?? ''));
    const bLabel = b ? accountPickerLabel(b) : String(s.peerAccountId ?? '?');
    return `${aLabel} ↔ ${bLabel}`;
  }
  const c = contacts.value.find((x) => x._id === String(s.peerContactId ?? ''));
  const cLabel = c?.username ? `@${c.username}` : c?.phoneE164 || String(s.peerContactId ?? '?');
  return `${aLabel} → ${cLabel}`;
}

const sessionsDisplay = computed(() =>
  sessions.value.map((s) => ({
    ...s,
    participants: sessionParticipants(s),
  })),
);
const contactItems = computed(() =>
  contacts.value.map((c) => ({
    _id: c._id,
    title: c.username ? `@${c.username}` : c.phoneE164 || c._id,
  })),
);
const templateItems = computed(() => templates.value);

function statusColor(status: string): string {
  if (status === 'running') return 'success';
  if (status === 'waiting_peer') return 'warning';
  if (status === 'failed') return 'error';
  if (status === 'completed') return 'primary';
  return 'default';
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function loadPresets(): Promise<void> {
  try {
    const data = await apiFetch<{ presets: DialogPresetSummary[] }>('/api/dialog-scripts/presets');
    dialogPresets.value = data.presets ?? [];
  } catch (e) {
    toast.error(errorText(e));
  }
}

async function applyPreset(slug: string): Promise<void> {
  applyingPresetSlug.value = slug;
  try {
    const data = await apiFetch<{ id: string; created: boolean; script: DialogScript }>(
      '/api/dialog-scripts/presets/apply',
      { method: 'POST', body: JSON.stringify({ slug }) },
    );
    scriptId.value = data.id;
    toast.success(data.created ? 'Template added.' : 'Already in library — selected.');
    await loadAll();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    applyingPresetSlug.value = '';
  }
}

async function applyAllPresets(): Promise<void> {
  applyingAllPresets.value = true;
  try {
    await apiFetch('/api/dialog-scripts/presets/apply-all', {
      method: 'POST',
      body: JSON.stringify({ replace: false }),
    });
    toast.success('All templates added (existing names skipped).');
    await loadAll();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    applyingAllPresets.value = false;
  }
}

async function loadAll(): Promise<void> {
  const [s, sess, t, a, c] = await Promise.all([
    apiFetch<DialogScript[]>('/api/dialog-scripts'),
    apiFetch<DialogSession[]>('/api/dialog-sessions'),
    apiFetch<Array<{ _id: string; name: string; body?: string }>>('/api/templates'),
    apiFetch<
      Array<{
        _id: string;
        label: string;
        phone: string;
        role: string;
        telegramUsername?: string;
        status?: string;
      }>
    >('/api/accounts'),
    apiFetch<{ items: typeof contacts.value }>('/api/contacts?limit=500&paginated=true'),
  ]);
  scripts.value = s;
  sessions.value = sess;
  templates.value = t;
  accounts.value = a;
  contacts.value = c.items ?? [];
}

async function importScript(payload: { csv?: string; json?: string }): Promise<void> {
  const scriptName = scriptBuilderRef.value?.getName?.()?.trim() ?? '';
  if (!scriptName) {
    toast.warning('Enter a script name in the form above before importing.');
    return;
  }
  importingScript.value = true;
  scriptImportSummary.value = '';
  try {
    await apiFetch('/api/dialog-scripts/import', {
      method: 'POST',
      body: JSON.stringify({ name: scriptName, ...payload }),
    });
    scriptImportSummary.value = 'Script imported.';
    scriptBuilderRef.value?.resetForm();
    await loadAll();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    importingScript.value = false;
  }
}

async function onSaveScript(payload: {
  name: string;
  mode: 'turns' | 'template_pairs';
  turns?: Array<{
    side: 'a' | 'b';
    text?: string;
    templateId?: string;
    waitForText?: string;
    delaySecMin: number;
    delaySecMax: number;
  }>;
  questionTemplateId?: string;
  answerTemplateId?: string;
  peerWaitText?: string;
  rounds?: number;
  typingSec: number;
  defaultDelaySecMin: number;
  defaultDelaySecMax: number;
}): Promise<void> {
  creatingScript.value = true;
  try {
    const doc = await apiFetch<{ _id: string }>('/api/dialog-scripts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    toast.success(`Script «${payload.name}» saved.`);
    scriptBuilderRef.value?.resetForm();
    scriptId.value = doc._id;
    await loadAll();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    creatingScript.value = false;
  }
}

async function deleteScript(id: string): Promise<void> {
  try {
    await apiFetch(`/api/dialog-scripts/${id}`, { method: 'DELETE' });
    await loadAll();
  } catch (e) {
    toast.error(errorText(e));
  }
}

async function createSession(): Promise<void> {
  creatingSession.value = true;
  try {
    await apiFetch('/api/dialog-sessions', {
      method: 'POST',
      body: JSON.stringify({
        name: sessionName.value,
        scriptId: scriptId.value,
        accountAId: accountAId.value,
        peerType: peerType.value,
        peerAccountId: peerType.value === 'account' ? peerAccountId.value : undefined,
        peerContactId: peerType.value === 'contact' ? peerContactId.value : undefined,
        runMode: runMode.value,
      }),
    });
    toast.success('Session created.');
    await loadAll();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    creatingSession.value = false;
  }
}

async function startSession(id: string): Promise<void> {
  try {
    await apiFetch(`/api/dialog-sessions/${id}/start`, { method: 'POST' });
    toast.success('Session started.');
    selectSession(id);
    await loadAll();
  } catch (e) {
    toast.error(errorText(e));
  }
}

async function stepSession(id: string): Promise<void> {
  try {
    await apiFetch(`/api/dialog-sessions/${id}/step`, { method: 'POST' });
    selectSession(id);
    await loadTranscript();
    await loadAll();
  } catch (e) {
    toast.error(errorText(e));
  }
}

async function pauseSession(id: string): Promise<void> {
  try {
    await apiFetch(`/api/dialog-sessions/${id}/pause`, { method: 'POST' });
    await loadAll();
  } catch (e) {
    toast.error(errorText(e));
  }
}

function selectSession(id: string): void {
  selectedSessionId.value = id;
  loadTranscript();
}

async function loadTranscript(): Promise<void> {
  if (!selectedSessionId.value) return;
  loadingTranscript.value = true;
  try {
    const data = await apiFetch<{
      turns: Array<{ side: string; text: string; sentAt?: string; readAt?: string }>;
      inbound: Array<{ direction: string; text: string; readAt?: string; telegramDate?: string }>;
    }>(`/api/dialog-sessions/${selectedSessionId.value}/transcript`);
    const lines: TranscriptLine[] = [];
    for (const t of data.turns ?? []) {
      lines.push({
        direction: t.side === 'sync' ? 'sync' : 'outgoing',
        text: t.text || `(turn ${t.side})`,
        meta: t.sentAt ? new Date(t.sentAt).toLocaleString() : '',
        read: Boolean(t.readAt),
      });
    }
    for (const m of data.inbound ?? []) {
      lines.push({
        direction: m.direction,
        text: m.text,
        meta: m.telegramDate ? new Date(m.telegramDate).toLocaleString() : '',
        read: Boolean(m.readAt),
      });
    }
    transcriptLines.value = lines;
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    loadingTranscript.value = false;
  }
}

const { start: startPoll, stop: stopPoll } = usePolling(async () => {
  await loadAll();
  if (selectedSessionId.value) await loadTranscript();
}, 5000);

onMounted(async () => {
  await Promise.all([loadPresets(), loadAll()]);
  startPoll();
});
onUnmounted(() => stopPoll());
</script>

<style scoped>
.transcript-list {
  max-height: 480px;
  overflow-y: auto;
}
</style>
