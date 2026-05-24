<template>
  <v-layout class="rounded rounded-md overflow-visible">
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <v-app-bar color="surface" elevation="1" border>
      <v-app-bar-title class="text-primary font-weight-bold"> tg-send-mult </v-app-bar-title>
      <nav aria-label="Primary" class="d-flex">
        <v-btn
          v-for="item in navInternal"
          :key="item.to"
          :to="item.to"
          variant="text"
          class="text-capitalize"
          :aria-label="`Go to ${item.title}`"
        >
          {{ item.title }}
        </v-btn>
      </nav>
      <v-spacer />
      <v-btn
        href="/admin/queues"
        target="_blank"
        rel="noopener noreferrer"
        variant="text"
        aria-label="Open BullMQ admin queues in a new tab"
      >
        Queues
      </v-btn>
      <v-btn variant="text" class="text-medium-emphasis" aria-label="Log out" @click="logout">
        Log out
      </v-btn>
    </v-app-bar>
    <v-main id="main-content" class="bg-surface" tabindex="-1">
      <v-container fluid class="py-6">
        <slot />
      </v-container>
    </v-main>
  </v-layout>
</template>

<script setup lang="ts">
const { clearAuth } = useBasicAuth();
const router = useRouter();

const navInternal = [
  { title: 'Senders', to: '/accounts' },
  { title: 'MTProto', to: '/proxies' },
  { title: 'Contacts', to: '/contacts' },
  { title: 'Templates', to: '/templates' },
  { title: 'Campaigns', to: '/campaigns' },
  { title: 'Dialogs', to: '/dialogs' },
];

async function logout(): Promise<void> {
  clearAuth();
  await router.replace('/login');
}
</script>

<style scoped>
.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 100;
  padding: 8px 16px;
  background: #1976d2;
  color: white;
  text-decoration: none;
}
.skip-link:focus {
  left: 8px;
  top: 8px;
}
</style>
