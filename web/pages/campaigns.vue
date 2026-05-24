<template>
  <div>
    <div class="d-flex align-center mb-2">
      <h1 class="text-h4 font-weight-bold">Campaigns</h1>
      <v-spacer />
      <v-btn variant="text" :loading="polling" :disabled="polling" prepend-icon="mdi-refresh" @click="refresh">
        Refresh
      </v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">
      A campaign picks <strong>which sending accounts</strong> deliver mail and <strong>which contacts</strong> receive it (by tags).
    </p>

    <v-alert type="info" variant="tonal" class="mb-4" border="start">
      <div class="font-weight-medium mb-1">Who sends vs who receives</div>
      <p class="text-body-2 mb-0">
        <strong>Sending accounts</strong> are chosen below (your Telegram logins). <strong>Recipients</strong> are rows on the
        <NuxtLink to="/contacts" class="text-primary">Contacts</NuxtLink>
        page — import phones there, tag them, then list the same tags here under "Audience".
      </p>
    </v-alert>

    <v-alert
      v-if="loadErr"
      type="error"
      variant="tonal"
      class="mb-4"
      density="compact"
      role="alert"
      aria-live="polite"
    >
      {{ loadErr }}
    </v-alert>

    <v-card class="mb-6 pa-4" variant="outlined">
      <v-card-title class="text-subtitle-1 px-0 pt-0">New draft campaign</v-card-title>

      <v-row dense class="mt-2">
        <v-col cols="12" md="6">
          <v-text-field v-model="name" label="Campaign name" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="6">
          <v-select
            v-model="templateId"
            :items="templates"
            item-title="name"
            item-value="_id"
            label="Message template"
            variant="outlined"
            density="comfortable"
          />
        </v-col>

        <v-col cols="12">
          <v-autocomplete
            v-model="pickedSenderIds"
            :items="accounts"
            item-title="pickerLabel"
            item-value="_id"
            label="Sending accounts (who sends)"
            multiple
            chips
            closable-chips
            variant="outlined"
            density="comfortable"
            hide-selected
            clearable
            hint="Choose one or more of your Telegram sessions"
            persistent-hint
          />
        </v-col>
        <v-col cols="12" class="pt-0">
          <v-btn size="small" variant="text" color="primary" @click="selectAllSenders">Select all</v-btn>
          <v-btn size="small" variant="text" color="default" @click="clearSelectedSenders">Clear</v-btn>
        </v-col>

        <v-col cols="12">
          <v-textarea
            v-model="extraSendersRaw"
            label="Or paste sending references (comma / newline)"
            variant="outlined"
            rows="2"
            density="comfortable"
            hint="Same as campaign CLI: +79991234567, @your_telegram_username, or internal id from the Senders table"
            persistent-hint
          />
        </v-col>

        <v-col cols="12">
          <v-autocomplete
            v-model="pickedContactIds"
            :items="contacts"
            item-title="pickerLabel"
            item-value="_id"
            label="Audience contacts (optional explicit list)"
            multiple
            chips
            closable-chips
            variant="outlined"
            density="comfortable"
            hide-selected
            clearable
            hint="Pick recipients directly, or leave empty and use tags below"
            persistent-hint
          />
        </v-col>
        <v-col cols="12" class="pt-0">
          <v-btn size="small" variant="text" color="primary" @click="selectAllContacts">Select all contacts</v-btn>
          <v-btn size="small" variant="text" color="default" @click="clearSelectedContacts">Clear</v-btn>
        </v-col>

        <v-col cols="12">
          <v-text-field
            v-model="tags"
            label="Audience tags (contacts must have these tags)"
            variant="outlined"
            density="comfortable"
            hint="Comma-separated — matches imported contacts on the Contacts page"
            persistent-hint
          />
        </v-col>

        <v-col cols="12" md="6">
          <v-switch
            v-model="homoglyphsEnabled"
            label="Mix Latin / Cyrillic lookalikes (o/о, c/с, …)"
            color="primary"
            density="comfortable"
            hide-details
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-slider
            v-model="homoglyphPercent"
            :disabled="!homoglyphsEnabled"
            label="Chance per Latin letter"
            min="5"
            max="100"
            step="5"
            thumb-label
            show-ticks="always"
            tick-size="2"
            density="comfortable"
            class="mt-2"
          />
        </v-col>
      </v-row>

      <v-btn color="primary" class="mt-4" :loading="creating" :disabled="creating" @click="create">
        Create draft
      </v-btn>
    </v-card>

    <v-card-title class="text-subtitle-1 px-0 pt-0 mb-2">Existing campaigns</v-card-title>

    <v-progress-circular v-if="loading && !campaigns.length" indeterminate />
    <v-alert v-else-if="!campaigns.length && !loading" type="info" variant="tonal" density="compact">
      No campaigns yet. Create one above.
    </v-alert>
    <v-list v-else class="rounded border">
      <v-list-item v-for="c in campaigns" :key="c._id" class="border-b py-3">
        <template #prepend>
          <v-chip size="small" :color="statusColor(c.status)" class="mr-2">{{ c.status }}</v-chip>
        </template>
        <v-list-item-title class="font-weight-medium">{{ c.name }}</v-list-item-title>
        <div class="d-flex flex-wrap gap-2 mt-2">
          <v-chip
            v-for="entry in statEntries(c.stats)"
            :key="entry.key"
            size="small"
            variant="tonal"
            :color="entry.color"
          >
            <span class="font-weight-medium mr-1">{{ entry.label }}:</span>
            {{ entry.value }}
          </v-chip>
          <span v-if="!statEntries(c.stats).length" class="text-caption text-medium-emphasis">
            No stats yet.
          </span>
        </div>
        <template #append>
          <div class="campaign-actions">
            <v-btn size="small" variant="tonal" color="primary" @click="start(c._id, c.name)">Start</v-btn>
            <v-btn size="small" variant="text" color="warning" @click="pause(c._id)">Pause</v-btn>
            <v-btn size="small" variant="text" color="info" @click="showResults(c._id, c.name)">Results</v-btn>
            <v-btn size="small" variant="text" color="secondary" @click="verify(c._id, c.name)">Verify</v-btn>
            <v-btn size="small" variant="text" color="error" @click="removeCampaign(c._id, c.name)">Delete</v-btn>
          </div>
        </template>
      </v-list-item>
    </v-list>

    <v-dialog v-model="resultsOpen" max-width="1200">
      <v-card>
        <v-card-title class="d-flex align-center">
          <span>Campaign results — {{ resultsTitle }}</span>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" @click="resultsOpen = false" />
        </v-card-title>
        <v-card-text>
          <div class="d-flex flex-wrap gap-2 mb-4">
            <v-chip v-for="(v, k) in resultsSummary" :key="k" size="small" variant="tonal">
              {{ k }}: {{ v }}
            </v-chip>
          </div>
          <v-data-table
            :headers="resultHeaders"
            :items="resultItems"
            :items-per-page="25"
            :class="DATA_TABLE_CLASS"
            density="compact"
          >
            <template #[`item.contact`]="{ item }">
              <span class="cell-overflow" :title="String(item.contact)">{{ item.contact }}</span>
            </template>
            <template #[`item.account`]="{ item }">
              <span class="cell-overflow" :title="String(item.account)">{{ item.account }}</span>
            </template>
            <template #[`item.text`]="{ item }">
              <span class="cell-overflow" :title="String(item.text)">{{ item.text }}</span>
            </template>
            <template #[`item.error`]="{ item }">
              <span class="cell-overflow text-error" :title="String(item.error)">{{ item.error || '—' }}</span>
            </template>
          </v-data-table>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { errorText } from '~/composables/useToast';
