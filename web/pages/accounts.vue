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
          <strong>Sending accounts</strong> (this page): import <strong>tdata + JSON</strong> below (a matching-country
          proxy is auto-assigned on create). Pick or change proxy per row in the table after import.
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
      Auto-assign proxy by phone country
    </v-btn>

    <v-card class="mb-6 pa-4" variant="outlined">
      <v-card-title class="text-subtitle-1 px-0 pt-0">Import sender (tdata + JSON)</v-card-title>
      <p class="text-caption text-medium-emphasis mb-4">
        Paste server paths to Telegram Desktop <code>tdata</code> and the matching JSON export. On create, a proxy is
        auto-assigned by phone country — assign or change it manually in the table below.
      </p>
      <v-row dense align="end">
        <v-col cols="12" md="3">
          <v-text-field v-model="importPhone" label="Phone +E.164 (optional if in JSON)" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="4">
          <v-text-field v-model="importTdataPath" label="tdata path" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="4">
          <v-text-field v-model="importJsonPath" label="JSON path" variant="outlined" density="comfortable" />
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
        <v-col cols="12" md="3">
          <v-btn color="primary" block :loading="importingTdata" @click="importTdata">Import sender</v-btn>
        </v-col>
      </v-row>
    </v-card>

    <BulkImportPanel
      title="Bulk import senders (CSV)"
      hint="Columns: phone or username (phone can be omitted if sibling JSON has it), label, role, sessionPath, proxyLabel"
      button-label="Bulk import"
      :loading="bulkImporting"
      :result-summary="bulkImportSummary"
      @import="bulkImportAccounts"
    />

    <v-progress-circular v-if="loading && rows.length === 0" indeterminate />
    <v-alert v-else-if="!rows.length && !loading" type="info" variant="tonal" density="compact">
      No sending accounts yet. Import tdata + JSON above.
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
          :title="item.sendingQuietUntil || ''"
        >
          {{ item.sendingActiveNow ? 'active now' : 'quiet' }}
        </v-chip>
        <span
          v-if="!item.sendingActiveNow && item.sendingQuietUntil"
          class="text-caption text-medium-emphasis d-block mt-1 cell-overflow"
          :title="item.sendingQuietUntil"
        >
          {{ item.sendingQuietUntil }}
        </span>
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
                <v-list-item title="Restore health" @click="restoreHealth(item._id)" />
                <v-list-item title="Auto-assign proxy" @click="autoAssignMtproxy(item._id)" />
                <v-list-item title="Active hours…" @click="openHoursEditor(item)" />
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
              clearable
              @update:model-value="(v) => setSelectedProxy(item._id, String(v ?? ''))"
            />
            <v-btn size="x-small" variant="tonal" color="primary" block @click="assignSelectedMtproxy(item._id)">
              Assign proxy
            </v-btn>
          </div>
        </div>
      </template>
    </v-data-table>

    <v-dialog v-model="hoursDialogOpen" max-width="520">
      <v-card v-if="hoursEditAccount">
        <v-card-title class="text-subtitle-1">Active hours — {{ hoursEditAccount.phone }}</v-card-title>
        <v-card-text>
          <v-tabs v-model="hoursMode" density="compact" class="mb-4">
            <v-tab value="regional">Regional preset</v-tab>
            <v-tab value="manual">Manual override</v-tab>
          </v-tabs>
          <v-window v-model="hoursMode">
            <v-window-item value="regional">
              <p class="text-caption text-medium-emphasis mb-3">
                Apply bundled quiet hours for a country (same as phone region by default).
              </p>
              <v-select
                v-model="hoursRegionIso"
                :items="regionItems"
                item-title="title"
                item-value="value"
                label="Region"
                variant="outlined"
                density="comfortable"
              />
            </v-window-item>
            <v-window-item value="manual">
              <p class="text-caption text-medium-emphasis mb-3">
                Custom window in local timezone. Campaign sends are skipped outside this range.
              </p>
              <v-row dense>
                <v-col cols="6">
                  <v-text-field v-model="hoursStart" label="Start (HH:MM)" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="6">
                  <v-text-field v-model="hoursEnd" label="End (HH:MM)" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12">
                  <v-text-field
                    v-model="hoursTimezone"
                    label="Timezone (IANA, e.g. Europe/Moscow)"
                    variant="outlined"
                    density="comfortable"
                  />
                </v-col>
              </v-row>
            </v-window-item>
          </v-window>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="hoursDialogOpen = false">Cancel</v-btn>
          <v-btn color="primary" :loading="hoursSaving" @click="saveHoursEditor">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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
  sendingResumesAtLocal?: string;
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
interface RegionRow {
  countryIso2: string;
  name: string;
  timezone: string;
  windowStart: string;
  windowEnd: string;
}

