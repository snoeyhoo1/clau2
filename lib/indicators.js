// lib/indicators.js
// Pure technical indicators.
// No network/API calls.
// All arrays: oldest -> newest.

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = -100, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function sma(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) {
    return null;
  }

  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + finite(b), 0) / period;
}

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) {
    return null;
  }

  const k = 2 / (period + 1);
  let value = sma(values.slice(0, period), period);

  for (let i = period; i < values.length; i++) {
    value = finite(values[i]) * k + value * (1 - k);
  }

  return value;
}

function emaSeries(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) {
    return [];
  }

  const k = 2 / (period + 1);
  const result = [];

  let value = sma(values.slice(0, period), period);
  result.push(value);

  for (let i = period; i < values.length; i++) {
    value = finite(values[i]) * k + value * (1 - k);
    result.push(value);
  }

  return result;
}

function rsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) {
    return null;
  }

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = finite(closes[i]) - finite(closes[i - 1]);

    if (diff > 0) gain += diff;
    else loss -= diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = finite(closes[i]) - finite(closes[i - 1]);

    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? -diff : 0;

    avgGain =
      (avgGain * (period - 1) + currentGain) / period;

    avgLoss =
      (avgLoss * (period - 1) + currentLoss) / period;
  }

  if (avgLoss === 0) {
    return avgGain > 0 ? 100 : 50;
  }

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function rsiSeries(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) {
    return [];
  }

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = finite(closes[i]) - finite(closes[i - 1]);

    if (diff > 0) gain += diff;
    else loss -= diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  const result = [
    avgLoss === 0
      ? avgGain > 0
        ? 100
        : 50
      : 100 - 100 / (1 + avgGain / avgLoss),
  ];

  for (let i = period + 1; i < closes.length; i++) {
    const diff = finite(closes[i]) - finite(closes[i - 1]);

    avgGain =
      (avgGain * (period - 1) + (diff > 0 ? diff : 0)) /
      period;

    avgLoss =
      (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) /
      period;

    result.push(
      avgLoss === 0
        ? avgGain > 0
          ? 100
          : 50
        : 100 - 100 / (1 + avgGain / avgLoss)
    );
  }

  return result;
}

function macd(
  closes,
  fast = 12,
  slow = 26,
  signalPeriod = 9
) {
  if (!Array.isArray(closes) || closes.length < slow + signalPeriod) {
    return null;
  }

  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);

  const offset = fastSeries.length - slowSeries.length;

  const macdLine = slowSeries.map(
    (value, i) => fastSeries[i + offset] - value
  );

  const signalLine = emaSeries(macdLine, signalPeriod);

  if (!signalLine.length) return null;

  const signalOffset = macdLine.length - signalLine.length;

  const histogram = signalLine.map(
    (value, i) => macdLine[i + signalOffset] - value
  );

  return {
    macd: macdLine.at(-1),
    signal: signalLine.at(-1),
    histogram: histogram.at(-1),
    macdLine,
    signalLine,
    histogramSeries: histogram,
  };
}

function bollingerBands(
  closes,
  period = 20,
  multiplier = 2
) {
  if (!Array.isArray(closes) || closes.length < period) {
    return null;
  }

  const slice = closes.slice(-period);
  const middle = sma(slice, period);

  const variance =
    slice.reduce(
      (sum, value) =>
        sum + (finite(value) - middle) ** 2,
      0
    ) / period;

  const stdDev = Math.sqrt(variance);

  const upper = middle + multiplier * stdDev;
  const lower = middle - multiplier * stdDev;
  const price = finite(closes.at(-1));

  return {
    upper,
    middle,
    lower,
    stdDev,
    width:
      middle !== 0
        ? ((upper - lower) / middle) * 100
        : 0,
    percentB:
      upper !== lower
        ? (price - lower) / (upper - lower)
        : 0,
  };
}

function trueRange(high, low, previousClose) {
  const h = finite(high);
  const l = finite(low);
  const pc = finite(previousClose);

  return Math.max(
    h - l,
    Math.abs(h - pc),
    Math.abs(l - pc)
  );
}

function atrSeries(highs, lows, closes, period = 14) {
  if (
    !Array.isArray(highs) ||
    !Array.isArray(lows) ||
    !Array.isArray(closes) ||
    closes.length < period + 1
  ) {
    return [];
  }

  const trs = [];

  for (let i = 1; i < closes.length; i++) {
    trs.push(
      trueRange(
        highs[i],
        lows[i],
        closes[i - 1]
      )
    );
  }

  if (trs.length < period) return [];

  const result = [];

  let value =
    trs.slice(0, period).reduce((a, b) => a + b, 0) /
    period;

  result.push(value);

  for (let i = period; i < trs.length; i++) {
    value =
      (value * (period - 1) + trs[i]) /
      period;

    result.push(value);
  }

  return result;
}

