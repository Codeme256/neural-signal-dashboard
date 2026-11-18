import { buildPushPayload } from "@block65/webcrypto-web-push";

const site = "https://apex-signal-tank.davidmwesigwa71.workers.dev";
const authOrigin = "https://bidwlsrxpziemhsdkhsu.supabase.co";
const pushHosts = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "wns2-par02p.notify.windows.com"]);
const headers = { "access-control-allow-origin": site, "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "cache-control": "no-store", "content-type": "application/json" };
const response = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status, headers });

const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
async function vapid(db, create = false) {
  let row = await db.prepare("SELECT public_key, private_key FROM news_push_key WHERE id=1").first();
  if (!row && create) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicKey = base64url(await crypto.subtle.exportKey("raw", pair.publicKey));
    const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
    await db.prepare("INSERT OR IGNORE INTO news_push_key VALUES (1,?,?)").bind(publicKey,d).run();
    row = await db.prepare("SELECT public_key, private_key FROM news_push_key WHERE id=1").first();
  }
  return row && { subject: site, publicKey: row.public_key, privateKey: row.private_key };
}

function allowedEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password && !url.hash && pushHosts.has(url.hostname);
  } catch { return false; }
}

export async function handleNewsPush(request, env) {
  if (request.headers.get("Origin") !== site) return response({ error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return response(null, 204);
  if (!["GET", "POST", "DELETE"].includes(request.method)) return response({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization");
  const apikey = request.headers.get("apikey");
  if (!authorization?.startsWith("Bearer ") || !apikey) return response({ error: "Sign in first" }, 401);
  try {
    const userResponse = await fetch(authOrigin + "/auth/v1/user", { headers: { authorization, apikey }, redirect: "error" });
    if (!userResponse.ok) return response({ error: "Sign in again to manage phone alerts" }, 401);
    const { id } = await userResponse.json();
    if (typeof id !== "string" || !id) return response({ error: "Account unavailable" }, 401);
    const db = env.TRADEPULSE_DB;
    if (request.method === "GET") return response({ publicKey: (await vapid(db, true)).publicKey });
    const body = await request.json().catch(() => null);
    if (!allowedEndpoint(body?.endpoint)) return response({ error: "Unsupported browser push endpoint" }, 400);
    if (request.method === "DELETE") {
      await db.prepare("DELETE FROM news_push_devices WHERE endpoint=? AND owner=?").bind(body.endpoint,id).run();
      return response({ enabled:false });
    }
    const { p256dh, auth } = body.keys ?? {};
    if (!/^[\w-]{87}$/.test(p256dh ?? "") || !/^[\w-]{22}$/.test(auth ?? "")) {
      return response({ error: "Invalid browser subscription" }, 400);
    }
    const result = await db.prepare(
      "INSERT INTO news_push_devices (endpoint,owner,p256dh,auth) SELECT ?,?,?,? WHERE " +
      "EXISTS (SELECT 1 FROM news_push_devices WHERE endpoint=? AND owner=?) OR " +
      "(SELECT COUNT(*) FROM news_push_devices WHERE owner=?)<5 " +
      "ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth WHERE owner=excluded.owner"
    ).bind(body.endpoint,id,p256dh,auth,body.endpoint,id,id).run();
    if (!result.meta?.changes) return response({ error: "Device limit reached or device registered by another account" }, 409);
    return response({ enabled:true });
  } catch { return response({ error: "Phone alert service unavailable" }, 503); }
}

export async function sendScheduledNewsPush(db, events, now) {
  const keys = await vapid(db);
  if (!keys) return { sent:0, failed:0 };
  const { results: devices = [] } = await db.prepare("SELECT endpoint,p256dh,auth FROM news_push_devices").all();
  await db.prepare("DELETE FROM news_push_delivery WHERE sent_at<?").bind(now-7*86400000).run();
  let sent = 0, failed = 0;
  for (const event of events) {
    const elapsed = (now - Date.parse(event.scheduledAt)) / 60000;
    const stage = elapsed >= -18 && elapsed <= -5 && event.actual == null ? "T15" :
      now >= Math.ceil(Date.parse(event.scheduledAt) / 300000) * 300000 + 900000 && elapsed < 30 ? "REACTION" : null;
    if (!stage) continue;
    const data = JSON.stringify({
      title: stage === "T15" ? "TradePulse · High-impact news soon" : "TradePulse · Check post-news price movement",
      body: event.currency + " · " + event.event + (stage === "REACTION" ? " · Open the M5 and 15-minute reaction" : ""),
      eventId: event.id,
      pair: event.affected.includes("XAUUSD") ? "XAUUSD" : event.affected[0],
      stage,
    });
    for (let i=0; i<devices.length; i+=4) {
      await Promise.all(devices.slice(i,i+4).map(async device => {
        if (!allowedEndpoint(device.endpoint)) return;
        const claim = await db.prepare("INSERT OR IGNORE INTO news_push_delivery VALUES (?,?,?,?)")
          .bind(event.id,stage,device.endpoint,now).run();
        if (!claim.meta?.changes) return;
        try {
          const subscription = { endpoint:device.endpoint, expirationTime:null, keys:{ p256dh:device.p256dh, auth:device.auth } };
          const payload = await buildPushPayload({ data, options:{ ttl:300 } }, subscription, keys);
          const result = await fetch(device.endpoint, { ...payload, redirect:"error" });
          await result.body?.cancel();
          if (result.status === 404 || result.status === 410) {
            await db.prepare("DELETE FROM news_push_devices WHERE endpoint=?").bind(device.endpoint).run();
          } else if (!result.ok) {
            throw Error("Push service rejected notification");
          } else {
            sent++;
          }
        } catch {
          failed++;
          await db.prepare("DELETE FROM news_push_delivery WHERE event_id=? AND stage=? AND endpoint=?")
            .bind(event.id,stage,device.endpoint).run();
        }
      }));
    }
  }
  return { sent, failed };
}
