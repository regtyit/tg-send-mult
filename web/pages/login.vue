<template>
  <v-app>
    <v-main class="d-flex align-center justify-center min-vh-100 bg-surface">
      <v-card class="pa-6" max-width="420" width="100%">
        <v-card-title class="text-h5 font-weight-bold"> tg-send-mult </v-card-title>
        <v-card-subtitle> HTTP Basic (same credentials as the API) </v-card-subtitle>
        <v-card-text>
          <v-alert
            v-if="err"
            :type="errKind"
            variant="tonal"
            class="mb-4"
            density="compact"
            role="alert"
            aria-live="assertive"
          >
            {{ err }}
          </v-alert>
          <v-form @submit.prevent="submit">
            <v-text-field
              v-model="user"
              label="User"
              autocomplete="username"
              class="mb-2"
              :disabled="loading"
              autofocus
            />
            <v-text-field
              v-model="password"
              label="Password"
              type="password"
              autocomplete="current-password"
              class="mb-4"
              :disabled="loading"
            />
            <v-btn
              type="submit"
              color="primary"
              block
              size="large"
              :loading="loading"
              :disabled="loading"
            >
              Save &amp; continue
            </v-btn>
          </v-form>
        </v-card-text>
      </v-card>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ApiError } from '~/composables/useApi';

definePageMeta({ layout: false });

const user = ref('');
const password = ref('');
const err = ref('');
const errKind = ref<'error' | 'warning'>('error');
const loading = ref(false);
const router = useRouter();
const { saveAuth, clearAuth, apiFetch } = useBasicAuth();

async function submit(): Promise<void> {
  err.value = '';
  loading.value = true;
  saveAuth(user.value, password.value);
  try {
    await apiFetch('/api/accounts');
  } catch (e) {
    clearAuth();
    if (e instanceof ApiError) {
      if (e.isNetwork) {
        errKind.value = 'warning';
        err.value = `Could not reach the API (${e.message}). Check that the server is running.`;
      } else if (e.status === 401) {
        errKind.value = 'error';
        err.value = 'Invalid credentials.';
      } else {
        errKind.value = 'error';
        err.value = `Server returned ${e.status}: ${e.message}`;
      }
    } else {
      errKind.value = 'error';
      err.value = e instanceof Error ? e.message : 'Login failed';
    }
    loading.value = false;
    return;
  }
  await router.replace('/accounts');
}
</script>