const { apiFetch } = useBasicAuth();
const toast = useToast();
const { confirm, confirmDestructive } = useConfirm();
const rows = ref<Account[]>([]);
const proxies = ref<ProxyRow[]>([]);
const selectedProxyByAccount = ref<Record<string, string>>({});
const regions = ref<RegionRow[]>([]);
const loadErr = ref('');
const loading = ref(true);
const autoAssigning = ref(false);
const importingTdata = ref(false);
const bulkImporting = ref(false);
const bulkImportSummary = ref('');
const importPhone = ref('');
const importTdataPath = ref('');
const importJsonPath = ref('');
const importRole = ref<'sender' | 'test_recipient'>('sender');
const hoursDialogOpen = ref(false);
const hoursEditAccount = ref<Account | null>(null);
const hoursMode = ref<'regional' | 'manual'>('regional');
const hoursRegionIso = ref('');
const hoursStart = ref('09:00');
const hoursEnd = ref('22:00');
const hoursTimezone = ref('Europe/Moscow');
const hoursSaving = ref(false);

const regionItems = computed(() =>
  regions.value.map((r) => ({
    title: `${r.countryIso2} — ${r.name} (${r.windowStart}–${r.windowEnd}, ${r.timezone})`,
    value: r.countryIso2,
  })),
);

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

function activeHoursTitle(item: Account): string {
  const sw = item.sendingWindow;
  if (!sw) return '';
  const quiet = item.sendingQuietUntil ? ` · ${item.sendingQuietUntil}` : '';
  return `${sw.start}–${sw.end} ${sw.timezone}${quiet}`;
}

function proxyOptionsForAccount(_accountId: string): ProxyRow[] {
  return proxies.value;
}

function setSelectedProxy(accountId: string, proxyId: string): void {
  selectedProxyByAccount.value[accountId] = proxyId;
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
  return p ? `${p.label} · ${p.type} (${p.country || '—'})` : String(proxyId);
}

async function load(): Promise<void> {
  try {
    loadErr.value = '';
    const [a, p] = await Promise.all([apiFetch<Account[]>('/api/accounts'), apiFetch<ProxyRow[]>('/api/proxies')]);
    rows.value = a;
    proxies.value = p;
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

async function importTdata(): Promise<void> {
  if (!importTdataPath.value.trim() || !importJsonPath.value.trim()) {
    toast.warning('tdata path and JSON path are required for tdata import.');
    return;
  }
  importingTdata.value = true;
  try {
    await apiFetch('/api/accounts/import-tdata', {
      method: 'POST',
      body: JSON.stringify({
        ...(importPhone.value.trim() ? { phone: importPhone.value.trim() } : {}),
        tdataPath: importTdataPath.value.trim(),
        jsonPath: importJsonPath.value.trim(),
        role: importRole.value,
      }),
    });
    toast.success('Sender imported. Proxy auto-assigned — confirm or send a test message.');
  } catch (e) {
    toast.error(errorText(e));
    console.error('import tdata failed', e);
  } finally {
    importingTdata.value = false;
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
    toast.warning('Select a proxy first.');
    return;
  }
  try {
    await apiFetch(`/api/accounts/${accountId}/assign-mtproxy`, {
      method: 'POST',
      body: JSON.stringify({ proxyId }),
    });
    toast.success('Proxy assigned.');
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
    toast.success('Proxy auto-assigned.');
    await load();
  } catch (e) {
    toast.error(errorText(e));
  }
}

async function restoreHealth(accountId: string): Promise<void> {
  try {
    await apiFetch(`/api/accounts/${accountId}/restore-health`, { method: 'POST' });
    toast.success('Health counters reset; score recomputed.');
    await load();
  } catch (e) {
    toast.error(errorText(e));
  }
}

function openHoursEditor(item: Account): void {
  hoursEditAccount.value = item;
  hoursMode.value = 'manual';
  hoursStart.value = item.sendingWindow?.start ?? '09:00';
  hoursEnd.value = item.sendingWindow?.end ?? '22:00';
  hoursTimezone.value = item.sendingWindow?.timezone ?? 'Europe/Moscow';
  hoursRegionIso.value = '';
  hoursDialogOpen.value = true;
}

async function saveHoursEditor(): Promise<void> {
  const acc = hoursEditAccount.value;
  if (!acc) return;
  hoursSaving.value = true;
  try {
    if (hoursMode.value === 'regional') {
      const iso = hoursRegionIso.value.trim().toUpperCase();
      if (!iso) {
        toast.warning('Pick a region.');
        return;
      }
      const r = regions.value.find((x) => x.countryIso2 === iso);
      if (!r) {
        toast.warning('Unknown region.');
        return;
      }
      await apiFetch(`/api/accounts/${acc._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          sendingWindow: { start: r.windowStart, end: r.windowEnd, timezone: r.timezone },
        }),
      });
    } else {
      const start = hoursStart.value.trim();
      const end = hoursEnd.value.trim();
      const timezone = hoursTimezone.value.trim();
      if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || !timezone) {
        toast.warning('Use HH:MM for start/end and a valid IANA timezone.');
        return;
      }
      await apiFetch(`/api/accounts/${acc._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          sendingWindow: { start, end, timezone },
        }),
      });
    }
    toast.success('Active hours updated.');
    hoursDialogOpen.value = false;
    await load();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    hoursSaving.value = false;
  }
}

async function clearMtproxy(accountId: string): Promise<void> {
  try {
    await apiFetch(`/api/accounts/${accountId}/assign-mtproxy`, {
      method: 'POST',
      body: JSON.stringify({ proxyId: null }),
    });
    toast.success('Proxy unassigned.');
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
