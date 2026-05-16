<template>
  <div>
    <div class="d-flex align-center mb-2">
      <h1 class="text-h4 font-weight-bold">Sending accounts</h1>
      <v-spacer />
      <v-btn variant="text" :loading="polling" :disabled="polling" prepend-icon="mdi-refresh" @click="refresh">
        Refresh
      </v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">
      MTProto sessions used to <strong>send</strong> mailings — not the people you message.
    </p>

    <v-alert type="info" variant="tonal" class="mb-4" border="start">
      <div class="font-weight-medium mb-2">How this app is structured</div>
      <ul class="text-body-2 pl-4 mb-0">
        <li>
          <strong>Sending accounts</strong> (this page): Telegram identities that deliver messages. Log in via CLI:
          <code class="text-caption">npm run cli -- auth login</code>
          or attach a session string to the row below.
        </li>
        <li>
          <strong>Recipients</strong> live under
          <NuxtLink to="/contacts" class="text-primary">Contacts</NuxtLink>
          (CSV import). Campaigns send templates to contacts using tags — not by typing @handles here.
        </li>
      </ul>
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
    <v-btn color="secondary" variant="tonal" class="mb-4" :loading="autoAssigning" @click="autoAssignAllMtproxy">
      Auto-assign MTProxy by phone country
    </v-btn>

    <v-card class="mb-6 pa-4" variant="outlined">
      <v-card-title class="text-subtitle-1 px-0 pt-0"> Register phone (session separately)</v-card-title>
      <p class="text-caption text-medium-emphasis mb-4">
        Creates a row so you can paste an encrypted session via API or CLI. It does not log into Telegram by itself.
      </p>
      <v-row dense align="end">
        <v-col cols="12" md="4">
          <v-text-field v-model="newPhone" label="Phone +E.164" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="4">
          <v-text-field v-model="newLabel" label="Label (optional)" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="4">
          <v-text-field
            v-model="newDeviceModel"
            label="Device model (optional)"
            variant="outlined"
            density="comfortable"
          />
        </v-col>
        <v-col cols="12" md="4">
          <v-text-field
            v-model="newSystemVersion"
            label="System version (optional)"
            variant="outlined"
            density="comfortable"
          />
        </v-col>
        <v-col cols="12" md="4">
          <v-text-field
            v-model="newAppVersion"
            label="App version (optional)"
            variant="outlined"
            density="comfortable"
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-text-field v-model="newLangCode" label="Lang (e.g. en)" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="2">
          <v-text-field
            v-model="newSystemLangCode"
            label="System lang"
            variant="outlined"
            density="comfortable"
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-text-field
            v-model="newTelegramApiId"
            label="Telegram api_id (optional)"
            variant="outlined"
            density="comfortable"
            type="number"
            hide-spin-buttons
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-text-field
            v-model="newTelegramApiHash"
            label="Telegram api_hash (optional)"
            variant="outlined"
            density="comfortable"
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-btn color="primary" block :loading="registering" :disabled="registering" @click="registerShell">
            Add row
          </v-btn>
        </v-col>
      </v-row>
    </v-card>

    <v-card class="mb-6 pa-4" variant="outlined">
      <v-card-title class="text-subtitle-1 px-0 pt-0">Import account (tdata / JSON)</v-card-title>
      <p class="text-caption text-medium-emphasis mb-4">
        Paste filesystem paths on the server machine. For tdata import, JSON metadata is required.
      </p>
      <v-row dense align="end">
        <v-col cols="12" md="3">
          <v-text-field v-model="importPhone" label="Phone +E.164" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="4">
          <v-text-field v-model="importTdataPath" label="tdata path" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="3">
          <v-text-field v-model="importJsonPath" label="JSON path (required for tdata)" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="2">
          <v-select
            v-model="importProxyId"
            :items="proxies"
            item-title="label"
            item-value="_id"
            label="Proxy"
            variant="outlined"
            density="comfortable"
            clearable
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-select
            v-model="importRole"
            :items="[
              { title: 'Sender', value: 'sender' },
              { title: 'Test recipient', value: 'test_recipient' },
            ]"
            label="Role"
            variant="outlined"
            density="comfortable"
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-btn color="primary" block :loading="importingTdata" @click="importTdata">Import tdata</v-btn>
        </v-col>
        <v-col cols="12" md="2">
          <v-btn color="secondary" block :loading="importingJson" @click="importJson">Import JSON</v-btn>
        </v-col>
      </v-row>
    </v-card>

    <v-progress-circular v-if="loading && rows.length === 0" indeterminate />
    <v-alert v-else-if="!rows.length && !loading" type="info" variant="tonal" density="compact">
      No sending accounts yet. Add a row above or run <code>npm run cli -- auth login</code>.
    </v-alert>
    <v-data-table
      v-else
      :headers="headers"
      :items="rows"
      :items-per-page="50"
      class="elevation-1 rounded"
      density="comfortable"
    >
      <template #[`item.role`]="{ item }">
        <v-select
          :model-value="item.role ?? 'sender'"
          :items="[
            { title: 'Sender', value: 'sender' },
            { title: 'Test recipient', value: 'test_recipient' },
          ]"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 170px"
          @update:model-value="(v) => setRole(item._id, String(v))"
        />
      </template>
      <template #[`item.telegramUsername`]="{ item }">
        <span v-if="item.telegramUsername" class="font-mono">@{{ item.telegramUsername }}</span>
        <span v-else class="text-medium-emphasis">— after login</span>
      </template>
      <template #[`item.healthScore`]="{ item }">
        {{ item.healthScore?.toFixed?.(2) ?? '—' }}
      </template>
      <template #[`item.daily`]="{ item }">
        {{ item.dailyCounters?.msgsToNew ?? 0 }} / {{ item.dailyLimits?.msgsToNew ?? '—' }}
        <span class="text-medium-emphasis text-caption d-block">
          ≤{{ item.dailyLimits?.ratePerHour ?? '—' }} msg/h per worker
        </span>
      </template>
      <template #[`item.telegramApi`]="{ item }">
        <span v-if="item.telegramApiId" class="text-caption font-mono">
          {{ item.telegramApiId }}
          <span v-if="item.telegramApiHash" class="text-medium-emphasis"> · hash set</span>
        </span>
        <span v-else class="text-medium-emphasis">—</span>
      </template>
      <template #[`item.deviceProfile`]="{ item }">
        <div class="text-caption">
          <div>{{ item.deviceProfile?.deviceModel || '—' }}</div>
          <div class="text-medium-emphasis">
            {{ item.deviceProfile?.systemVersion || '—' }} / {{ item.deviceProfile?.appVersion || '—' }}
          </div>
          <div class="text-medium-emphasis">
            {{ item.deviceProfile?.langCode || '—' }} / {{ item.deviceProfile?.systemLangCode || '—' }}
          </div>
        </div>
      </template>
      <template #[`item.proxy`]="{ item }">
        <span>{{ proxyLabel(item.proxyId) }}</span>
      </template>
      <template #[`item.actions`]="{ item }">
        <v-btn size="small" variant="text" color="primary" @click="setStatus(item._id, 'active')">
          active
        </v-btn>
        <v-btn size="small" variant="text" color="warning" @click="setStatus(item._id, 'paused')">
          pause
        </v-btn>
        <v-btn size="small" variant="text" color="error" @click="setStatus(item._id, 'quarantined')">
          quarantine
        </v-btn>
        <v-btn size="small" variant="text" color="secondary" @click="sendTestFrom(item._id)">
          send test
        </v-btn>
        <v-btn size="small" variant="text" color="secondary" @click="syncInbox(item._id)">
          sync inbox
        </v-btn>
        <v-select
          :model-value="selectedProxyByAccount[item._id] ?? ''"
          :items="proxyOptionsForAccount(item._id)"
          item-title="label"
          item-value="_id"
          label="Proxy"
          variant="outlined"
          density="compact"
          hide-details
          class="d-inline-block mx-2"
          style="max-width: 210px"
          @update:model-value="(v) => setSelectedProxy(item._id, String(v ?? ''))"
        />
        <v-btn size="small" variant="text" color="primary" @click="assignSelectedMtproxy(item._id)">assign</v-btn>
        <v-btn size="small" variant="text" color="primary" @click="autoAssignMtproxy(item._id)">auto</v-btn>
        <v-btn size="small" variant="text" color="default" @click="clearMtproxy(item._id)">clear proxy</v-btn>
        <v-btn size="small" variant="text" color="error" @click="removeSender(item._id)">delete</v-btn>
      </template>
    </v-data-table>
  </div>
