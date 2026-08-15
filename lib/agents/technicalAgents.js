const {
  ema,
  rsi,
  macd,
  bollingerBands,
  atr,
  vwap,
  roc,
  zScore,
  highest,
  lowest,
} = require('../indicators');

function clamp(v, min = -100, max = 100) {
  return Math.max(min, Math.min(max, Number(v) || 0));
}

function agent(name, direction, score, confidence, evidence = {}, risks = []) {
  return {
    name,
    direction,
    score: clamp(score),
    confidence: Math.max(0, Math.min(1, confidence)),
    evidence,
    risks,
  };
}

function trendAgent(bars) {
  const closes = bars.map(b => Number(b.close));
  const fast = ema(closes, 9);
  const slow = ema(closes, 21);
  const trend = ema(closes, 50);

  if (!fast || !slow || !trend) {
    return agent('TREND', 'NEUTRAL', 0, 0.1);
  }

  let score = 0;

  if (fast > slow) score += 30;
  else score -= 30;

  if (slow > trend) score += 30;
  else score -= 30;

  const old = closes[Math.max(0, closes.length - 11)];
  const slope = old ? (closes.at(-1) - old) / old * 100 : 0;

  if (slope > 0.5) score += 25;
  else if (slope < -0.5) score -= 25;

  const direction =
    score > 20 ? 'LONG' :
    score < -20 ? 'SHORT' :
    'NEUTRAL';

  return agent(
    'TREND',
    direction,
    score,
    Math.min(0.95, 0.5 + Math.abs(score) / 200),
    {
      ema9: fast,
      ema21: slow,
      ema50: trend,
      slopePct: slope,
    }
  );
}

function momentumAgent(bars) {
  const closes = bars.map(b => Number(b.close));
  const r = rsi(closes, 14);
  const m = macd(closes);

  let score = 0;

  const r3 = roc(closes, 3);
  const r8 = roc(closes, 8);
  const r20 = roc(closes, 20);

  for (const value of [r3, r8, r20]) {
    if (value == null) continue;
    score += value > 0 ? 15 : -15;
  }

  if (m) {
    score += m.histogram > 0 ? 20 : -20;
    score += m.macd > m.signal ? 15 : -15;
  }

  if (r != null) {
    if (r >= 50 && r <= 68) score += 20;
    else if (r > 75) score -= 20;
    else if (r < 35) score += 5;
  }

  score = clamp(score);

  return agent(
    'MOMENTUM',
    score > 20 ? 'LONG' : score < -20 ? 'SHORT' : 'NEUTRAL',
    score,
    0.5 + Math.min(0.45, Math.abs(score) / 200),
    {
      rsi: r,
      roc3: r3,
      roc8: r8,
      roc20: r20,
      macd: m,
    }
  );
}

function vwapAgent(bars) {
  const highs = bars.map(b => Number(b.high));
  const lows = bars.map(b => Number(b.low));
  const closes = bars.map(b => Number(b.close));
  const volumes = bars.map(b => Number(b.volume) || 0);

  const current = closes.at(-1);
  const atrValue = atr(highs, lows, closes, 14);
  const vw = vwap(highs, lows, closes, volumes, 20);

  if (!atrValue || !vw) {
    return agent('VWAP', 'NEUTRAL', 0, 0.1);
  }

  const distance = (current - vw) / atrValue;

  let score = 0;

  if (distance > 0 && distance < 1.5) score += 45;
  else if (distance >= 1.5 && distance < 2.5) score += 15;
  else if (distance >= 2.5) score -= 35;
  else if (distance > -0.8) score += 5;
  else score -= 35;

  return agent(
    'VWAP',
    score > 20 ? 'LONG' : score < -20 ? 'SHORT' : 'NEUTRAL',
    score,
    0.7,
    {
      vwap: vw,
      distanceATR: distance,
      atr: atrValue,
    }
  );
}

function breakoutAgent(bars) {
  if (bars.length < 30) {
    return agent('BREAKOUT', 'NEUTRAL', 0, 0.1);
  }

  const highs = bars.map(b => Number(b.high));
  const lows = bars.map(b => Number(b.low));
  const closes = bars.map(b => Number(b.close));
  const volumes = bars.map(b => Number(b.volume) || 0);

  const last = closes.at(-1);

  const high20 = highest(highs.slice(0, -1), 20);
  const low20 = lowest(lows.slice(0, -1), 20);
  const volumeZ = zScore(volumes, 20);

  let score = 0;

  if (last > high20) score += 55;
  if (last < low20) score -= 55;

  if (volumeZ != null) {
    if (volumeZ >= 1.5) score += 30;
    else if (volumeZ >= 0.7) score += 15;
    else if (volumeZ < -0.5) score -= 20;
  }

  return agent(
    'BREAKOUT',
    score > 20 ? 'LONG' : score < -20 ? 'SHORT' : 'NEUTRAL',
    score,
    score > 50 ? 0.85 : 0.6,
    {
      previousHigh: high20,
      previousLow: low20,
      volumeZ,
      breakout: last > high20,
      breakdown: last < low20,
    }
  );
}

