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
        <v-col cols="12" md="4">
          <v-select
            v-model="newSendingWindowRegion"
            :items="regionItems"
            item-title="title"
            item-value="value"
            label="Sending region (quiet hours)"
            variant="outlined"
            density="comfortable"
            hint="Auto picks hours from phone country; bot does not send outside this window"
            persistent-hint
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

    <BulkImportPanel
      title="Bulk import senders (CSV)"
      hint="Columns: phone, label, role, sessionPath (tdata dir/zip or .json on server), proxyLabel"
      button-label="Bulk import"
      :loading="bulkImporting"
      :result-summary="bulkImportSummary"
      @import="bulkImportAccounts"
    />

    <v-progress-circular v-if="loading && rows.length === 0" indeterminate />
    <v-alert v-else-if="!rows.length && !loading" type="info" variant="tonal" density="compact">
      No sending accounts yet. Add a row above or run <code>npm run cli -- auth login</code>.
    </v-alert>
    <v-data-table
      v-else
      :headers="headers"
      :items="rows"
      :items-per-page="50"
      :class="DATA_TABLE_CLASS"
      density="compact"
    >
      <template #[`item.phone`]="{ item }">
        <span class="cell-overflow" :title="item.phone">{{ item.phone }}</span>
        <span v-if="item.telegramUsername" class="text-caption font-mono d-block text-medium-emphasis">
          @{{ item.telegramUsername }}
        </span>
      </template>
      <template #[`item.label`]="{ item }">
        <span class="cell-overflow" :title="item.label || ''">{{ item.label || '—' }}</span>
      </template>
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
        <span v-if="item.telegramUsername" class="cell-overflow font-mono">@{{ item.telegramUsername }}</span>
        <span v-else class="text-medium-emphasis">—</span>
      </template>
      <template #[`item.activeHours`]="{ item }">
        <span v-if="item.sendingWindow" class="text-caption cell-overflow" :title="activeHoursTitle(item)">
          {{ item.sendingWindow.start }}–{{ item.sendingWindow.end }}
          <span class="d-block text-medium-emphasis">{{ item.sendingWindow.timezone }}</span>
        </span>
        <span v-else class="text-medium-emphasis">—</span>
        <v-chip
          v-if="item.sendingWindow"
          size="x-small"
          class="mt-1"
          :color="item.sendingActiveNow ? 'success' : 'warning'"
          variant="tonal"
        >
          {{ item.sendingActiveNow ? 'active now' : 'quiet (no sends)' }}
        </v-chip>
      </template>
      <template #[`item.status`]="{ item }">
        <span class="cell-overflow">{{ item.status }}</span>
      </template>
      <template #[`item.healthScore`]="{ item }">
        <span class="cell-overflow">{{ item.healthScore?.toFixed?.(2) ?? '—' }}</span>
      </template>
      <template #[`item.daily`]="{ item }">
        <span class="cell-overflow">
          {{ item.dailyCounters?.msgsToNew ?? 0 }} / {{ item.dailyLimits?.msgsToNew ?? '—' }}
          <span class="text-medium-emphasis text-caption d-block">
            ≤{{ item.dailyLimits?.ratePerHour ?? '—' }} msg/h
          </span>
        </span>
      </template>
      <template #[`item.telegramApi`]="{ item }">
        <span v-if="item.telegramApiId" class="cell-overflow text-caption font-mono">
          {{ item.telegramApiId }}
          <span v-if="item.hasTelegramApiHash" class="text-medium-emphasis"> · hash</span>
        </span>
        <span v-else class="text-medium-emphasis">—</span>
      </template>
      <template #[`item.deviceProfile`]="{ item }">
        <span
          class="cell-overflow text-caption"
          :title="[
            item.deviceProfile?.deviceModel,
            item.deviceProfile?.systemVersion,
            item.deviceProfile?.appVersion,
          ]
            .filter(Boolean)
            .join(' / ')"
        >
          {{ item.deviceProfile?.deviceModel || '—' }}
        </span>
      </template>
      <template #[`item.proxy`]="{ item }">
        <span class="cell-overflow" :title="proxyLabel(item.proxyId)">{{ proxyLabel(item.proxyId) }}</span>
      </template>
      <template #[`item.actions`]="{ item }">
        <div class="account-actions">
          <div class="account-actions__icons">
            <v-tooltip text="Activate" location="top">
              <template #activator="{ props: tp }">
                <v-btn
                  v-bind="tp"
                  icon="mdi-play-circle-outline"
                  size="x-small"
                  variant="text"
                  color="success"
                  aria-label="Set active"
                  @click="setStatus(item._id, 'active')"
                />
              </template>
            </v-tooltip>
            <v-tooltip text="Pause" location="top">
              <template #activator="{ props: tp }">
                <v-btn
                  v-bind="tp"
                  icon="mdi-pause-circle-outline"
                  size="x-small"
                  variant="text"
                  aria-label="Pause"
                  @click="setStatus(item._id, 'paused')"
                />
              </template>
            </v-tooltip>
            <v-tooltip text="Send test" location="top">
              <template #activator="{ props: tp }">
                <v-btn
                  v-bind="tp"
                  icon="mdi-send-outline"
                  size="x-small"
                  variant="text"
                  aria-label="Send test"
                  @click="sendTestFrom(item._id)"
                />
              </template>
            </v-tooltip>
            <v-tooltip text="Sync inbox" location="top">
              <template #activator="{ props: tp }">
                <v-btn
                  v-bind="tp"
                  icon="mdi-inbox-arrow-down-outline"
                  size="x-small"
                  variant="text"
                  aria-label="Sync inbox"
                  @click="syncInbox(item._id)"
                />
              </template>
            </v-tooltip>
            <v-menu location="bottom end">
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  icon="mdi-dots-vertical"
                  size="x-small"
                  variant="text"
                  aria-label="More actions"
                />
              </template>
              <v-list density="compact" min-width="200">
                <v-list-item title="Quarantine" @click="setStatus(item._id, 'quarantined')" />
                <v-list-item title="Auto-assign proxy" @click="autoAssignMtproxy(item._id)" />
                <v-list-item title="Reset hours to phone region" @click="applyRegionalWindow(item._id)" />
                <v-list-item title="Clear proxy" @click="clearMtproxy(item._id)" />
                <v-divider />
                <v-list-item title="Delete account" class="text-error" @click="removeSender(item._id)" />
              </v-list>
            </v-menu>
          </div>
          <div class="account-actions__proxy">
            <v-select
              :model-value="selectedProxyByAccount[item._id] ?? ''"
              :items="proxyOptionsForAccount(item._id)"
              item-title="label"
              item-value="_id"
              label="Proxy"
              variant="outlined"
              density="compact"
              hide-details
              @update:model-value="(v) => setSelectedProxy(item._id, String(v ?? ''))"
            />
            <v-btn size="x-small" variant="tonal" color="primary" block @click="assignSelectedMtproxy(item._id)">
              Assign
            </v-btn>
          </div>
        </div>
      </template>
    </v-data-table>
  </div>
