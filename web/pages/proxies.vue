<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4 font-weight-bold">Telegram proxies</h1>
      <v-spacer />
      <v-btn variant="text" :loading="loading" :disabled="loading" prepend-icon="mdi-refresh" @click="load">
        Refresh
      </v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Add and manage MTProto, SOCKS5, and HTTP endpoints used by sending accounts.
    </p>

    <v-card class="mb-6 pa-4" variant="outlined">
      <v-card-title class="text-subtitle-1 px-0 pt-0">Add proxy</v-card-title>
      <v-row dense>
        <v-col cols="12" md="2">
          <v-select
            v-model="type"
            :items="[
              { title: 'MTProto', value: 'mtproto' },
              { title: 'SOCKS5', value: 'socks5' },
              { title: 'HTTP', value: 'http' },
            ]"
            label="Type"
            variant="outlined"
            density="comfortable"
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-text-field v-model="label" label="Label" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="3">
          <v-text-field v-model="host" label="Host" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="2">
          <v-text-field v-model="port" label="Port" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="2">
          <v-text-field v-model="country" label="Country (ISO2)" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="2" v-if="type === 'mtproto'">
          <v-text-field v-model="secret" label="Secret (optional)" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="2" v-if="type !== 'mtproto'">
          <v-text-field v-model="login" label="Login (optional)" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="2" v-if="type !== 'mtproto'">
          <v-text-field
            v-model="password"
            label="Password (optional)"
            variant="outlined"
            density="comfortable"
          />
        </v-col>
      </v-row>
      <v-btn color="primary" :loading="saving" :disabled="saving" @click="addProxy">Add proxy</v-btn>
    </v-card>

    <BulkImportPanel
      title="Bulk import proxies"
      hint="CSV/JSON columns: label, type (mtproto|socks5|http), host, port, country, secret, login, password"
      button-label="Import proxies"
      :loading="bulkImporting"
      :result-summary="bulkImportSummary"
      @import="importProxiesBulk"
    >
      <template #extra-fields>
        <v-checkbox v-model="testAfterImport" label="Test each proxy after import" density="compact" class="mt-1" />
      </template>
    </BulkImportPanel>

    <v-btn color="secondary" variant="tonal" class="mb-4" :loading="testingAll" @click="testAllProxies">
      Test all proxies
    </v-btn>

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

    <v-card class="mb-4 pa-4" variant="tonal" color="primary">
      <v-card-title class="text-subtitle-1 px-0 pt-0">Proxy test</v-card-title>
      <p class="text-body-2 text-medium-emphasis mb-3">
        Tests reach Telegram through the proxy using a real sender session (recommended) or an empty session.
      </p>
      <v-select
        v-model="testAccountId"
        :items="senderAccounts"
        item-title="pickerLabel"
        item-value="_id"
        label="Sender account for test"
        variant="outlined"
        density="comfortable"
        clearable
        hint="Pick a logged-in sender to verify the proxy with the same API id/device as production"
        persistent-hint
        class="mb-0"
      />
    </v-card>

    <v-progress-circular v-if="loading && rows.length === 0" indeterminate />
    <v-alert v-else-if="!rows.length" type="info" variant="tonal" density="compact">
      No proxies yet. Add your first one above.
    </v-alert>
    <v-data-table
      v-else
      :headers="headers"
      :items="rows"
      :items-per-page="50"
      :class="DATA_TABLE_CLASS"
      density="compact"
    >
      <template #[`item.label`]="{ item }">
        <span class="cell-overflow" :title="item.label">{{ item.label }}</span>
      </template>
      <template #[`item.host`]="{ item }">
        <span class="cell-overflow font-mono" :title="item.host">{{ item.host }}</span>
      </template>
      <template #[`item.lastTest`]="{ item }">
        <span v-if="!item.lastTest" class="text-disabled">—</span>
        <span
          v-else
          class="cell-overflow"
          :class="item.lastTest.ok ? 'text-success' : 'text-error'"
          :title="`${item.lastTest.code || item.lastTest.stage}: ${item.lastTest.message}`"
        >
          {{ item.lastTest.ok ? 'ok' : 'fail' }}
          ({{ item.lastTest.durationMs }}ms)
        </span>
      </template>
      <template #[`item.actions`]="{ item }">
        <v-btn size="x-small" variant="text" @click="openEdit(item)">edit</v-btn>
        <v-btn
          size="x-small"
          variant="text"
          :loading="testingId === item._id"
          :disabled="!!testingId && testingId !== item._id"
          @click="testProxy(item)"
        >
          test
        </v-btn>
        <v-btn size="x-small" variant="text" color="error" @click="removeProxy(item._id)">del</v-btn>
      </template>
    </v-data-table>

    <v-dialog v-model="editOpen" max-width="760">
      <v-card>
        <v-card-title>Edit proxy</v-card-title>
        <v-card-text>
          <v-row dense>
            <v-col cols="12" md="3">
              <v-select
                v-model="editType"
                :items="[
                  { title: 'MTProto', value: 'mtproto' },
                  { title: 'SOCKS5', value: 'socks5' },
                  { title: 'HTTP', value: 'http' },
                ]"
                label="Type"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="editLabel" label="Label" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="editHost"
                label="Host or t.me/tg:// proxy link"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="editPort" label="Port" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="editCountry" label="Country (ISO2)" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" md="4" v-if="editType === 'mtproto'">
              <v-text-field v-model="editSecret" label="Secret" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" md="4" v-if="editType !== 'mtproto'">
              <v-text-field v-model="editLogin" label="Login (optional)" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" md="4" v-if="editType !== 'mtproto'">
              <v-text-field
                v-model="editPassword"
                label="Password (optional)"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="editOpen = false">Cancel</v-btn>
          <v-btn color="primary" :loading="editing" @click="saveEdit">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { errorText } from '~/composables/useToast';
