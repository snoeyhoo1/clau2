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
  realizedVolatility,
} = require('../indicators');

function clamp(value, min = -100, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function confidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/*
 * confidence 계산 방식:
 *
 * - c가 명시적으로 주어지면(예: 데이터 부족 시 0.1) 그대로 사용.
 * - components(하위 지표들의 방향 투표, +1/-1)가 주어지면
 *   "하위 지표들이 서로 얼마나 동의하는가(agreement)"를 기반으로
 *   confidence를 계산한다. 최종 점수가 크더라도 하위 지표들이
 *   서로 엇갈리면 confidence는 낮아진다.
 * - components가 없으면(단일 지표 기반 agent) 기존 방식대로
 *   점수 크기 기반 confidence를 사용한다.
 */
function makeAgent(
  name,
  score,
  evidence = {},
  risks = [],
  c = null,
  components = null
) {
  const normalized = clamp(score);

  let resolvedConfidence;

  if (c !== null) {
    resolvedConfidence = confidence(c);
  } else if (
    Array.isArray(components) &&
    components.length
  ) {
    const bullish =
      components.filter(v => v > 0).length;

    const bearish =
      components.filter(v => v < 0).length;

    const total = bullish + bearish;

    const agreement =
      total
        ? Math.max(bullish, bearish) / total
        : 0;

    resolvedConfidence =
      Math.max(
        0.15,
        Math.min(
          0.95,
          0.3 +
            agreement * 0.45 +
            (Math.abs(normalized) / 100) * 0.2
        )
      );
  } else {
    resolvedConfidence =
      Math.min(
        0.95,
        0.45 + Math.abs(normalized) / 200
      );
  }

  return {
    name,
    score: normalized,
    direction:
      normalized >= 20
        ? 'LONG'
        : normalized <= -20
          ? 'SHORT'
          : 'NEUTRAL',
    confidence: resolvedConfidence,
    evidence,
    risks,
  };
}

function voteSign(value) {
  if (!Number.isFinite(value) || value === 0) {
    return 0;
  }

  return value > 0 ? 1 : -1;
}

function arrays(bars) {
  return {
    opens: bars.map(b => Number(b.open) || 0),
    highs: bars.map(b => Number(b.high) || 0),
    lows: bars.map(b => Number(b.low) || 0),
    closes: bars.map(b => Number(b.close) || 0),
    volumes: bars.map(b => Number(b.volume) || 0),
  };
}

function trendAgent(bars) {
  const { closes } = arrays(bars);

  const fast = ema(closes, 9);
  const slow = ema(closes, 21);
  const trend = ema(closes, 50);
  const longTrend = ema(closes, 200);

  if (!fast || !slow || !trend) {
    return makeAgent(
      'TREND',
      0,
      { reason: '추세 데이터 부족' },
      [],
      0.1
    );
  }

  let score = 0;
  const components = [];

  score += fast > slow ? 25 : -25;
  components.push(fast > slow ? 1 : -1);

  score += slow > trend ? 25 : -25;
  components.push(slow > trend ? 1 : -1);

  if (longTrend) {
    score +=
      trend > longTrend
        ? 20
        : -20;

    components.push(
      trend > longTrend ? 1 : -1
    );
  }

  const r10 = roc(closes, 10);

  if (r10 !== null) {
    score += clamp(r10 * 8, -20, 20);
    components.push(voteSign(r10));
  }

  const slope =
    closes.length >= 10
      ? ((closes.at(-1) - closes.at(-10)) /
          closes.at(-10)) *
        100
      : 0;

  score += clamp(slope * 8, -15, 15);
  components.push(voteSign(slope));

  return makeAgent(
    'TREND',
    score,
    {
      ema9: fast,
      ema21: slow,
      ema50: trend,
      ema200: longTrend,
      roc10: r10,
      slopePct: slope,
    },
    [],
    null,
    components
  );
}

function momentumAgent(bars) {
  const { closes } = arrays(bars);

  const r = rsi(closes, 14);
  const m = macd(closes);

  const r3 = roc(closes, 3);
  const r8 = roc(closes, 8);
  const r20 = roc(closes, 20);

  let score = 0;
  const components = [];

  for (const value of [r3, r8, r20]) {
    if (value === null) continue;
    score += clamp(value * 5, -20, 20);
    components.push(voteSign(value));
  }

  if (m) {
    score += m.histogram > 0 ? 20 : -20;
    components.push(
      m.histogram > 0 ? 1 : -1
    );

    score += m.macd > m.signal ? 15 : -15;
    components.push(
      m.macd > m.signal ? 1 : -1
    );
  }

  if (r !== null) {
    if (r >= 50 && r <= 68) {
      score += 20;
      components.push(1);
    } else if (r >= 68 && r <= 75) {
      score += 8;
      components.push(1);
    } else if (r > 78) {
      score -= 20;
      components.push(-1);
    } else if (r < 35) {
      score -= 8;
      components.push(-1);
    }
  }

  return makeAgent(
    'MOMENTUM',
    score,
    {
      rsi: r,
      roc3: r3,
      roc8: r8,
      roc20: r20,
      macd: m,
    },
    [],
    null,
    components
  );
}

function vwapAgent(bars) {
  const {
    highs,
    lows,
    closes,
    volumes,
  } = arrays(bars);

  const price = closes.at(-1);
  const a = atr(highs, lows, closes, 14);
  const vw = vwap(
    highs,
    lows,
    closes,
    volumes,
    20
  );

  if (!a || !vw) {
    return makeAgent(
      'VWAP',
      0,
      { reason: 'VWAP 데이터 부족' },
      [],
      0.1
    );
  }

  const distance =
    (price - vw) / a;

  let score = 0;

  if (distance > 0 && distance <= 1.25) score += 40;
  else if (distance > 1.25 && distance <= 2) score += 15;
  else if (distance > 2) score -= 30;
  else if (distance >= -0.5) score += 5;
  else score -= 30;

  return makeAgent(
    'VWAP',
    score,
    {
      vwap: vw,
      distanceATR: distance,
      atr: a,
    }
  );
}

function breakoutAgent(bars) {
  if (bars.length < 30) {
    return makeAgent(
      'BREAKOUT',
      0,
      { reason: '돌파 데이터 부족' },
      [],
      0.1
    );
  }

  const {
    highs,
    lows,
    closes,
    volumes,
  } = arrays(bars);

  const price = closes.at(-1);

  const previousHigh = highest(
    highs.slice(0, -1),
    20
  );

  const previousLow = lowest(
    lows.slice(0, -1),
    20
  );

  const volumeZ = zScore(
    volumes,
    20
  );

  let score = 0;
  const components = [];

  const breakout =
    previousHigh !== null &&
    price > previousHigh;

  const breakdown =
    previousLow !== null &&
    price < previousLow;

  if (breakout) {
    score += 55;
    components.push(1);
  }

  if (breakdown) {
    score -= 55;
    components.push(-1);
  }

  if (volumeZ !== null) {
    if (volumeZ >= 1.5) {
      score += 30;
      components.push(1);
    } else if (volumeZ >= 0.7) {
      score += 15;
      components.push(1);
    } else if (volumeZ < -0.5) {
      score -= 20;
      components.push(-1);
    }
  }

  return makeAgent(
    'BREAKOUT',
    score,
    {
      previousHigh,
      previousLow,
      volumeZ,
      breakout,
      breakdown,
    },
    [],
    null,
    components
  );
}

function meanReversionAgent(bars) {
  const { closes } = arrays(bars);

  const r = rsi(closes, 14);
  const bb = bollingerBands(
    closes,
    20,
    2
  );

  if (!bb) {
    return makeAgent(
      'MEAN_REVERSION',
      0,
      {},
      [],
      0.1
    );
  }

  const price = closes.at(-1);

  let score = 0;
  const components = [];

  if (price < bb.lower) {
    score += 55;
    components.push(1);
  } else if (price < bb.middle) {
    score += 12;
    components.push(1);
  }

  if (price > bb.upper) {
    score -= 55;
    components.push(-1);
  }

  if (r !== null) {
    if (r < 28) {
      score += 35;
      components.push(1);
    } else if (r < 38) {
      score += 18;
      components.push(1);
    } else if (r > 78) {
      score -= 35;
      components.push(-1);
    }
  }

  return makeAgent(
    'MEAN_REVERSION',
    score,
    {
      rsi: r,
      bollinger: bb,
    },
    [],
    null,
    components
  );
}

function volumeAgent(bars) {
  const { closes, volumes } = arrays(bars);

  const z = zScore(volumes, 20);

  if (z === null) {
    return makeAgent(
      'VOLUME',
      0,
      {},
      [],
      0.1
    );
  }

  let score = 0;
  const components = [];

  if (z >= 1.5) {
    score += 45;
    components.push(1);
  } else if (z >= 0.7) {
    score += 30;
    components.push(1);
  } else if (z >= 0) {
    score += 10;
    components.push(1);
  } else if (z < -1) {
    score -= 20;
    components.push(-1);
  }

  const priceReturn = roc(
    closes,
    1
  );

  /*
   * 거래량은 방향 자체가 아니라
   * 가격 방향과 결합해서 해석한다.
   */
  if (priceReturn !== null) {
    if (z >= 0.7 && priceReturn > 0) {
      score += 15;
      components.push(1);
    }

    if (z >= 0.7 && priceReturn < 0) {
      score -= 15;
      components.push(-1);
    }
  }

  return makeAgent(
    'VOLUME',
    score,
    {
      volumeZ: z,
      priceReturn,
    },
    [],
    null,
    components
  );
}

function volatilityAgent(bars) {
  const {
    highs,
    lows,
    closes,
  } = arrays(bars);

  const a = atr(
    highs,
    lows,
    closes,
    14
  );

  const bb = bollingerBands(
    closes,
    20,
    2
  );

  const price = closes.at(-1);

  if (!a || !price) {
    return makeAgent(
      'VOLATILITY',
      0,
      {},
      [],
      0.1
    );
  }

  const atrPct =
    (a / price) * 100;

  let score = 0;
  let regime = 'NORMAL';

  if (bb?.width < 1.5) {
    regime = 'SQUEEZE';
    score += 10;
  }

  if (atrPct < 0.5) {
    regime = 'LOW_VOL';
    score -= 10;
  }

  if (atrPct > 4) {
    regime = 'HIGH_VOL';
    score -= 20;
  }

  if (atrPct > 7) {
    score -= 25;
    regime = 'EXTREME_VOL';
  }

  return makeAgent(
    'VOLATILITY',
    score,
    {
      atrPct,
      regime,
      bollingerWidth: bb?.width ?? null,
      realizedVolatility:
        realizedVolatility(closes),
    }
  );
}

function priceActionAgent(bars) {
  const current = bars.at(-1);
  const previous = bars.at(-2);

  if (!current) {
    return makeAgent(
      'PRICE_ACTION',
      0,
      {},
      [],
      0.1
    );
  }

  const open = Number(current.open);
  const high = Number(current.high);
  const low = Number(current.low);
  const close = Number(current.close);

  const range = high - low;

  if (
    !Number.isFinite(range) ||
    range <= 0
  ) {
    return makeAgent(
      'PRICE_ACTION',
      0,
      {},
      [],
      0.1
    );
  }

  const body = close - open;
  const bodyRatio =
    Math.abs(body) / range;

  const upperWick =
    high - Math.max(open, close);

  const lowerWick =
    Math.min(open, close) - low;

  let score = 0;
  const components = [];

  if (body > 0 && bodyRatio >= 0.65) {
    score += 35;
    components.push(1);
  }

  if (body < 0 && bodyRatio >= 0.65) {
    score -= 35;
    components.push(-1);
  }

  if (
    lowerWick > Math.abs(body) * 1.5 &&
    close > open
  ) {
    score += 20;
    components.push(1);
  }

  if (
    upperWick > Math.abs(body) * 1.5 &&
    close < open
  ) {
    score -= 20;
    components.push(-1);
  }

  if (previous) {
    if (
      close > Number(previous.high) &&
      body > 0
    ) {
      score += 15;
      components.push(1);
    }

    if (
      close < Number(previous.low) &&
      body < 0
    ) {
      score -= 15;
      components.push(-1);
    }
  }

  return makeAgent(
    'PRICE_ACTION',
    score,
    {
      bodyRatio,
      upperWick,
      lowerWick,
      close,
    },
    [],
    null,
    components
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
