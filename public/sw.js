/* Service Worker — Web Push notif untuk SOHO Social House.
 * Handler:
 * - push: tampilkan notif OS dari payload {title, body, url}.
 * - notificationclick: fokus tab existing kalau ada, atau buka URL baru.
 */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "Notifikasi" };
  }
  const title = data.title || "SOHO Social House";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Fokus tab existing yg sudah di origin ini.
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) client.navigate(url);
            return;
          }
        }
        // Tidak ada tab → buka baru.
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
  );
});