function atr(highs, lows, closes, period = 14) {
  const series = atrSeries(
    highs,
    lows,
    closes,
    period
  );

  return series.at(-1) ?? null;
}

function vwap(
  highs,
  lows,
  closes,
  volumes,
  period = 20
) {
  if (
    !Array.isArray(highs) ||
    !Array.isArray(lows) ||
    !Array.isArray(closes) ||
    !Array.isArray(volumes) ||
    closes.length < period
  ) {
    return null;
  }

  let pv = 0;
  let volume = 0;

  const start = closes.length - period;

  for (let i = start; i < closes.length; i++) {
    const typical =
      (finite(highs[i]) +
        finite(lows[i]) +
        finite(closes[i])) /
      3;

    const v = Math.max(0, finite(volumes[i]));

    pv += typical * v;
    volume += v;
  }

  if (volume <= 0) {
    return sma(closes, period);
  }

  return pv / volume;
}

function sessionVwap(bars) {
  if (!Array.isArray(bars) || !bars.length) {
    return null;
  }

  let pv = 0;
  let volume = 0;

  for (const bar of bars) {
    const high = finite(bar.high);
    const low = finite(bar.low);
    const close = finite(bar.close);
    const v = Math.max(0, finite(bar.volume));

    pv += ((high + low + close) / 3) * v;
    volume += v;
  }

  if (!volume) return null;

  return pv / volume;
}

function roc(closes, period = 10) {
  if (
    !Array.isArray(closes) ||
    closes.length <= period
  ) {
    return null;
  }

  const current = finite(closes.at(-1));
  const previous = finite(
    closes[closes.length - 1 - period]
  );

  if (!previous) return null;

  return ((current - previous) / previous) * 100;
}

function stdDev(values, period = 20) {
  if (!Array.isArray(values) || values.length < period) {
    return null;
  }

  const slice = values.slice(-period);
  const mean = sma(slice, period);

  const variance =
    slice.reduce(
      (sum, value) =>
        sum + (finite(value) - mean) ** 2,
      0
    ) / period;

  return Math.sqrt(variance);
}

function zScore(values, period = 20) {
  if (!Array.isArray(values) || values.length < period) {
    return null;
  }

  const mean = sma(values, period);
  const deviation = stdDev(values, period);

  if (!deviation) return 0;

  return (
    (finite(values.at(-1)) - mean) /
    deviation
  );
}

function highest(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return null;
  }

  return Math.max(...values.slice(-period).map(finite));
}

function lowest(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return null;
  }

  return Math.min(...values.slice(-period).map(finite));
}

function trendStrength(
  closes,
  fastPeriod = 20,
  slowPeriod = 50
) {
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);

  if (!fast || !slow) return null;

  return ((fast - slow) / slow) * 100;
}

function returns(closes, periods = [1, 3, 5, 10, 20, 50]) {
  const result = {};

  for (const period of periods) {
    result[period] = roc(closes, period);
  }

  return result;
}