function meanReversionAgent(bars) {
  const closes = bars.map(b => Number(b.close));
  const r = rsi(closes, 14);
  const bb = bollingerBands(closes, 20, 2);

  if (!bb) {
    return agent('MEAN_REVERSION', 'NEUTRAL', 0, 0.1);
  }

  const last = closes.at(-1);
  let score = 0;

  if (last < bb.lower) score += 55;
  else if (last < bb.middle) score += 15;

  if (last > bb.upper) score -= 55;

  if (r != null) {
    if (r < 30) score += 35;
    else if (r < 40) score += 15;
    else if (r > 75) score -= 35;
  }

  return agent(
    'MEAN_REVERSION',
    score > 20 ? 'LONG' : score < -20 ? 'SHORT' : 'NEUTRAL',
    score,
    0.55,
    {
      rsi: r,
      bollinger: bb,
    }
  );
}

function volumeAgent(bars) {
  const volumes = bars.map(b => Number(b.volume) || 0);
  const z = zScore(volumes, 20);

  if (z == null) {
    return agent('VOLUME', 'NEUTRAL', 0, 0.1);
  }

  let score = 0;

  if (z >= 1.5) score = 45;
  else if (z >= 0.7) score = 30;
  else if (z >= 0) score = 10;
  else if (z < -1) score = -20;

  return agent(
    'VOLUME',
    score > 20 ? 'LONG' : score < -20 ? 'SHORT' : 'NEUTRAL',
    score,
    0.65,
    { volumeZ: z }
  );
}

function volatilityAgent(bars) {
  const highs = bars.map(b => Number(b.high));
  const lows = bars.map(b => Number(b.low));
  const closes = bars.map(b => Number(b.close));

  const a = atr(highs, lows, closes, 14);
  const bb = bollingerBands(closes, 20, 2);
  const last = closes.at(-1);

  if (!a || !last) {
    return agent('VOLATILITY', 'NEUTRAL', 0, 0.1);
  }

  const atrPct = a / last * 100;

  let score = 0;
  let regime = 'NORMAL';

  if (bb && bb.width < 1.5) {
    regime = 'SQUEEZE';
    score += 15;
  }

  if (atrPct < 0.5) {
    regime = 'LOW_VOL';
    score -= 10;
  }

  if (atrPct > 4) {
    regime = 'HIGH_VOL';
    score -= 20;
  }

  return agent(
    'VOLATILITY',
    score > 10 ? 'LONG' : score < -10 ? 'SHORT' : 'NEUTRAL',
    score,
    0.7,
    {
      atrPct,
      regime,
      bollingerWidth: bb?.width,
    }
  );
}

function priceActionAgent(bars) {
  const b = bars.at(-1);

  if (!b) {
    return agent('PRICE_ACTION', 'NEUTRAL', 0, 0.1);
  }

  const open = Number(b.open);
  const high = Number(b.high);
  const low = Number(b.low);
  const close = Number(b.close);

  const range = high - low;

  if (range <= 0) {
    return agent('PRICE_ACTION', 'NEUTRAL', 0, 0.1);
  }

  const body = close - open;
  const bodyRatio = Math.abs(body) / range;

  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;

  let score = 0;

  if (body > 0 && bodyRatio > 0.65) score += 35;
  if (body < 0 && bodyRatio > 0.65) score -= 35;

  if (lowerWick > Math.abs(body) * 1.5 && close > open) {
    score += 20;
  }

  if (upperWick > Math.abs(body) * 1.5 && close < open) {
    score -= 20;
  }

  return agent(
    'PRICE_ACTION',
    score > 15 ? 'LONG' : score < -15 ? 'SHORT' : 'NEUTRAL',
    score,
    0.55,
    {
      bodyRatio,
      upperWick,
      lowerWick,
    }
  );
}

module.exports = {
  trendAgent,
  momentumAgent,
  vwapAgent,
  breakoutAgent,
  meanReversionAgent,
  volumeAgent,
  volatilityAgent,
  priceActionAgent,
};