import { DATA_TABLE_CLASS, fixedCol } from '~/utils/tableColumns';

interface ProxyTestResult {
  ok: boolean;
  stage: 'connected' | 'transport_failed' | 'bridge_error';
  code?: string;
  message: string;
  durationMs: number;
}

interface ProxyRow {
  _id: string;
  label: string;
  type: 'socks5' | 'http' | 'mtproto';
  host: string;
  port: number;
  country?: string;
  secret?: string;
  hasSecret?: boolean;
  hasLogin?: boolean;
  hasPassword?: boolean;
  lastTest?: ProxyTestResult;
}

const { apiFetch } = useBasicAuth();
const toast = useToast();
const { confirmDestructive } = useConfirm();
const rows = ref<ProxyRow[]>([]);
const loadErr = ref('');
const loading = ref(true);
const saving = ref(false);
const editing = ref(false);
const type = ref<'mtproto' | 'socks5' | 'http'>('mtproto');
const label = ref('');
const host = ref('');
const port = ref('443');
const country = ref('');
const secret = ref('');
const login = ref('');
const password = ref('');
const editOpen = ref(false);
const editId = ref('');
const editType = ref<'mtproto' | 'socks5' | 'http'>('mtproto');
const editLabel = ref('');
const editHost = ref('');
const editPort = ref('443');
const editCountry = ref('');
const editSecret = ref('');
const editLogin = ref('');
const editPassword = ref('');

const testingId = ref<string | null>(null);
const testAccountId = ref<string | null>(null);
const senderAccounts = ref<Array<{ _id: string; pickerLabel: string }>>([]);
const bulkImporting = ref(false);
const bulkImportSummary = ref('');
const testAfterImport = ref(false);
const testingAll = ref(false);

const headers = [
  fixedCol('Label', 'label', 100),
  fixedCol('Host', 'host', 160),
  fixedCol('Port', 'port', 64),
  fixedCol('CC', 'country', 56),
  fixedCol('Type', 'type', 72),
  fixedCol('Test', 'lastTest', 100, { sortable: false }),
  fixedCol('', 'actions', 120, { sortable: false, wrap: true }),
];

