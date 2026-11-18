import { supabase } from "@/integrations/supabase/client";

const endpoint = "https://tradepulse-telegram-service.davidmwesigwa71.workers.dev/news/push";
const worker = "/tradepulse-push.js";
export const supportsNewsPush = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function manage(method: "GET" | "POST" | "DELETE", body?: PushSubscriptionJSON) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw Error("Sign in to manage phone alerts.");
  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: "Bearer " + data.session.access_token,
      apikey: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
      "Content-Type": "application/json",
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? "Phone alerts could not be updated.");
  return result as { publicKey?: string };
}

export async function phoneNewsPushEnabled() {
  if (!supportsNewsPush() || Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return !!registration && !!await registration.pushManager.getSubscription() &&
    localStorage.getItem("tradepulse-phone-news") === "on";
}

export async function setPhoneNewsPush(enabled: boolean) {
  if (!supportsNewsPush()) throw Error("This browser does not support Web Push.");
  if (!enabled) {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await manage("DELETE", subscription.toJSON());
      await subscription.unsubscribe();
    }
    localStorage.removeItem("tradepulse-phone-news");
    return;
  }
  if (await Notification.requestPermission() !== "granted") throw Error("Allow notifications in your browser settings to enable phone alerts.");
  const { publicKey } = await manage("GET");
  if (!publicKey) throw Error("Phone alerts are not configured.");
  await navigator.serviceWorker.register(worker);
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription() ??
    await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
  await manage("POST", subscription.toJSON());
  localStorage.setItem("tradepulse-phone-news", "on");
}