import { DATA_TABLE_CLASS, fixedCol } from '~/utils/tableColumns';

interface Campaign {
  _id: string;
  name: string;
  status: string;
  templateId: string;
  accountPool: string[];
  audience?: { tags?: string[] };
  homoglyphs?: { enabled?: boolean; probability?: number };
  stats?: Record<string, number>;
}

interface AccountRow {
  _id: string;
  phone: string;
  label?: string;
  telegramUsername?: string;
  pickerLabel: string;
}

interface Template {
  _id: string;
  name: string;
}
interface ContactRow {
  _id: string;
  phoneE164?: string;
  username?: string;
  firstName?: string;
  pickerLabel: string;
}

const { apiFetch } = useBasicAuth();
const toast = useToast();
const { confirm, confirmDestructive } = useConfirm();
const campaigns = ref<Campaign[]>([]);
const accounts = ref<AccountRow[]>([]);
const templates = ref<Template[]>([]);
const contacts = ref<ContactRow[]>([]);
const name = ref('newsletter');
const templateId = ref('');
const pickedSenderIds = ref<string[]>([]);
const pickedContactIds = ref<string[]>([]);
const extraSendersRaw = ref('');
const tags = ref('');
const homoglyphsEnabled = ref(false);
const homoglyphPercent = ref(35);
const loadErr = ref('');
const loading = ref(true);
const creating = ref(false);
const resultsOpen = ref(false);
const resultsTitle = ref('');
const resultsSummary = ref<Record<string, number>>({});
const resultItems = ref<Array<Record<string, string | number>>>([]);
const resultHeaders = [
  fixedCol('Status', 'status', 88),
  fixedCol('Contact', 'contact', 120),
  fixedCol('Sender', 'account', 110),
  fixedCol('Message', 'text', 180),
  fixedCol('Try', 'attempts', 56),
  fixedCol('Error', 'error', 140),
  fixedCol('Sent', 'sentAt', 120),
];

