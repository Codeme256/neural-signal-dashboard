import { describe, expect, it } from "vitest";
import worker from "./worker";

const noopDb = {
  prepare(_sql:string) {
    return {
      all: async () => ({ results:[{
        id:"index-test",symbol:"US500",strategy:"Trend Continuation",
        direction:"BUY",timeframe:"M15",candle_time:1790000000000,
        created_at:1790000000000,expires_at:1790000900000,
        entry:100,stop_loss:99,tp1:101,tp2:102,quality_score:70,
      }] }),
    };
  },
};
describe("independent index alert worker read API", () => {
  it("does not expose publishing secrets in health response",async () => {
    const res=await worker.fetch(new Request("https://alerts.example/health"),{
      TRADEPULSE_DB:noopDb,TRADEPULSE_PUBLISH_SECRET:"private-value",
      TELEGRAM_PUBLISH_URL:"https://telegram.example/publish",
    } as never);
    const body=await res.text();
    expect(res.status).toBe(200);
    expect(body).not.toContain("private-value");
  });
  it("rejects a cross-origin website request",async () => {
    const res=await worker.fetch(new Request("https://alerts.example/alerts",{headers:{Origin:"https://untrusted.example"}}),{
      TRADEPULSE_DB:noopDb,CORS_ORIGIN:"https://apex-signal-tank.davidmwesigwa71.workers.dev",
    } as never);
    expect(res.status).toBe(403);
  });
  it("returns market-only data with allowed origin",async () => {
    const origin="https://apex-signal-tank.davidmwesigwa71.workers.dev";
    const res=await worker.fetch(new Request("https://alerts.example/alerts",{headers:{Origin:origin}}),{
      TRADEPULSE_DB:noopDb,CORS_ORIGIN:origin,
    } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    const json=await res.json() as {alerts:{symbol:string}[]};
    expect(json.alerts[0]?.symbol).toBe("US500");
  });
});
