<template>
  <div>
    <div class="d-flex align-center mb-2">
      <h1 class="text-h4 font-weight-bold">Recipients (contacts)</h1>
      <v-spacer />
      <v-btn variant="text" :loading="polling" :disabled="polling" prepend-icon="mdi-refresh" @click="refresh">
        Refresh
      </v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">
      People you may message in campaigns — imported by phone. This is <strong>not</strong> the list of Telegram accounts that send mail (see
      <NuxtLink to="/accounts" class="text-primary">Senders</NuxtLink>).
    </p>
    <p class="text-caption text-medium-emphasis mb-4">
      Import supports phone or Telegram username (for example in `phone` or `username` column: `@meow1502`).
    </p>

    <v-card class="mb-6 pa-4">
      <v-card-title class="text-subtitle-1 px-0 pt-0">Add one recipient</v-card-title>
      <v-row dense class="mb-2">
        <v-col cols="12" md="4">
          <v-text-field
            v-model="singlePhoneOrUsername"
            label="Phone or @username"
            variant="outlined"
            density="comfortable"
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-text-field v-model="singleFirstName" label="First name" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="3">
          <v-text-field v-model="singleTags" label="Tags (comma)" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" md="2">
          <v-btn color="primary" block :loading="addingOne" :disabled="addingOne" @click="addOne">
            Add contact
          </v-btn>
        </v-col>
      </v-row>
    </v-card>

    <v-card class="mb-6 pa-4">
      <v-card-title class="text-subtitle-1 px-0 pt-0">Import CSV</v-card-title>
      <v-textarea v-model="csv" rows="6" variant="outlined" class="mb-2" label="CSV content" />
      <v-text-field
        v-model="tags"
        label="Tags (comma-separated)"
        variant="outlined"
        density="comfortable"
        class="mb-4"
      />
      <v-btn color="primary" :loading="importing" :disabled="importing" @click="importCsv">Import</v-btn>
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
      Failed to load contacts: {{ loadErr }}
    </v-alert>

    <v-row dense class="mb-2">
      <v-col cols="12" md="4">
        <v-text-field
          v-model="searchQuery"
          label="Search phone / username / name"
          variant="outlined"
          density="comfortable"
          clearable
          prepend-inner-icon="mdi-magnify"
          @update:model-value="onSearchChange"
        />
      </v-col>
      <v-col cols="12" md="3">
        <v-text-field
          v-model="searchTag"
          label="Filter by tag"
          variant="outlined"
          density="comfortable"
          clearable
          @update:model-value="onSearchChange"
        />
      </v-col>
    </v-row>

    <v-progress-circular v-if="loading && rows.length === 0" indeterminate />
    <v-alert v-else-if="!rows.length && !loading" type="info" variant="tonal" density="compact">
      No contacts match your filters.
    </v-alert>
    <v-data-table-server
      v-else
      :headers="headers"
      :items="rows"
      :items-length="totalRows"
      :items-per-page="pageSize"
      :page="page"
      :loading="polling"
      class="elevation-1 rounded"
      density="comfortable"
      :items-per-page-options="[25, 50, 100, 200]"
      @update:page="(p: number) => { page = p; load(); }"
      @update:items-per-page="(n: number) => { pageSize = n; page = 1; load(); }"
    >
      <template #[`item.tags`]="{ item }">
        {{ (item.tags ?? []).join(', ') }}
      </template>
      <template #[`item.username`]="{ item }">
        <span v-if="item.username">@{{ item.username }}</span>
        <span v-else class="text-medium-emphasis">—</span>
      </template>
      <template #[`item.actions`]="{ item }">
        <v-btn size="small" variant="text" color="error" @click="removeContact(item._id)">delete</v-btn>
      </template>
    </v-data-table-server>
  </div>
</template>

<script setup lang="ts">
import { errorText } from '~/composables/useToast';

interface Contact {
  _id: string;
  phoneE164: string;
  username?: string;
  firstName?: string;
  status?: string;
  tags?: string[];
}

const { apiFetch } = useBasicAuth();
const toast = useToast();
const { confirmDestructive } = useConfirm();
const rows = ref<Contact[]>([]);
const totalRows = ref(0);
const page = ref(1);
const pageSize = ref(50);
const searchQuery = ref('');
const searchTag = ref('');
const csv = ref('phone,firstName\n+79991234567,Test');
const tags = ref('');
const singlePhoneOrUsername = ref('');
const singleFirstName = ref('');
const singleTags = ref('');
const loadErr = ref('');
const loading = ref(true);
const addingOne = ref(false);
const importing = ref(false);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearchChange(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    load();
  }, 250);
}

const headers = [
  { title: 'Phone', key: 'phoneE164' },
  { title: 'Username', key: 'username' },
  { title: 'Name', key: 'firstName' },
  { title: 'Status', key: 'status' },
  { title: 'Tags', key: 'tags' },
  { title: 'Actions', key: 'actions', sortable: false },
];

async function load(): Promise<void> {
  try {
    loadErr.value = '';
    const params = new URLSearchParams({
      paginated: '1',
      limit: String(pageSize.value),
      skip: String((page.value - 1) * pageSize.value),
    });
    if (searchQuery.value.trim()) params.set('q', searchQuery.value.trim());
    if (searchTag.value.trim()) params.set('tag', searchTag.value.trim());
    const res = await apiFetch<{ items: Contact[]; total: number }>(
      `/api/contacts?${params.toString()}`,
    );
    rows.value = res.items;
    totalRows.value = res.total;
  } catch (e) {
    loadErr.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

const { running: polling, refresh } = usePolling(load, { intervalMs: 15000 });

async function importCsv(): Promise<void> {
  importing.value = true;
  try {
    const res = await apiFetch<{ upserted: number; invalid: number }>('/api/contacts/import', {
      method: 'POST',
      body: JSON.stringify({
        csv: csv.value,
        tags: tags.value ? tags.value.split(',').map((t) => t.trim()) : [],
      }),
    });
    if (res.invalid > 0) {
      toast.warning(`Imported: ${res.upserted}, invalid: ${res.invalid}`);
    } else {
      toast.success(`Imported: ${res.upserted}`);
    }
    await load();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    importing.value = false;
  }
}

async function addOne(): Promise<void> {
  const token = singlePhoneOrUsername.value.trim();
  if (!token) {
    toast.warning('Enter phone or @username.');
    return;
  }
  const row = token.startsWith('@')
    ? { username: token, firstName: singleFirstName.value.trim(), tags: singleTags.value.trim() }
    : { phone: token, firstName: singleFirstName.value.trim(), tags: singleTags.value.trim() };
  addingOne.value = true;
  try {
    const res = await apiFetch<{ upserted: number; invalid: number }>('/api/contacts/import', {
      method: 'POST',
      body: JSON.stringify({ json: JSON.stringify([row]) }),
    });
    if (res.invalid > 0) {
      toast.warning(`Added: ${res.upserted}, invalid: ${res.invalid}`);
    } else {
      toast.success(`Added: ${res.upserted}`);
    }
    if (res.upserted > 0) {
      singlePhoneOrUsername.value = '';
      singleFirstName.value = '';
      singleTags.value = '';
    }
    await load();
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    addingOne.value = false;
  }
}

async function removeContact(id: string): Promise<void> {
  const ok = await confirmDestructive('Delete this recipient?', 'This cannot be undone.');
  if (!ok) return;
  try {
    await apiFetch(`/api/contacts/${id}`, { method: 'DELETE' });
    toast.success('Recipient deleted.');
    await load();
  } catch (e) {
    toast.error(errorText(e));
  }
}
</script>