</template>

<script setup lang="ts">
import { errorText } from '~/composables/useToast';

interface Account {
  _id: string;
  phone: string;
  label?: string;
  telegramApiId?: number | null;
  telegramApiHash?: string;
  telegramUsername?: string;
  proxyId?: string | null;
  status: string;
  role?: 'sender' | 'test_recipient';
  healthScore: number;
  deviceProfile?: {
    deviceModel?: string;
    systemVersion?: string;
    appVersion?: string;
    langCode?: string;
    systemLangCode?: string;
  };
  dailyLimits?: { msgsToNew?: number; ratePerHour?: number };
  dailyCounters?: { msgsToNew?: number };
}
interface ProxyRow {
  _id: string;
  label: string;
  type: 'socks5' | 'http' | 'mtproto';
  country?: string;
}

const { apiFetch } = useBasicAuth();
const toast = useToast();
const { confirm, confirmDestructive } = useConfirm();
const rows = ref<Account[]>([]);
const proxies = ref<ProxyRow[]>([]);
const selectedProxyByAccount = ref<Record<string, string>>({});
const loadErr = ref('');
const loading = ref(true);
const registering = ref(false);
const autoAssigning = ref(false);
const newPhone = ref('');
const newLabel = ref('');
const newDeviceModel = ref('');
const newSystemVersion = ref('');
const newAppVersion = ref('');
const newLangCode = ref('');
const newSystemLangCode = ref('');
const newTelegramApiId = ref('');
const newTelegramApiHash = ref('');
const importingTdata = ref(false);
const importingJson = ref(false);
const importPhone = ref('');
const importTdataPath = ref('');
const importJsonPath = ref('');
const importProxyId = ref('');
const importRole = ref<'sender' | 'test_recipient'>('sender');

