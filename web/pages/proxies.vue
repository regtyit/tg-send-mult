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

    <v-progress-circular v-if="loading && rows.length === 0" indeterminate />
    <v-alert v-else-if="!rows.length" type="info" variant="tonal" density="compact">
      No proxies yet. Add your first one above.
    </v-alert>
    <v-data-table
      v-else
      :headers="headers"
      :items="rows"
      :items-per-page="50"
      class="elevation-1 rounded"
    >
      <template #[`item.actions`]="{ item }">
        <v-btn size="small" variant="text" @click="openEdit(item)">edit</v-btn>
        <v-btn
          size="small"
          variant="text"
          :loading="testingId === item._id"
          :disabled="!!testingId && testingId !== item._id"
          @click="testProxy(item)"
        >
          test
        </v-btn>
        <v-btn size="small" variant="text" color="error" @click="removeProxy(item._id)">delete</v-btn>
      </template>
      <template #[`item.lastTest`]="{ item }">
        <span v-if="!item.lastTest" class="text-disabled">—</span>
        <span v-else :class="item.lastTest.ok ? 'text-success' : 'text-error'">
          {{ item.lastTest.ok ? 'reachable' : 'unreachable' }}
          <span class="text-disabled">({{ item.lastTest.code || item.lastTest.stage }} · {{ item.lastTest.durationMs }}ms)</span>
        </span>
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

const headers = [
  { title: 'Label', key: 'label' },
  { title: 'Host', key: 'host' },
  { title: 'Port', key: 'port' },
  { title: 'Country', key: 'country' },
  { title: 'Type', key: 'type' },
  { title: 'Last test', key: 'lastTest', sortable: false },
  { title: 'Actions', key: 'actions', sortable: false },
];

async function load(): Promise<void> {
  loading.value = true;
  loadErr.value = '';
  try {
    rows.value = await apiFetch<ProxyRow[]>('/api/proxies');
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