function realizedVolatility(
  closes,
  period = 20
) {
  if (!Array.isArray(closes) || closes.length < period + 1) {
    return null;
  }

  const returns = [];

  for (
    let i = closes.length - period;
    i < closes.length;
    i++
  ) {
    const previous = finite(closes[i - 1]);
    const current = finite(closes[i]);

    if (previous > 0 && current > 0) {
      returns.push(
        Math.log(current / previous)
      );
    }
  }

  if (returns.length < 2) return null;

  const mean =
    returns.reduce((a, b) => a + b, 0) /
    returns.length;

  const variance =
    returns.reduce(
      (sum, value) =>
        sum + (value - mean) ** 2,
      0
    ) /
    (returns.length - 1);

  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/*
 * Legacy-compatible pure technical signal.
 * 실제 AI 판단은 agentEngine에서 수행한다.
 */
function quantSignal(
  bars,
  options = {}
) {
  if (!Array.isArray(bars) || bars.length < 80) {
    return {
      signal: 0,
      strength: 0,
      confidence: 0,
      setup: 'NONE',
      reason: '데이터 부족',
      indicators: {},
    };
  }

  const closes = bars.map(b => finite(b.close));
  const highs = bars.map(b => finite(b.high));
  const lows = bars.map(b => finite(b.low));
  const volumes = bars.map(b => Math.max(0, finite(b.volume)));

  const cfg = {
    emaFast: 9,
    emaSlow: 21,
    emaTrend: 50,
    atrPeriod: 14,
    rsiPeriod: 14,
    ...options,
  };

  const price = closes.at(-1);
  const fast = ema(closes, cfg.emaFast);
  const slow = ema(closes, cfg.emaSlow);
  const trend = ema(closes, cfg.emaTrend);
  const atrValue = atr(
    highs,
    lows,
    closes,
    cfg.atrPeriod
  );
  const currentVwap = vwap(
    highs,
    lows,
    closes,
    volumes,
    20
  );
  const rsiValue = rsi(
    closes,
    cfg.rsiPeriod
  );
  const macdValue = macd(closes);
  const volumeZ = zScore(volumes, 20);
  const bb = bollingerBands(closes, 20, 2);

  let score = 0;

  if (fast > slow) score += 25;
  else score -= 25;

  if (slow > trend) score += 25;
  else score -= 25;

  if (price > currentVwap) score += 15;
  else score -= 15;

  if (rsiValue >= 50 && rsiValue <= 70) score += 10;
  if (rsiValue > 78) score -= 10;
  if (rsiValue < 35) score -= 5;

  if (macdValue?.histogram > 0) score += 15;
  else if (macdValue) score -= 15;

  if (volumeZ >= 0.5) score += 10;
  if (volumeZ < -1) score -= 10;

  const previousHigh = highest(
    highs.slice(0, -1),
    20
  );

  if (previousHigh !== null && price > previousHigh) {
    score += 15;
  }

  const previousLow = lowest(
    lows.slice(0, -1),
    20
  );

  if (previousLow !== null && price < previousLow) {
    score -= 15;
  }

  score = clamp(score, -100, 100);

  const signal =
    score >= 45
      ? 1
      : score <= -45
        ? -1
        : 0;

  const strength = Math.min(
    100,
    Math.abs(score)
  );

  return {
    signal,
    strength,
    confidence: strength / 100,
    setup:
      signal === 1
        ? 'TECHNICAL_LONG'
        : signal === -1
          ? 'TECHNICAL_EXIT'
          : 'NONE',
    reason:
      signal === 1
        ? '기술지표 상승 합의'
        : signal === -1
          ? '기술지표 하락 합의'
          : '기술지표 합의 부족',
    indicators: {
      price,
      emaFast: fast,
      emaSlow: slow,
      emaTrend: trend,
      atr: atrValue,
      vwap: currentVwap,
      rsi: rsiValue,
      macd: macdValue,
      volumeZ,
      bollinger: bb,
      returns: returns(closes),
      realizedVolatility: realizedVolatility(closes),
    },
  };
}

function technicalScore(closes) {
  if (!Array.isArray(closes) || closes.length < 30) {
    return {
      score: 0,
      detail: {},
      reason: '데이터 부족',
    };
  }

  const price = finite(closes.at(-1));
  const sma20 = sma(closes, 20);
  const sma50 = sma(
    closes,
    Math.min(50, closes.length)
  );
  const rsiValue = rsi(closes, 14);
  const macdValue = macd(closes);
  const bb = bollingerBands(closes, 20, 2);

  let score = 0;

  if (sma20 && sma50) {
    score += sma20 > sma50 ? 25 : -25;
  }

  if (sma20) {
    score += price > sma20 ? 15 : -15;
  }

  if (rsiValue !== null) {
    if (rsiValue >= 45 && rsiValue <= 68) score += 10;
    else if (rsiValue < 30) score += 5;
    else if (rsiValue > 75) score -= 10;
  }

  if (macdValue) {
    score += macdValue.histogram > 0 ? 15 : -15;
  }

  if (bb) {
    score += price > bb.middle ? 10 : -10;
  }

  score = clamp(score, -100, 100);

  return {
    score,
    detail: {
      sma20,
      sma50,
      rsi: rsiValue,
      macd: macdValue,
      bollinger: bb,
    },
    reason:
      score > 20
        ? '기술적 상승 우세'
        : score < -20
          ? '기술적 하락 우세'
          : '기술적 중립',
  };
}

module.exports = {
  clamp,
  sma,
  ema,
  emaSeries,
  rsi,
  rsiSeries,
  macd,
  bollingerBands,
  trueRange,
  atr,
  atrSeries,
  vwap,
  sessionVwap,
  roc,
  stdDev,
  zScore,
  highest,
  lowest,
  trendStrength,
  returns,
  realizedVolatility,
  quantSignal,
  technicalScore,
};