</template>

<script setup lang="ts">
import { errorText } from '~/composables/useToast';
import { DATA_TABLE_CLASS, fixedCol } from '~/utils/tableColumns';

interface Account {
  _id: string;
  phone: string;
  label?: string;
  telegramApiId?: number | null;
  hasTelegramApiHash?: boolean;
  telegramUsername?: string;
  proxyId?: string | null;
  status: string;
  role?: 'sender' | 'test_recipient';
  healthScore: number;
  sendingWindow?: { start: string; end: string; timezone: string };
  sendingActiveNow?: boolean;
  sendingQuietUntil?: string;
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
interface RegionRow {
  countryIso2: string;
  name: string;
  timezone: string;
  windowStart: string;
  windowEnd: string;
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
const bulkImporting = ref(false);
const bulkImportSummary = ref('');
const importingJson = ref(false);
const importPhone = ref('');
const importTdataPath = ref('');
const importJsonPath = ref('');
const importProxyId = ref('');
const importRole = ref<'sender' | 'test_recipient'>('sender');
const newSendingWindowRegion = ref('');
const regions = ref<RegionRow[]>([]);

const regionItems = computed(() => [
  { title: 'Auto from phone number', value: '' },
  ...regions.value.map((r) => ({
    title: `${r.countryIso2} — ${r.name} (${r.windowStart}–${r.windowEnd}, ${r.timezone})`,
    value: r.countryIso2,
  })),
]);

const headers = [
  fixedCol('Phone', 'phone', 130),
  fixedCol('Label', 'label', 90),
  fixedCol('Role', 'role', 118, { sortable: false }),
  fixedCol('Active hours', 'activeHours', 120, { sortable: false }),
  fixedCol('API', 'telegramApi', 72, { sortable: false }),
  fixedCol('@user', 'telegramUsername', 100),
  fixedCol('Proxy', 'proxy', 88, { sortable: false }),
  fixedCol('Status', 'status', 88),
  fixedCol('Health', 'healthScore', 64),
  fixedCol('Today', 'daily', 96, { sortable: false }),
  fixedCol('Device', 'deviceProfile', 100, { sortable: false }),
  fixedCol('Actions', 'actions', 200, { sortable: false, wrap: true }),
];

function proxyOptionsForAccount(accountId: string): ProxyRow[] {
  const usedByOther = new Set(
    rows.value
      .filter((a) => a._id !== accountId && a.proxyId)
      .map((a) => String(a.proxyId)),
  );
  return proxies.value.filter((p) => !usedByOther.has(p._id));
}

function activeHoursTitle(item: Account): string {
  const sw = item.sendingWindow;
  if (!sw) return '';
  const quiet = item.sendingQuietUntil ? ` · ${item.sendingQuietUntil}` : '';
  return `${sw.start}–${sw.end} ${sw.timezone}${quiet}`;
}

async function loadRegions(): Promise<void> {
  try {
    const data = await apiFetch<{ regions: RegionRow[] }>('/api/regions/sending-windows');
    regions.value = data.regions ?? [];
  } catch {
    regions.value = [];
  }
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

onMounted(() => {
  void loadRegions();
});

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
        ...(newSendingWindowRegion.value.trim()
          ? { sendingWindowRegion: newSendingWindowRegion.value.trim().toUpperCase() }
          : {}),
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
  } catch (e) {
    toast.error(errorText(e));
    console.error('import tdata failed', e);
  } finally {
    importingTdata.value = false;
    await load();
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
  } catch (e) {
    toast.error(errorText(e));
    console.error('import json failed', e);
  } finally {
    importingJson.value = false;
    await load();
  }
}

async function bulkImportAccounts(payload: { csv?: string }): Promise<void> {
  if (!payload.csv?.trim()) {
    toast.warning('Bulk import requires CSV.');
    return;
  }
  bulkImporting.value = true;
  bulkImportSummary.value = '';
  try {
    const res = await apiFetch<{ imported: number; failed: number }>('/api/accounts/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ csv: payload.csv }),
    });
    bulkImportSummary.value = `Imported ${res.imported}, failed ${res.failed}`;
    toast.success(bulkImportSummary.value);
  } catch (e) {
    toast.error(errorText(e));
    console.error('bulk import failed', e);
  } finally {
    bulkImporting.value = false;
    await load();
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

async function applyRegionalWindow(accountId: string): Promise<void> {
  try {
    await apiFetch(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      body: JSON.stringify({ applyRegionalWindow: true }),
    });
    toast.success('Active hours updated from phone region.');
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

<style scoped>
.account-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.account-actions__icons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
}

.account-actions__proxy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
</style>