const headers = [
  { title: 'Phone', key: 'phone' },
  { title: 'Label', key: 'label' },
  { title: 'Role', key: 'role' },
  { title: 'TG API', key: 'telegramApi', sortable: false },
  { title: 'Telegram @', key: 'telegramUsername' },
  { title: 'Proxy', key: 'proxy', sortable: false },
  { title: 'Status', key: 'status' },
  { title: 'Health', key: 'healthScore' },
  { title: 'Sent today / limit', key: 'daily' },
  { title: 'Device profile', key: 'deviceProfile', sortable: false },
  { title: 'Actions', key: 'actions', sortable: false },
];

function proxyOptionsForAccount(accountId: string): ProxyRow[] {
  const usedByOther = new Set(
    rows.value
      .filter((a) => a._id !== accountId && a.proxyId)
      .map((a) => String(a.proxyId)),
  );
  return proxies.value.filter((p) => !usedByOther.has(p._id));
}

function proxyLabel(proxyId?: string | null): string {
  if (!proxyId) return '—';
  const p = proxies.value.find((x) => x._id === String(proxyId));
  return p ? `${p.label} (${p.country || '—'})` : String(proxyId);
}

function setSelectedProxy(accountId: string, proxyId: string): void {
  selectedProxyByAccount.value[accountId] = proxyId;
}

