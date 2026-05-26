<template>
  <div>
    <h1 class="text-h4 font-weight-bold mb-2">Dialog simulation</h1>
    <p class="text-body-2 text-medium-emphasis mb-2">
      Simulate a natural back-and-forth chat between two senders (or a sender and a contact). Incoming
      messages can be marked read in Telegram (blue checks).
    </p>
    <v-alert type="info" variant="tonal" density="compact" class="mb-4">
      <div class="text-subtitle-2 font-weight-bold mb-2">How to use a preset (ready-made chat)</div>
      <ol class="text-body-2 pl-4 mb-2">
        <li class="mb-1">
          In <strong>Human dialog templates</strong>, open <strong>Choose template</strong> and pick one
          (e.g. «casual coffee»). You will see the full conversation preview.
        </li>
        <li class="mb-1">
          Click <strong>Use in new session</strong> (fastest) — or <strong>Add to library</strong> if you want it
          in «Saved scripts» first.
        </li>
        <li class="mb-1">
          Scroll to <strong>2. Start a session</strong>: choose <strong>Sender A</strong> and
          <strong>Sender B</strong> (two Telegram accounts). In
          <strong>Dialog script or template</strong> the same preset should already be selected.
        </li>
        <li class="mb-1">
          <strong>Create session</strong>, then in the table on the right press <strong>Start</strong>
          (automatic) or <strong>Step</strong> (one message at a time).
        </li>
      </ol>
      <div class="text-caption">
        <strong>A</strong> = first sender you pick · <strong>B</strong> = second sender (or contact).
        Presets are only the <em>text and timing</em>; real messages go through your senders in Telegram.
        Need <code>dev:worker</code> + <code>dev:scheduler</code> running for auto mode.
        <br />
        <strong>Timing:</strong> line 1 on <strong>Start</strong>; line 2, 3, … after each line’s pause
        (see template preview). With «wait for reply», polls run at 5s → 30s → 60s → 180s until the peer
        sends that text. Warming accounts: at most <strong>one</strong> new script per calendar day for
        {{ warmupDays }} days.
      </div>
    </v-alert>

    <v-card class="mb-6 pa-4" variant="outlined">
      <v-card-title class="text-subtitle-1 px-0 pt-0">Human dialog templates</v-card-title>
      <p class="text-caption text-medium-emphasis mb-2">
        {{ dialogPresets.length }} ready-made scripts (EN + RU). Choose one to preview, load in the builder, or use in a session.
      </p>
      <v-autocomplete
        v-model="selectedPresetSlug"
        :items="filteredDialogPresets"
        item-title="name"
        item-value="slug"
        label="Choose template"
        placeholder="Search by name…"
        variant="outlined"
        density="comfortable"
        clearable
        class="mb-3"
        :loading="loadingPresetDetail"
        @update:model-value="onPresetSlugChange"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps" :subtitle="item.raw.description">
            <template #append>
              <v-chip size="x-small" variant="outlined">{{ item.raw.lang.toUpperCase() }}</v-chip>
            </template>
          </v-list-item>
        </template>
      </v-autocomplete>
      <v-chip-group v-model="presetFilter" class="mb-3" mandatory>
        <v-chip value="all" size="small" filter>All</v-chip>
        <v-chip value="en" size="small" filter>English</v-chip>
        <v-chip value="ru" size="small" filter>Russian</v-chip>
        <v-chip value="social" size="small" filter>Social</v-chip>
        <v-chip value="work" size="small" filter>Work</v-chip>
        <v-chip value="support" size="small" filter>Support</v-chip>
        <v-chip value="logistics" size="small" filter>Logistics</v-chip>
      </v-chip-group>
      <v-card v-if="selectedPresetDetail" variant="tonal" class="pa-3 mb-3">
        <div class="text-subtitle-2 mb-1">{{ selectedPresetDetail.name }}</div>
        <div class="text-caption text-medium-emphasis mb-2">{{ selectedPresetDetail.description }}</div>
        <v-list density="compact" class="preset-preview-list bg-transparent">
          <v-list-item v-for="(row, i) in presetScheduleRows" :key="i">
            <template #prepend>
              <v-chip size="x-small" variant="outlined" class="mr-1">{{ row.line }}</v-chip>
              <v-chip size="x-small" :color="selectedPresetDetail!.turns[i]!.side === 'a' ? 'primary' : 'secondary'">
                {{ selectedPresetDetail!.turns[i]!.side === 'a' ? 'A' : 'B' }}
              </v-chip>
            </template>
            <v-list-item-title class="text-body-2">{{ selectedPresetDetail!.turns[i]!.text }}</v-list-item-title>
            <v-list-item-subtitle class="text-primary">
              {{ row.when }}
            </v-list-item-subtitle>
            <v-list-item-subtitle v-if="row.pauseBefore" class="text-caption">
              Pause before this line: {{ row.pauseBefore }}
              <span v-if="row.waitForText"> · wait for «{{ row.waitForText }}»</span>
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>
        <div class="d-flex flex-wrap gap-2 mt-2">
          <v-btn size="small" variant="tonal" @click="loadPresetInBuilder">Load in builder</v-btn>
          <v-btn
            size="small"
            color="primary"
            :loading="applyingPresetSlug === selectedPresetSlug"
            @click="applyPreset(selectedPresetSlug!)"
          >
            Add to library
          </v-btn>
          <v-btn size="small" variant="outlined" @click="usePresetForSession">Use in new session</v-btn>
        </div>
      </v-card>
      <v-btn
        size="small"
        variant="outlined"
        :loading="applyingAllPresets"
        @click="applyAllPresets"
      >
        Add all templates to library
      </v-btn>
    </v-card>

    <v-row>
      <v-col cols="12" lg="6">
        <DialogScriptBuilder
          ref="scriptBuilderRef"
          :templates="templates"
          :human-presets="dialogPresets"
          :loading-human-preset="loadingPresetDetail"
          :saving="creatingScript"
          @load-preset="onBuilderLoadPreset"
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
              <v-btn size="small" variant="text" @click="scriptSource = `script:${item._id}`">Use</v-btn>
              <v-btn size="small" variant="text" color="error" @click="deleteScript(item._id)">Delete</v-btn>
            </template>
          </v-data-table>
        </v-card>

        <v-card class="mb-6 pa-4" variant="outlined">
          <v-card-title class="text-subtitle-1 px-0 pt-0">Start a session (run the chat)</v-card-title>
          <p class="text-caption text-medium-emphasis mb-3">
            Pick <strong>who</strong> plays the conversation and <strong>which script</strong> (preset or saved).
            You do not need to save a script first if you select a built-in template here.
          </p>
          <v-alert
            v-if="!scriptSource"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            Choose <strong>Dialog script or template</strong> below — or use «Use in new session» on a preset above.
          </v-alert>
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
                v-model="scriptSource"
                :items="scriptSourceItems"
                item-title="title"
                item-value="value"
                label="Dialog script or template"
                variant="outlined"
                density="comfortable"
                hint="Built-in templates are saved to your library when you create the session"
                persistent-hint
              >
                <template #item="{ props: itemProps, item }">
                  <v-list-item
                    v-bind="itemProps"
                    :disabled="item.raw.disabled"
                    :subtitle="item.raw.subtitle"
                  />
                </template>
              </v-select>
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
import { buildDialogTurnSchedule, formatNextRunAt } from '~/utils/dialogSchedule';
import { DATA_TABLE_CLASS } from '~/utils/tableColumns';

