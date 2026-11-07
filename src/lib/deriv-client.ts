// Public read-only Deriv API: no account credentials or trading operations.
let socket: WebSocket | undefined;
let connecting: Promise<WebSocket> | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

async function connection(): Promise<WebSocket> {
  if (typeof window === 'undefined') throw new Error('Deriv connects after page hydration');
  if (socket?.readyState === WebSocket.OPEN) return socket;
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
    const timer = setTimeout(() => { ws.close(); reject(new Error('Deriv connection timed out')); connecting = undefined; }, 12000);
    ws.onopen = () => { clearTimeout(timer); socket = ws; connecting = undefined; resolve(ws); };
    ws.onmessage = event => {
      try {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        const id = Number(message['req_id']);
        const request = pending.get(id);
        if (!request) return;
        clearTimeout(request.timer); pending.delete(id);
        if (message['error']) request.reject(new Error('Deriv could not provide this market data'));
        else request.resolve(message);
      } catch { /* Ignore unrelated malformed messages. */ }
    };
    const fail = () => { clearTimeout(timer); connecting = undefined; socket = undefined; reject(new Error('Deriv connection unavailable')); for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Deriv disconnected')); } pending.clear(); };
    ws.onerror = fail;
    ws.onclose = fail;
  });
  return connecting;
}

export async function derivRequest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ws = await connection();
  const req_id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(req_id); reject(new Error('Deriv request timed out')); }, 12000);
    pending.set(req_id, { resolve, reject, timer });
    try { ws.send(JSON.stringify({ ...body, req_id })); }
    catch { clearTimeout(timer); pending.delete(req_id); reject(new Error('Deriv disconnected')); }
  });
}