async function load(): Promise<void> {
  try {
    loadErr.value = '';
    const [a, p] = await Promise.all([apiFetch<Account[]>('/api/accounts'), apiFetch<ProxyRow[]>('/api/proxies')]);
    rows.value = a;
    proxies.value = p.filter((x) => x.type === 'mtproto');
    for (const acc of rows.value) {
      selectedProxyByAccount.value[acc._id] = acc.proxyId ? String(acc.proxyId) : '';
    }
  } catch (e) {
    loadErr.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

const { running: polling, refresh } = usePolling(load, { intervalMs: 10000 });

async function registerShell(): Promise<void> {
  const phone = newPhone.value.trim();
  if (!phone || phone.length < 8) {
    toast.warning('Enter a full international number (e.g. +14155552671).');
    return;
  }
  registering.value = true;
  try {
    const apiIdRaw = newTelegramApiId.value.trim();
    const apiId = apiIdRaw ? parseInt(apiIdRaw, 10) : undefined;
    const apiHash = newTelegramApiHash.value.trim();
    await apiFetch('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        label: newLabel.value.trim(),
        ...(typeof apiId === 'number' && !Number.isNaN(apiId) && apiId > 0 && apiHash
          ? { telegramApiId: apiId, telegramApiHash: apiHash }
          : {}),
        deviceProfile: {
          deviceModel: newDeviceModel.value.trim(),
          systemVersion: newSystemVersion.value.trim(),
          appVersion: newAppVersion.value.trim(),
          langCode: newLangCode.value.trim(),
          systemLangCode: newSystemLangCode.value.trim(),
        },
      }),
    });
    newPhone.value = '';
    newLabel.value = '';
    newDeviceModel.value = '';
    newSystemVersion.value = '';
    newAppVersion.value = '';
    newLangCode.value = '';
    newSystemLangCode.value = '';
    newTelegramApiId.value = '';
    newTelegramApiHash.value = '';
    toast.success('Saved. Add MTProto session via CLI auth login or POST /api/accounts/:id/session.');
    await load();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    registering.value = false;
  }
}

async function importTdata(): Promise<void> {
  if (!importPhone.value.trim() || !importTdataPath.value.trim() || !importJsonPath.value.trim()) {
    toast.warning('Phone, tdata path, and JSON path are required for tdata import.');
    return;
  }
  importingTdata.value = true;
  try {
    await apiFetch('/api/accounts/import-tdata', {
      method: 'POST',
      body: JSON.stringify({
        phone: importPhone.value.trim(),
        tdataPath: importTdataPath.value.trim(),
        jsonPath: importJsonPath.value.trim(),
        proxyId: importProxyId.value.trim() || undefined,
        role: importRole.value,
      }),
    });
    toast.success('tdata imported and verified.');
    await load();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    importingTdata.value = false;
  }
}

async function importJson(): Promise<void> {
  if (!importJsonPath.value.trim()) {
    toast.warning('JSON path is required.');
    return;
  }
  importingJson.value = true;
  try {
    await apiFetch('/api/accounts/import-json', {
      method: 'POST',
      body: JSON.stringify({
        jsonPath: importJsonPath.value.trim(),
        phone: importPhone.value.trim() || undefined,
        proxyId: importProxyId.value.trim() || undefined,
        role: importRole.value,
      }),
    });
    toast.success('JSON account imported.');
    await load();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    importingJson.value = false;
  }
}

async function setStatus(id: string, status: string): Promise<void> {
  try {
    await apiFetch(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast.success(`Status set to ${status}.`);
    await load();
  } catch (e) {
    toast.error(errorText(e));
  }
}

async function setRole(id: string, role: string): Promise<void> {
  try {
    await apiFetch(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) });
    toast.success(`Role set to ${role}.`);
    await load();
  } catch (e) {
    toast.error(errorText(e));
  }
}

