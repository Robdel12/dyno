self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  let url = new URL(event.request.url);
  if (
    !['/__dyno__/operations', '/__dyno__/attachments/commit'].includes(url.pathname) ||
    event.request.method !== 'POST'
  )
    return;
  event.respondWith(
    (async () => {
      let input = await event.request.clone().json();
      if (input.operation === 'screenshot' && input.name === 'host resize race') {
        await fetch('/api/capture-before', { method: 'POST' });
        await fetch('/api/release-capture');
      }
      let response = await fetch(event.request);
      if (url.pathname.endsWith('/attachments/commit') && response.ok) {
        await fetch('/api/capture-committed', { method: 'POST' });
        await fetch('/api/release-capture');
      }
      if (input.operation === 'screenshot' && input.name === 'navigation race' && response.ok) {
        await fetch('/api/capture-staged', { method: 'POST' });
        await fetch('/api/release-capture');
      }
      return response;
    })()
  );
});
