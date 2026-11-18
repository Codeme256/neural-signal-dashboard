self.addEventListener("push", (event) => {
  let message;
  try { message = event.data?.json(); } catch { return; }
  if (!message?.title || !message?.eventId) return;
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    icon: "/tradepulse-mark.svg",
    tag: "tradepulse-news-" + message.eventId + "-" + message.stage,
    data: { eventId: message.eventId, pair: message.pair },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL("/news", self.location.origin);
  const { eventId, pair } = event.notification.data ?? {};
  if (eventId) url.searchParams.set("event", eventId);
  if (pair) url.searchParams.set("pair", pair);
  event.waitUntil(self.clients.openWindow(url.href));
});