function splitRefs(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function accountPoolPayload(): string[] {
  return [...new Set([...pickedSenderIds.value, ...splitRefs(extraSendersRaw.value)])];
}

function selectAllSenders(): void {
  pickedSenderIds.value = accounts.value.map((a) => a._id);
}

function clearSelectedSenders(): void {
  pickedSenderIds.value = [];
}
function selectAllContacts(): void {
  pickedContactIds.value = contacts.value.map((c) => c._id);
}
function clearSelectedContacts(): void {
  pickedContactIds.value = [];
}

const STAT_META: Record<string, { label: string; color: string; order: number }> = {
  total: { label: 'Total', color: 'default', order: 0 },
  queued: { label: 'Queued', color: 'info', order: 1 },
  sending: { label: 'Sending', color: 'info', order: 2 },
  sent: { label: 'Sent', color: 'success', order: 3 },
  failed: { label: 'Failed', color: 'error', order: 4 },
  skipped: { label: 'Skipped', color: 'warning', order: 5 },
  skipped_quota: { label: 'Skipped (quota)', color: 'warning', order: 6 },
  skipped_blocked: { label: 'Skipped (blocked)', color: 'warning', order: 7 },
  delayed: { label: 'Delayed', color: 'warning', order: 8 },
};

function statEntries(stats?: Record<string, number>): Array<{ key: string; label: string; color: string; value: number }> {
  if (!stats) return [];
  const entries = Object.entries(stats)
    .filter(([, v]) => Number.isFinite(v))
    .map(([k, v]) => {
      const meta = STAT_META[k] ?? { label: k, color: 'default', order: 100 };
      return { key: k, label: meta.label, color: meta.color, value: v as number, order: meta.order };
    });
  entries.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  return entries;
}

function statusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'success';
    case 'paused':
      return 'warning';
    case 'failed':
      return 'error';
    case 'completed':
      return 'info';
    default:
      return 'default';
  }
}

function parseApiError(e: unknown): string {
  if (e instanceof Error && 'body' in e) {
    const body = (e as { body?: unknown }).body;
    if (body && typeof body === 'object') {
      const obj = body as Record<string, unknown>;
      if (typeof obj.message === 'string') return obj.message;
      if (Array.isArray(obj.unresolved) && obj.unresolved.length) {
        return `Unknown sending account(s): ${obj.unresolved.join(', ')}.`;
      }
      if (typeof obj.error === 'string') return obj.error;
    }
  }
  return errorText(e);
}

async function loadAll(): Promise<void> {
  try {
    loadErr.value = '';
    const [c, a, t, ct] = await Promise.all([
      apiFetch<Campaign[]>('/api/campaigns'),
      apiFetch<
        {
          _id: string;
          phone: string;
          label?: string;
          telegramUsername?: string;
          status?: string;
          role?: string;
          sendable?: boolean;
          sendBlockReason?: string;
        }[]
      >('/api/accounts'),
      apiFetch<Template[]>('/api/templates'),
      apiFetch<
        {
          _id: string;
          phoneE164?: string;
          username?: string;
          firstName?: string;
        }[]
      >('/api/contacts'),
    ]);
    campaigns.value = c;
    accounts.value = a
      .filter((x) => (x.role ?? 'sender') === 'sender')
      .map((x) => ({
        ...x,
        pickerLabel: [
          x.phone,
          x.telegramUsername ? `@${x.telegramUsername}` : null,
          x.label ? `(${x.label})` : null,
          x.status ? `[${x.status}]` : null,
          x.sendable === false ? `(not sendable: ${x.sendBlockReason ?? 'ineligible'})` : null,
        ]
          .filter(Boolean)
          .join(' '),
      }));
    if (!pickedSenderIds.value.length) {
      pickedSenderIds.value = accounts.value.filter((x) => x.sendable).map((x) => x._id);
    }
    templates.value = t;
    contacts.value = ct.map((x) => ({
      ...x,
      pickerLabel: [x.phoneE164 || null, x.username ? `@${x.username}` : null, x.firstName || null]
        .filter(Boolean)
        .join(' '),
    }));
    if (!templateId.value && t[0]) templateId.value = t[0]._id;
  } catch (e) {
    loadErr.value = parseApiError(e);
  } finally {
    loading.value = false;
  }
}

const { running: polling, refresh } = usePolling(loadAll, { intervalMs: 8000 });