async function load(): Promise<void> {
  loading.value = true;
  loadErr.value = '';
  try {
    const [proxies, accounts] = await Promise.all([
      apiFetch<ProxyRow[]>('/api/proxies'),
      apiFetch<
        {
          _id: string;
          phone: string;
          label?: string;
          telegramUsername?: string;
          role?: string;
          hasSession?: boolean;
          sendable?: boolean;
        }[]
      >('/api/accounts'),
    ]);
    rows.value = proxies;
    senderAccounts.value = accounts
      .filter((a) => (a.role ?? 'sender') === 'sender' && a.hasSession)
      .map((a) => ({
        _id: a._id,
        pickerLabel: [
          a.phone,
          a.telegramUsername ? `@${a.telegramUsername}` : null,
          a.label ? `(${a.label})` : null,
          a.sendable ? null : '(not sendable)',
        ]
          .filter(Boolean)
          .join(' '),
      }));
    if (!testAccountId.value && senderAccounts.value[0]) {
      testAccountId.value = senderAccounts.value[0]._id;
    }
  } catch (e) {
    loadErr.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

async function addProxy(): Promise<void> {
  const portNum = Number.parseInt(port.value, 10);
  if (!host.value.trim() || !Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
    toast.warning('Provide a valid host and a port between 1 and 65535.');
    return;
  }
  saving.value = true;
  try {
    await apiFetch('/api/proxies', {
      method: 'POST',
      body: JSON.stringify({
        label: label.value.trim() || `mtproto-${host.value.trim()}:${portNum}`,
        type: type.value,
        host: host.value.trim(),
        port: portNum,
        country: country.value.trim().toUpperCase(),
        secret: type.value === 'mtproto' ? secret.value.trim() : undefined,
        login: type.value !== 'mtproto' ? login.value.trim() : undefined,
        password: type.value !== 'mtproto' ? password.value.trim() : undefined,
      }),
    });
    toast.success('Proxy saved.');
    label.value = '';
    host.value = '';
    port.value = '443';
    country.value = '';
    secret.value = '';
    login.value = '';
    password.value = '';
    await load();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    saving.value = false;
  }
}

async function importProxiesBulk(payload: { csv?: string; json?: string }): Promise<void> {
  bulkImporting.value = true;
  bulkImportSummary.value = '';
  try {
    const res = await apiFetch<{ imported: number; failed: number; results: Array<{ line: number; ok: boolean; label?: string; error?: string }> }>(
      '/api/proxies/import',
      {
        method: 'POST',
        body: JSON.stringify({ ...payload, testAfterImport: testAfterImport.value }),
      },
    );
    bulkImportSummary.value = `Imported ${res.imported}, failed ${res.failed}`;
    toast.success(bulkImportSummary.value);
    await load();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    bulkImporting.value = false;
  }
}

async function testAllProxies(): Promise<void> {
  testingAll.value = true;
  try {
    const res = await apiFetch<{ total: number; ok: number; results: ProxyTestResult[] }>(
      '/api/proxies/test-all',
      { method: 'POST' },
    );
    toast.info(`Proxy tests: ${res.ok}/${res.total} OK`);
    await load();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    testingAll.value = false;
  }
}

function openEdit(item: ProxyRow): void {
  editId.value = item._id;
  editType.value = item.type;
  editLabel.value = item.label || '';
  editHost.value = item.host || '';
  editPort.value = String(item.port || 443);
  editCountry.value = item.country || '';
  editSecret.value = '';
  editLogin.value = '';
  editPassword.value = '';
  editOpen.value = true;
}

async function saveEdit(): Promise<void> {
  const id = editId.value.trim();
  const portNum = Number.parseInt(editPort.value, 10);
  if (!id || !editHost.value.trim() || !Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
    toast.warning('Provide a valid host and port.');
    return;
  }
  editing.value = true;
  try {
    await apiFetch(`/api/proxies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        type: editType.value,
        label: editLabel.value.trim() || `mtproto-${editHost.value.trim()}:${portNum}`,
        host: editHost.value.trim(),
        port: portNum,
        country: editCountry.value.trim().toUpperCase(),
        ...(editType.value === 'mtproto' && editSecret.value.trim() ? { secret: editSecret.value.trim() } : {}),
        ...(editType.value !== 'mtproto' && editLogin.value.trim() ? { login: editLogin.value.trim() } : {}),
        ...(editType.value !== 'mtproto' && editPassword.value.trim()
          ? { password: editPassword.value.trim() }
          : {}),
      }),
    });
    toast.success('Proxy updated.');
    editOpen.value = false;
    await load();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    editing.value = false;
  }
}

async function testProxy(item: ProxyRow): Promise<void> {
  testingId.value = item._id;
  try {
    const result = await apiFetch<ProxyTestResult>(`/api/proxies/${item._id}/test`, {
      method: 'POST',
      body: JSON.stringify(testAccountId.value ? { accountId: testAccountId.value } : {}),
    });
    item.lastTest = result;
    if (result.ok) {
      toast.success(`Proxy reachable (${result.durationMs} ms).`);
    } else {
      toast.error(
        `Proxy ${result.stage === 'transport_failed' ? 'unreachable' : 'error'}: ${result.code ?? ''} ${result.message}`,
      );
    }
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    testingId.value = null;
  }
}

async function removeProxy(id: string): Promise<void> {
  const ok = await confirmDestructive('Delete this proxy?', 'This cannot be undone.');
  if (!ok) return;
  try {
    await apiFetch(`/api/proxies/${id}`, { method: 'DELETE' });
    toast.success('Proxy deleted.');
    await load();
  } catch (e) {
    toast.error(errorText(e));
  }
}

onMounted(() => {
  load();
});
</script>