interface DialogPresetSummary {
  slug: string;
  name: string;
  description: string;
  lang: 'en' | 'ru';
  category: string;
  turnCount: number;
  preview: string;
}

interface DialogPresetDetail extends DialogPresetSummary {
  defaultDelaySecMin: number;
  defaultDelaySecMax: number;
  typingSec: number;
  turns: Array<{
    side: 'a' | 'b';
    text: string;
    waitForText: string;
    delaySecMin: number;
    delaySecMax: number;
  }>;
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
  nextRunAt?: string | null;
  accountAId?: string;
  peerType?: string;
  peerAccountId?: string;
  peerContactId?: string;
  participants?: string;
  nextStep?: string;
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
const presetFilter = ref('all');
const selectedPresetSlug = ref<string | null>(null);
const selectedPresetDetail = ref<DialogPresetDetail | null>(null);
const loadingPresetDetail = ref(false);
const scriptSource = ref('');
const applyingPresetSlug = ref('');
const applyingAllPresets = ref(false);
const sessions = ref<DialogSession[]>([]);
const templates = ref<Array<{ _id: string; name: string }>>([]);
const accounts = ref<
  Array<{ _id: string; label: string; phone: string; role: string; telegramUsername?: string; status?: string }>
>([]);
const contacts = ref<Array<{ _id: string; phoneE164?: string; username?: string; tags?: string[] }>>([]);

const scriptBuilderRef = ref<{
  resetForm: () => void;
  getName: () => string;
  loadFromPreset: (detail: DialogPresetDetail) => void;
  setBuilderPresetSlug: (slug: string | null) => void;
} | null>(null);
const importingScript = ref(false);
const scriptImportSummary = ref('');
const creatingScript = ref(false);

const sessionName = ref('');
const accountAId = ref('');
const peerType = ref<'account' | 'contact'>('account');
const peerAccountId = ref('');
const peerContactId = ref('');
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

const filteredDialogPresets = computed(() => {
  const f = presetFilter.value;
  if (f === 'all') return dialogPresets.value;
  if (f === 'en' || f === 'ru') return dialogPresets.value.filter((p) => p.lang === f);
  return dialogPresets.value.filter((p) => p.category === f);
});

const scriptsForSelect = computed(() =>
  scriptsDisplay.value.map((s) => ({
    _id: s._id,
    pickerLabel: `${s.name} — ${s.summary}`,
  })),
);

const scriptSourceItems = computed(() => {
  const items: Array<{
    title: string;
    value: string;
    disabled?: boolean;
    subtitle?: string;
  }> = [
    { title: '— Built-in templates —', value: '__header_templates__', disabled: true },
    ...filteredDialogPresets.value.map((p) => ({
      title: p.name,
      value: `preset:${p.slug}`,
      subtitle: `${p.lang.toUpperCase()} · ${p.category} · ${p.turnCount} lines`,
    })),
    { title: '— Saved scripts —', value: '__header_scripts__', disabled: true },
    ...scriptsForSelect.value.map((s) => ({
      title: s.pickerLabel,
      value: `script:${s._id}`,
      subtitle: 'Your library',
    })),
  ];
  return items;
});
const sessionHeaders = [
  { title: 'Name', key: 'name' },
  { title: 'Participants', key: 'participants' },
  { title: 'Status', key: 'status' },
  { title: 'Mode', key: 'runMode' },
  { title: 'Turn', key: 'currentTurn' },
  { title: 'Next step', key: 'nextStep' },
  { title: '', key: 'actions', sortable: false },
];

/** Matches server default `WARMUP_DAYS` — shown in UI hint only. */
const warmupDays = 3;

const presetScheduleRows = computed(() => {
  const turns = selectedPresetDetail.value?.turns;
  if (!turns?.length) return [];
  return buildDialogTurnSchedule(turns);
});

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

function sessionNextStep(s: DialogSession): string {
  if (s.runMode !== 'auto') {
    return s.status === 'running' || s.status === 'waiting_peer' ? 'Manual Step' : '—';
  }
  if (s.status === 'completed' || s.status === 'failed' || s.status === 'paused' || s.status === 'draft') {
    return '—';
  }
  if (s.status === 'waiting_peer') {
    const when = formatNextRunAt(s.nextRunAt ?? null);
    return when === '—' ? 'Waiting for peer' : `Peer check ${when}`;
  }
  if (s.status === 'running') {
    const line = (s.currentTurn ?? 0) + 1;
    const when = formatNextRunAt(s.nextRunAt ?? null);
    return when === 'now' || when === '—' ? `Line ${line} due` : `Line ${line} ${when}`;
  }
  return '—';
}

const sessionsDisplay = computed(() =>
  sessions.value.map((s) => ({
    ...s,
    participants: sessionParticipants(s),
    nextStep: sessionNextStep(s),
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

async function onPresetSlugChange(slug: string | null): Promise<void> {
  selectedPresetDetail.value = null;
  scriptBuilderRef.value?.setBuilderPresetSlug?.(slug);
  if (!slug) return;
  await loadPresetDetailBySlug(slug);
}

async function loadPresetDetailBySlug(slug: string): Promise<DialogPresetDetail | null> {
  loadingPresetDetail.value = true;
  try {
    const detail = await apiFetch<DialogPresetDetail>(
      `/api/dialog-scripts/presets/${encodeURIComponent(slug)}`,
    );
    selectedPresetDetail.value = detail;
    selectedPresetSlug.value = slug;
    return detail;
  } catch (e) {
    toast.error(errorText(e));
    return null;
  } finally {
    loadingPresetDetail.value = false;
  }
}

async function onBuilderLoadPreset(slug: string): Promise<void> {
  const detail = await loadPresetDetailBySlug(slug);
  if (!detail) return;
  scriptBuilderRef.value?.loadFromPreset?.({ ...detail, slug });
  toast.success('Lines filled — check Script name, then Save script or create a session below.');
}

function loadPresetInBuilder(): void {
  if (!selectedPresetDetail.value && selectedPresetSlug.value) {
    void onBuilderLoadPreset(selectedPresetSlug.value);
    return;
  }
  if (!selectedPresetDetail.value) return;
  scriptBuilderRef.value?.loadFromPreset?.({
    ...selectedPresetDetail.value,
    slug: selectedPresetSlug.value ?? undefined,
  });
  toast.success('Template loaded in builder — edit if needed, then Save.');
}

function usePresetForSession(): void {
  if (!selectedPresetSlug.value) return;
  scriptSource.value = `preset:${selectedPresetSlug.value}`;
  toast.info('Template selected for session — fill participants below and Create session.');
}

async function applyPreset(slug: string): Promise<void> {
  applyingPresetSlug.value = slug;
  try {
    const data = await apiFetch<{ id: string; created: boolean; script: DialogScript }>(
      `/api/dialog-scripts/presets/${encodeURIComponent(slug)}/apply`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    scriptSource.value = `script:${data.id}`;
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
    scriptSource.value = `script:${doc._id}`;
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
  const src = scriptSource.value;
  if (!src || src.startsWith('__header')) {
    toast.warning('Choose a dialog template or saved script.');
    return;
  }
  const payload: Record<string, string> = {
    name: sessionName.value,
    accountAId: accountAId.value,
    peerType: peerType.value,
    runMode: runMode.value,
  };
  if (src.startsWith('preset:')) {
    payload.presetSlug = src.slice(7);
  } else if (src.startsWith('script:')) {
    payload.scriptId = src.slice(7);
  } else {
    toast.warning('Invalid script selection.');
    return;
  }
  if (peerType.value === 'account') payload.peerAccountId = peerAccountId.value;
  else payload.peerContactId = peerContactId.value;

  creatingSession.value = true;
  try {
    await apiFetch('/api/dialog-sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
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
    const res = await apiFetch<{
      ok: boolean;
      result?: { done?: boolean; waiting?: boolean; error?: string; turnIndex?: number };
      session?: { status?: string; lastError?: string };
    }>(`/api/dialog-sessions/${id}/step`, { method: 'POST' });
    selectSession(id);
    await loadTranscript();
    await loadAll();
    const r = res.result;
    if (r?.error) {
      toast.error(r.error);
    } else if (r?.waiting) {
      toast.info('Waiting for peer reply (syncing inbox). Click Step again or use Auto mode.');
    } else if (r?.done) {
      toast.success('Dialog completed.');
    } else {
      toast.success(`Turn ${(r?.turnIndex ?? 0) + 1} done.`);
    }
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
.transcript-list,
.preset-preview-list {
  max-height: 480px;
  overflow-y: auto;
}
.preset-preview-list {
  max-height: 280px;
}
</style>
