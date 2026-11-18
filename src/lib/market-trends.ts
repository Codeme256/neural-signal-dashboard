import type { Ohlc } from "./strategies/types";

const DAY = 86_400_000;
const monthStart = (time: number, offset = 0) => {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1);
};

export function monthlyTrend(candles: Ohlc[], now: number) {
  const currentMonth = monthStart(now);
  const months: Ohlc[] = [];
  for (const candle of candles) {
    if (candle.time + DAY > now) continue;
    const time = monthStart(candle.time);
    const month = months.at(-1);
    if (month?.time === time) {
      month.high = Math.max(month.high, candle.high);
      month.low = Math.min(month.low, candle.low);
      month.close = candle.close;
    } else {
      months.push({ ...candle, time });
    }
  }
  // The first bucket may start partway through a month because history is capped.
  const closed = months.slice(1).filter((month) => month.time < currentMonth);
  const latest = closed.at(-1);
  const previous = closed.at(-2);
  if (latest?.time !== monthStart(now, -1) || previous?.time !== monthStart(now, -2)) return null;

  const bullish = latest.high > previous.high && latest.low > previous.low && latest.close > previous.close;
  const bearish = latest.high < previous.high && latest.low < previous.low && latest.close < previous.close;
  const developing = months.at(-1)?.time === currentMonth ? months.at(-1) : undefined;
  return {
    latest,
    direction: bullish ? "Bullish" : bearish ? "Bearish" : "Mixed",
    closedChange: (latest.close / previous.close - 1) * 100,
    developingChange: developing ? (developing.close / latest.close - 1) * 100 : null,
  };
}
