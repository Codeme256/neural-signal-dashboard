// Public read-only Deriv API: no account credentials or trading operations.
const WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const TIMEOUT = 12000;
/** Max simultaneous requests on the socket; extra requests wait in a queue. */
const MAX_IN_FLIGHT = 4;

export class DerivError extends Error {
  constructor(message: string, readonly code: string, readonly disconnected = false) { super(message); }
}

export const isAbortError = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const abortError = () => new DOMException('Request cancelled', 'AbortError');

let socket: WebSocket | undefined;
let connecting: Promise<WebSocket> | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

async function connection(): Promise<WebSocket> {
  if (typeof window === 'undefined') throw new Error('Deriv connects after page hydration');
  if (socket?.readyState === WebSocket.OPEN) return socket;
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => { ws.close(); reject(new DerivError('Deriv connection timed out', 'Timeout', true)); connecting = undefined; }, TIMEOUT);
    ws.onopen = () => { clearTimeout(timer); socket = ws; connecting = undefined; resolve(ws); };
    ws.onmessage = event => {
      try {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        const id = Number(message['req_id']);
        const request = pending.get(id);
        if (!request) return;
        clearTimeout(request.timer); pending.delete(id);
        const err = message['error'] as { code?: string; message?: string } | undefined;
        if (err) request.reject(new DerivError(err.message || 'Deriv could not provide this market data', err.code || 'DerivError'));
        else request.resolve(message);
      } catch { /* Ignore unrelated malformed messages. */ }
    };
    const fail = () => {
      clearTimeout(timer);
      if (connecting) { connecting = undefined; reject(new DerivError('Deriv connection unavailable', 'Disconnected', true)); }
      if (socket === ws) socket = undefined;
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new DerivError('Deriv disconnected', 'Disconnected', true)); }
      pending.clear();
    };
    ws.onerror = fail;
    ws.onclose = fail;
  });
  return connecting;
}

// ---- simple request throttle (limited concurrency, abortable while queued) ----
let active = 0;
const queue: (() => void)[] = [];

function acquire(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (active < MAX_IN_FLIGHT) { active++; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const go = () => { signal?.removeEventListener('abort', onAbort); active++; resolve(); };
    const onAbort = () => { const i = queue.indexOf(go); if (i >= 0) queue.splice(i, 1); reject(abortError()); };
    queue.push(go);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function release() { active--; queue.shift()?.(); }

async function send(body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const ws = await connection();
  if (signal?.aborted) throw abortError();
  const req_id = nextId++;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => { const p = pending.get(req_id); if (p) { clearTimeout(p.timer); pending.delete(req_id); } reject(abortError()); };
    const timer = setTimeout(() => { pending.delete(req_id); cleanup(); reject(new DerivError('Deriv request timed out', 'Timeout')); }, TIMEOUT);
    pending.set(req_id, { resolve: v => { cleanup(); resolve(v); }, reject: e => { cleanup(); reject(e); }, timer });
    signal?.addEventListener('abort', onAbort, { once: true });
    try { ws.send(JSON.stringify({ ...body, req_id })); }
    catch { clearTimeout(timer); pending.delete(req_id); cleanup(); reject(new DerivError('Deriv disconnected', 'Disconnected', true)); }
  });
}

/** Throttled request; reconnects and retries once if the socket dropped. */
export async function derivRequest(body: Record<string, unknown>, opts: { signal?: AbortSignal | undefined } = {}): Promise<Record<string, unknown>> {
  await acquire(opts.signal);
  try {
    for (let attempt = 0; ; attempt++) {
      try { return await send(body, opts.signal); }
      catch (e) {
        if (attempt >= 1 || isAbortError(e) || !(e instanceof DerivError && e.disconnected)) throw e;
        await new Promise(r => setTimeout(r, 1000));
        if (opts.signal?.aborted) throw abortError();
      }
    }
  } finally { release(); }
}