async function assignSelectedMtproxy(accountId: string): Promise<void> {
  const proxyId = (selectedProxyByAccount.value[accountId] ?? '').trim();
  if (!proxyId) {
    toast.warning('Select MTProxy first.');
    return;
  }
  try {
    await apiFetch(`/api/accounts/${accountId}/assign-mtproxy`, {
      method: 'POST',
      body: JSON.stringify({ proxyId }),
    });
    toast.success('MTProxy assigned.');
    await load();
  } catch (e) {
    toast.error(errorText(e));
  }
}

async function autoAssignMtproxy(accountId: string): Promise<void> {
  try {
    await apiFetch(`/api/accounts/${accountId}/assign-mtproxy`, {
      method: 'POST',
      body: JSON.stringify({ auto: true }),
    });
    toast.success('MTProxy auto-assigned.');
    await load();
  } catch (e) {
    toast.error(errorText(e));
  }
}

async function clearMtproxy(accountId: string): Promise<void> {
  try {
    await apiFetch(`/api/accounts/${accountId}/assign-mtproxy`, {
      method: 'POST',
      body: JSON.stringify({ proxyId: null }),
    });
    toast.success('MTProxy unassigned.');
    await load();
  } catch (e) {
    toast.error(errorText(e));
  }
}

async function autoAssignAllMtproxy(): Promise<void> {
  autoAssigning.value = true;
  try {
    const res = await apiFetch<{ assigned: number; skipped: number; errors: string[] }>(
      '/api/accounts/assign-mtproxy-auto',
      { method: 'POST', body: JSON.stringify({ onlyUnassigned: true }) },
    );
    const tail = res.errors.length ? `. ${res.errors[0]}` : '';
    if (res.assigned === 0) {
      toast.warning(`Nothing assigned. Skipped ${res.skipped}${tail}`);
    } else {
      toast.success(`Auto-assign done. Assigned ${res.assigned}, skipped ${res.skipped}${tail}`);
    }
    await load();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    autoAssigning.value = false;
  }
}

async function removeSender(id: string): Promise<void> {
  const ok = await confirmDestructive('Delete this sender account?', 'This cannot be undone.');
  if (!ok) return;
  try {
    await apiFetch(`/api/accounts/${id}`, { method: 'DELETE' });
    toast.success('Sender deleted.');
    await load();
  } catch (e) {
    toast.error(errorText(e));
  }
}

async function sendTestFrom(id: string): Promise<void> {
  const r = await confirm({
    title: 'Send test message',
    message: 'Send a test message from this account.',
    okText: 'Send',
    fields: [
      { key: 'to', label: 'Send to (me, +E164, @username, or user id)', value: 'me', required: true },
      { key: 'text', label: 'Message text', value: 'hello from tg-send-mult', type: 'textarea', required: true },
    ],
  });
  if (!r.ok) return;
  const to = (r.values.to ?? '').trim();
  const text = (r.values.text ?? '').trim();
  if (!to || !text) {
    toast.warning('Enter both recipient and message.');
    return;
  }
  try {
    await apiFetch(`/api/accounts/${id}/send-test`, {
      method: 'POST',
      body: JSON.stringify({ to, text }),
    });
    toast.success('Test message sent.');
  } catch (e) {
    toast.error(errorText(e));
  }
}

async function syncInbox(id: string): Promise<void> {
  try {
    const res = await apiFetch<{
      ok: boolean;
      accountId: string;
      saved: number;
      scanned?: number;
      markedRead?: number;
    }>(`/api/accounts/${id}/inbound-replies/sync`, { method: 'POST' });
    toast.success(
      `Inbox synced. New: ${res.saved}, dialogs scanned: ${res.scanned ?? 0}, marked read: ${res.markedRead ?? 0}.`,
    );
    await load();
  } catch (e) {
    toast.error(errorText(e));
  }
}
</script>