async function create(): Promise<void> {
  const pool = accountPoolPayload();
  if (!pool.length) {
    toast.warning('Pick at least one sending account or paste a phone / @username / id.');
    return;
  }
  creating.value = true;
  try {
    await apiFetch('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: name.value,
        templateId: templateId.value,
        accountPool: pool,
        audience: {
          contactIds: pickedContactIds.value,
          tags: tags.value ? tags.value.split(',').map((x) => x.trim()).filter(Boolean) : [],
        },
        homoglyphs: homoglyphsEnabled.value
          ? { enabled: true, probability: homoglyphPercent.value / 100 }
          : undefined,
      }),
    });
    toast.success('Campaign draft created.');
    extraSendersRaw.value = '';
    await loadAll();
  } catch (e) {
    toast.error(parseApiError(e));
  } finally {
    creating.value = false;
  }
}

async function start(id: string, campaignName: string): Promise<void> {
  const r = await confirm({
    title: 'Start campaign',
    message: `Start campaign "${campaignName}"? Messages will be queued for sending.`,
    okText: 'Start',
    okColor: 'primary',
  });
  if (!r.ok) return;
  try {
    await apiFetch(`/api/campaigns/${id}/start`, { method: 'POST' });
    toast.success('Campaign started.');
    await loadAll();
  } catch (e) {
    toast.error(parseApiError(e));
  }
}

async function pause(id: string): Promise<void> {
  try {
    await apiFetch(`/api/campaigns/${id}/pause`, { method: 'POST' });
    toast.success('Campaign paused.');
    await loadAll();
  } catch (e) {
    toast.error(parseApiError(e));
  }
}

async function verify(id: string, campaignName: string): Promise<void> {
  const r = await confirm({
    title: 'Verify delivery',
    message:
      `Force-sync inbox of every "test_recipient" account and check ` +
      `whether messages from "${campaignName}" actually arrived. This may take a few seconds.`,
    okText: 'Verify',
    okColor: 'secondary',
  });
  if (!r.ok) return;
  try {
    const res = await apiFetch<{
      totalSent: number;
      testRecipients: number;
      observable: number;
      verified: number;
      missing: number;
    }>(`/api/campaigns/${id}/verify`, { method: 'POST' });
    if (!res.testRecipients) {
      toast.warning('No accounts marked as test_recipient. Mark at least one on the Senders page.');
      return;
    }
    if (!res.observable) {
      toast.warning(
        `Sent ${res.totalSent}, but no recipient phones match a test_recipient account. ` +
          `Mark a recipient account as test_recipient and add the same phone as a contact.`,
      );
      return;
    }
    toast.success(
      `Verify done. Sent: ${res.totalSent}, observable: ${res.observable}, ` +
        `verified: ${res.verified}, missing: ${res.missing}.`,
    );
  } catch (e) {
    toast.error(parseApiError(e));
  }
}

async function removeCampaign(id: string, campaignName: string): Promise<void> {
  const ok = await confirmDestructive(
    `Delete campaign «${campaignName}» and all its message rows? This cannot be undone.`,
  );
  if (!ok) return;
  try {
    await apiFetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    toast.success('Campaign deleted.');
    await loadAll();
  } catch (e) {
    toast.error(parseApiError(e));
  }
}

async function showResults(id: string, campaignName: string): Promise<void> {
  try {
    const res = await apiFetch<{
      summary: Record<string, number>;
      items: Array<{
        status: string;
        contact: { phone?: string; username?: string; name?: string } | null;
        account: { phone?: string; username?: string; label?: string } | null;
        text?: string;
        attempts: number;
        error?: { code?: string; message?: string };
        sentAt?: string | null;
      }>;
    }>(`/api/campaigns/${id}/results`);
    resultsTitle.value = campaignName;
    resultsSummary.value = res.summary ?? {};
    resultItems.value = (res.items ?? []).map((x) => ({
      status: x.status,
      contact: [x.contact?.phone || '', x.contact?.username ? `@${x.contact.username}` : '', x.contact?.name || '']
        .filter(Boolean)
        .join(' '),
      account: [x.account?.phone || '', x.account?.username ? `@${x.account.username}` : '', x.account?.label || '']
        .filter(Boolean)
        .join(' '),
      text: x.text || '',
      attempts: x.attempts ?? 0,
      error: x.error?.code ? `${x.error.code}: ${x.error.message ?? ''}` : '',
      sentAt: x.sentAt ? new Date(x.sentAt).toLocaleString() : '',
    }));
    resultsOpen.value = true;
  } catch (e) {
    toast.error(parseApiError(e));
  }
}
</script>

<style scoped>
.campaign-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
  max-width: 320px;
}
</style>
