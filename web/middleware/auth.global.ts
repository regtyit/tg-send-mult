export default defineNuxtRouteMiddleware((to) => {
  if (!import.meta.client) return;
  if (to.path === '/login') return;
  const { hasAuth } = useBasicAuth();
  if (!hasAuth()) {
    return navigateTo('/login');
  }
});
