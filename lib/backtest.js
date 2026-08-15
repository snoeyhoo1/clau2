// lib/backtest.js
//
// Multi-Agent Quant Backtest Engine
//
// DAY + SWING
//
// Architecture:
//
// Market Agent
// Relative Strength Agent
// Intraday Trend Agent
// Momentum Agent
// Mean Reversion Agent
// Swing Trend Agent
// Risk Agent
// Thesis Agent
// Timing Agent
// Invalidation Agent
//
//        ↓
//
// Day Meta Agent
// Swing Meta Agent
//
//        ↓
//
// Final Decision Engine
//
// 주의:
// 뉴스/실적 등의 비정형 정보는 과거 시점의 point-in-time
// 데이터가 없으면 백테스트에 넣지 않는다.
// 현재 버전에서는 가격/거래량 기반 정보만 백테스트한다.
//

const DEFAULTS = {
  initialCapital: 100000,

  feeRate: 0.0005,

  slippageRate: 0.0005,

  riskPerTrade: 0.0075,

  maxPositionPct: 0.35,

  maxTradesPerDay: 8,

  // DAY
  dayMinScore: 68,

  // SWING
  swingMinScore: 70,

  // risk
  maxRiskScore: 72,

  // ATR
  atrStop: 1.35,

  atrTarget: 2.4,

  atrTrailing: 1.5,

  maxHoldingBars: 10,

  // swing is evaluated using longer structure
  swingFastPeriod: 20,

  swingSlowPeriod: 50,

  // intraday
  shortEma: 9,

  mediumEma: 21,

  longEma: 50,

  rsiPeriod: 14,

  atrPeriod: 14,

  volumePeriod: 20,

  breakoutPeriod: 20,

  maxExtensionFromVwap: 0.025,

  minRiskReward: 1.6,
};

/* =========================================================
 * BASIC MATH
 * ========================================================= */

function average(values) {
  if (!values.length) {
    return null;
  }

  return (
    values.reduce(
      (a, b) => a + b,
      0
    ) / values.length
  );
}

function std(values) {
  if (values.length < 2) {
    return null;
  }

  const mean = average(values);

  const variance =
    values.reduce(
      (sum, value) =>
        sum +
        (value - mean) ** 2,
      0
    ) /
    (values.length - 1);

  return Math.sqrt(variance);
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const factor =
    10 ** digits;

  return (
    Math.round(
      value * factor
    ) / factor
  );
}

/* =========================================================
 * EMA
 * ========================================================= */

function ema(values, period) {
  if (
    !values.length ||
    values.length < period
  ) {
    return null;
  }

  const multiplier =
    2 / (period + 1);

  let result =
    average(
      values.slice(
        0,
        period
      )
    );

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    result =
      (
        values[i] -
          result
      ) *
        multiplier +
      result;
  }

  return result;
}

/* =========================================================
 * RSI
 * ========================================================= */

function rsi(values, period = 14) {
  if (
    values.length <
    period + 1
  ) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {
    const change =
      values[i] -
      values[i - 1];

    if (change >= 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  let avgGain =
    gains / period;

  let avgLoss =
    losses / period;

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {
    const change =
      values[i] -
      values[i - 1];

    const gain =
      Math.max(change, 0);

    const loss =
      Math.max(-change, 0);

    avgGain =
      (
        avgGain *
          (period - 1) +
        gain
      ) / period;

    avgLoss =
      (
        avgLoss *
          (period - 1) +
        loss
      ) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }

  const rs =
    avgGain / avgLoss;

  return (
    100 -
    100 /
      (1 + rs)
  );
}

/* =========================================================
 * ATR
 * ========================================================= */

function atr(bars, period = 14) {
  if (
    bars.length <
    period + 1
  ) {
    return null;
  }

  const trs = [];

  for (
    let i = 1;
    i < bars.length;
    i++
  ) {
    const bar =
      bars[i];

    const previous =
      bars[i - 1];

    const tr =
      Math.max(
        bar.high -
          bar.low,

        Math.abs(
          bar.high -
            previous.close
        ),

        Math.abs(
          bar.low -
            previous.close
        )
      );

    trs.push(tr);
  }

  if (
    trs.length <
    period
  ) {
    return null;
  }

  return average(
    trs.slice(
      -period
    )
  );
}

/* =========================================================
 * VWAP
 * ========================================================= */

function vwap(bars) {
  if (!bars.length) {
    return null;
  }

  let cumulativePV = 0;
  let cumulativeVolume = 0;

  for (const bar of bars) {
    const typical =
      (
        bar.high +
        bar.low +
        bar.close
      ) / 3;

    const volume =
      Number(bar.volume) || 0;

    cumulativePV +=
      typical * volume;

    cumulativeVolume +=
      volume;
  }

  if (
    cumulativeVolume <= 0
  ) {
    return null;
  }

  return (
    cumulativePV /
    cumulativeVolume
  );
}

/* =========================================================
 * VOLUME
 * ========================================================= */

function relativeVolume(
  bars,
  period = 20
) {
  if (
    bars.length <
    period + 1
  ) {
    return null;
  }

  const current =
    Number(
      bars[
        bars.length - 1
      ].volume
    ) || 0;

  const history =
    bars
      .slice(
        -period - 1,
        -1
      )
      .map(
        (bar) =>
          Number(
            bar.volume
          ) || 0
      );

  const avg =
    average(history);

  if (!avg) {
    return null;
  }

  return (
    current / avg
  );
}

/* =========================================================
 * RETURN
 * ========================================================= */

function periodReturn(
  values,
  period
) {
  if (
    values.length <= period
  ) {
    return null;
  }

  const start =
    values[
      values.length -
        1 -
        period
    ];

  const end =
    values[
      values.length - 1
    ];

  if (!start) {
    return null;
  }

  return (
    (end - start) /
    start
  );
}

/* =========================================================
 * MARKET PROXY
 * =========================================================
 *
 * 현재 API에서는 종목 OHLCV만 들어오므로
 * 시장 데이터가 별도로 전달되지 않는 경우
 * 종목 자체의 추세/변동성을 proxy로 사용한다.
 *
 * 추후 API에서 Nasdaq/S&P/VIX를 같이 전달하면
 * 이 Agent를 실제 시장 데이터 기반으로 교체한다.
 */

function marketAgent(bars) {
  const closes =
    bars.map(
      (bar) => bar.close
    );

  const fast =
    ema(closes, 20);

  const slow =
    ema(closes, 50);

  const shortReturn =
    periodReturn(
      closes,
      10
    );

  const mediumReturn =
    periodReturn(
      closes,
      30
    );

  let score = 50;

  if (
    fast &&
    slow
  ) {
    if (fast > slow) {
      score += 15;
    } else {
      score -= 15;
    }
  }

  if (
    shortReturn !== null
  ) {
    score +=
      clamp(
        shortReturn *
          500,
        -15,
        15
      );
  }

  if (
    mediumReturn !== null
  ) {
    score +=
      clamp(
        mediumReturn *
          250,
        -15,
        15
      );
  }

  score =
    clamp(
      score,
      0,
      100
    );

  let regime =
    'NEUTRAL';

  if (score >= 68) {
    regime =
      'BULLISH';
  } else if (score <= 32) {
    regime =
      'BEARISH';
  }

  return {
    name: 'MARKET',
    score: round(score, 1),
    regime,
    confidence:
      Math.abs(
        score - 50
      ) * 2,
  };
}

/* =========================================================
 * RELATIVE STRENGTH AGENT
 * ========================================================= */

function relativeStrengthAgent(
  bars
) {
  const closes =
    bars.map(
      (bar) => bar.close
    );

  const r5 =
    periodReturn(
      closes,
      5
    );

  const r20 =
    periodReturn(
      closes,
      20
    );

  const r50 =
    periodReturn(
      closes,
      50
    );

  let score = 50;

  if (r5 !== null) {
    score += clamp(
      r5 * 400,
      -15,
      15
    );
  }

  if (r20 !== null) {
    score += clamp(
      r20 * 200,
      -15,
      15
    );
  }

  if (r50 !== null) {
    score += clamp(
      r50 * 100,
      -10,
      10
    );
  }

  score =
    clamp(
      score,
      0,
      100
    );

  return {
    name: 'RELATIVE_STRENGTH',
    score: round(score, 1),
    direction:
      score >= 60
        ? 'STRONG'
        : score <= 40
          ? 'WEAK'
          : 'NEUTRAL',
  };
}

/* =========================================================
 * INTRADAY TREND AGENT
 * ========================================================= */

function intradayTrendAgent(
  bars,
  cfg
) {
  const closes =
    bars.map(
      (bar) => bar.close
    );

  const price =
    closes[
      closes.length - 1
    ];

  const e9 =
    ema(
      closes,
      cfg.shortEma
    );

  const e21 =
    ema(
      closes,
      cfg.mediumEma
    );

  const e50 =
    ema(
      closes,
      cfg.longEma
    );

  const currentVwap =
    vwap(
      bars.slice(-30)
    );

  let score = 50;

  if (
    e9 &&
    e21 &&
    e9 > e21
  ) {
    score += 15;
  }

  if (
    e21 &&
    e50 &&
    e21 > e50
  ) {
    score += 15;
  }

  if (
    currentVwap
  ) {
    if (
      price >
      currentVwap
    ) {
      score += 15;
    } else {
      score -= 15;
    }
  }

  if (
    e9 &&
    price > e9
  ) {
    score += 5;
  }

  score =
    clamp(
      score,
      0,
      100
    );

  return {
    name: 'INTRADAY_TREND',
    score: round(score, 1),

    trend:
      score >= 70
        ? 'BULLISH'
        : score <= 30
          ? 'BEARISH'
          : 'NEUTRAL',

    ema9: round(e9),
    ema21: round(e21),
    ema50: round(e50),
    vwap: round(currentVwap),
  };
}

/* =========================================================
 * MOMENTUM AGENT
 * ========================================================= */

function momentumAgent(
  bars,
  cfg
) {
  const closes =
    bars.map(
      (bar) => bar.close
    );

  const rsiValue =
    rsi(
      closes,
      cfg.rsiPeriod
    );

  const r5 =
    periodReturn(
      closes,
      5
    );

  const rvol =
    relativeVolume(
      bars,
      cfg.volumePeriod
    );

  let score = 50;

  if (
    r5 !== null
  ) {
    score += clamp(
      r5 * 450,
      -20,
      20
    );
  }

  if (
    rvol !== null
  ) {
    if (rvol >= 1.5) {
      score += 15;
    } else if (
      rvol >= 1.15
    ) {
      score += 8;
    } else if (
      rvol < 0.7
    ) {
      score -= 8;
    }
  }

  if (
    rsiValue !== null
  ) {
    if (
      rsiValue >= 55 &&
      rsiValue <= 72
    ) {
      score += 12;
    }

    if (
      rsiValue > 80
    ) {
      score -= 12;
    }

    if (
      rsiValue < 35
    ) {
      score -= 8;
    }
  }

  score =
    clamp(
      score,
      0,
      100
    );

  return {
    name: 'MOMENTUM',
    score: round(score, 1),

    rsi:
      round(
        rsiValue,
        1
      ),

    relativeVolume:
      round(
        rvol,
        2
      ),
  };
}

/* =========================================================
 * MEAN REVERSION AGENT
 * ========================================================= */

function meanReversionAgent(
  bars
) {
  const closes =
    bars.map(
      (bar) => bar.close
    );

  const window =
    closes.slice(-20);

  if (
    window.length < 10
  ) {
    return {
      name:
        'MEAN_REVERSION',
      score: 50,
      signal:
        'NEUTRAL',
    };
  }

  const mean =
    average(window);

  const deviation =
    std(window);

  const price =
    closes[
      closes.length - 1
    ];

  if (!deviation) {
    return {
      name:
        'MEAN_REVERSION',
      score: 50,
      signal:
        'NEUTRAL',
    };
  }

  const z =
    (
      price - mean
    ) / deviation;

  let score = 50;

  // 지나친 하락 후 반등 기회
  if (z <= -2) {
    score += 25;
  } else if (
    z <= -1.25
  ) {
    score += 15;
  }

  // 지나친 상승은 추격 방지
  if (z >= 2) {
    score -= 25;
  } else if (
    z >= 1.25
  ) {
    score -= 15;
  }

  score =
    clamp(
      score,
      0,
      100
    );

  return {
    name:
      'MEAN_REVERSION',

    score:
      round(score, 1),

    zScore:
      round(z, 2),

    signal:
      score >= 68
        ? 'REVERSION_UP'
        : score <= 32
          ? 'EXTENDED'
          : 'NEUTRAL',
  };
}

/* =========================================================
 * SWING TREND AGENT
 * ========================================================= */

function swingTrendAgent(
  bars,
  cfg
) {
  const closes =
    bars.map(
      (bar) => bar.close
    );

  const fast =
    ema(
      closes,
      cfg.swingFastPeriod
    );

  const slow =
    ema(
      closes,
      cfg.swingSlowPeriod
    );

  const r20 =
    periodReturn(
      closes,
      20
    );

  const r50 =
    periodReturn(
      closes,
      50
    );

  let score = 50;

  if (
    fast &&
    slow
  ) {
    if (fast > slow) {
      score += 25;
    } else {
      score -= 25;
    }
  }

  if (
    r20 !== null
  ) {
    score += clamp(
      r20 * 200,
      -12,
      12
    );
  }

  if (
    r50 !== null
  ) {
    score += clamp(
      r50 * 120,
      -10,
      10
    );
  }

  score =
    clamp(
      score,
      0,
      100
    );

  return {
    name: 'SWING_TREND',

    score:
      round(score, 1),

    trend:
      score >= 68
        ? 'BULLISH'
        : score <= 32
          ? 'BEARISH'
          : 'NEUTRAL',

    ema20:
      round(fast),

    ema50:
      round(slow),
  };
}

/* =========================================================
 * RISK AGENT
 * ========================================================= */

function riskAgent(
  bars,
  cfg
) {
  const atrValue =
    atr(
      bars,
      cfg.atrPeriod
    );

  const price =
    bars[
      bars.length - 1
    ].close;

  const rvol =
    relativeVolume(
      bars,
      cfg.volumePeriod
    );

  let risk = 35;

  if (
    atrValue &&
    price
  ) {
    const atrPct =
      atrValue /
      price;

    if (
      atrPct > 0.04
    ) {
      risk += 30;
    } else if (
      atrPct > 0.025
    ) {
      risk += 15;
    } else if (
      atrPct < 0.01
    ) {
      risk -= 5;
    }
  }

  if (
    rvol !== null &&
    rvol > 3
  ) {
    risk += 15;
  }

  risk =
    clamp(
      risk,
      0,
      100
    );

  return {
    name: 'RISK',

    score:
      round(
        100 - risk,
        1
      ),

    risk:
      risk >= 70
        ? 'HIGH'
        : risk >= 45
          ? 'MEDIUM'
          : 'LOW',

    atr:
      round(atrValue),

    atrPct:
      atrValue && price
        ? round(
            (
              atrValue /
              price
            ) * 100,
            2
          )
        : null,
  };
}

/* =========================================================
 * THESIS AGENT
 * ========================================================= */

function thesisAgent(
  market,
  relative,
  intraday,
  momentum,
  swing
) {
  const dayScore =
    (
      market.score * 0.20 +
      relative.score * 0.20 +
      intraday.score * 0.25 +
      momentum.score * 0.35
    );

  const swingScore =
    (
      market.score * 0.20 +
      relative.score * 0.30 +
      swing.score * 0.50
    );

  return {
    name: 'THESIS',

    dayScore:
      round(dayScore, 1),

    swingScore:
      round(swingScore, 1),

    dayDirection:
      dayScore >= 68
        ? 'BULLISH'
        : dayScore <= 32
          ? 'BEARISH'
          : 'NEUTRAL',

    swingDirection:
      swingScore >= 68
        ? 'BULLISH'
        : swingScore <= 32
          ? 'BEARISH'
          : 'NEUTRAL',
  };
}

/* =========================================================
 * TIMING AGENT
 * ========================================================= */

function timingAgent(
  bars,
  intraday,
  momentum,
  meanReversion,
  cfg
) {
  const price =
    bars[
      bars.length - 1
    ].close;

  const currentVwap =
    intraday.vwap;

  let score = 50;

  if (
    currentVwap &&
    price >
      currentVwap
  ) {
    score += 15;
  }

  if (
    momentum.score >= 65
  ) {
    score += 15;
  }

  if (
    meanReversion.zScore !==
      null &&
    meanReversion.zScore <
      -1.25
  ) {
    score += 10;
  }

  if (
    currentVwap &&
    price >
      currentVwap *
        (
          1 +
            cfg.maxExtensionFromVwap
        )
  ) {
    score -= 25;
  }

  score =
    clamp(
      score,
      0,
      100
    );

  return {
    name: 'TIMING',

    score:
      round(score, 1),

    timing:
      score >= 70
        ? 'GOOD'
        : score <= 40
          ? 'BAD'
          : 'NEUTRAL',
  };
}

/* =========================================================
 * INVALIDATION AGENT
 * ========================================================= */

function invalidationAgent(
  bars,
  intraday,
  swing
) {
  const price =
    bars[
      bars.length - 1
    ].close;

  let score = 50;

  const reasons = [];

  if (
    intraday.ema21 &&
    price <
      intraday.ema21
  ) {
    score -= 20;

    reasons.push(
      'PRICE_BELOW_EMA21'
    );
  }

  if (
    intraday.vwap &&
    price <
      intraday.vwap
  ) {
    score -= 15;

    reasons.push(
      'PRICE_BELOW_VWAP'
    );
  }

  if (
    swing.ema50 &&
    price <
      swing.ema50
  ) {
    score -= 20;

    reasons.push(
      'PRICE_BELOW_SWING_EMA50'
    );
  }

  score =
    clamp(
      score,
      0,
      100
    );

  return {
    name:
      'INVALIDATION',

    score:
      round(score, 1),

    reasons,

    valid:
      score >= 45,
  };
}

/* =========================================================
 * DAY META AGENT
 * ========================================================= */

function dayMetaAgent(
  thesis,
  momentum,
  intraday,
  meanReversion,
  timing,
  risk,
  invalidation,
  cfg
) {
  let score =
    thesis.dayScore;

  score =
    score * 0.30 +
    momentum.score * 0.20 +
    intraday.score * 0.20 +
    timing.score * 0.15 +
    invalidation.score * 0.10 +
    risk.score * 0.05;

  // mean reversion can improve an otherwise weak
  // entry when price is deeply stretched.
  if (
    meanReversion.signal ===
    'REVERSION_UP'
  ) {
    score += 5;
  }

  if (
    meanReversion.signal ===
    'EXTENDED'
  ) {
    score -= 10;
  }

  score =
    clamp(
      score,
      0,
      100
    );

  let decision =
    'WAIT';

  if (
    score >=
      cfg.dayMinScore &&
    risk.risk !==
      'HIGH' &&
    invalidation.valid
  ) {
    decision =
      'BUY';
  }

  if (
    score < 35
  ) {
    decision =
      'NO_TRADE';
  }

  return {
    name: 'DAY_META',

    score:
      round(score, 1),

    decision,
  };
}

/* =========================================================
 * SWING META AGENT
 * ========================================================= */

function swingMetaAgent(
  thesis,
  swing,
  relative,
  risk,
  invalidation,
  cfg
) {
  let score =
    thesis.swingScore;

  score =
    score * 0.40 +
    swing.score * 0.25 +
    relative.score * 0.15 +
    invalidation.score * 0.10 +
    risk.score * 0.10;

  score =
    clamp(
      score,
      0,
      100
    );

  let decision =
    'WAIT';

  if (
    score >=
      cfg.swingMinScore &&
    risk.risk !==
      'HIGH'
  ) {
    decision =
      'BUY';
  }

  if (
    score < 35
  ) {
    decision =
      'NO_TRADE';
  }

  return {
    name: 'SWING_META',

    score:
      round(score, 1),

    decision,
  };
}

/* =========================================================
 * FINAL DECISION ENGINE
 * ========================================================= */

function finalDecision(
  dayMeta,
  swingMeta,
  timing,
  risk,
  invalidation
) {
  /*
   * DAY가 강하고 진입 타이밍이 좋으면
   * DAY BUY를 우선.
   */

  if (
    dayMeta.decision ===
      'BUY' &&
    timing.score >= 68 &&
    risk.risk !==
      'HIGH' &&
    invalidation.valid
  ) {
    return {
      decision:
        'DAY_BUY',

      score:
        dayMeta.score,
    };
  }

  /*
   * 스윙 thesis는 좋지만
   * 단기 timing이 좋지 않으면
   * SWING BUY / DAY WAIT.
   */

  if (
    swingMeta.decision ===
      'BUY' &&
    timing.score < 68
  ) {
    return {
      decision:
        'SWING_BUY_DAY_WAIT',

      score:
        swingMeta.score,
    };
  }

  if (
    swingMeta.decision ===
      'BUY'
  ) {
    return {
      decision:
        'SWING_BUY',

      score:
        swingMeta.score,
    };
  }

  if (
    risk.risk ===
    'HIGH'
  ) {
    return {
      decision:
        'NO_TRADE',

      score:
        100 -
        risk.risk,
    };
  }

  return {
    decision:
      'NO_TRADE',

    score: 50,
  };
}

/* =========================================================
 * ALL AGENTS
 * ========================================================= */

function analyzeAgents(
  bars,
  cfg
) {
  const market =
    marketAgent(
      bars
    );

  const relative =
    relativeStrengthAgent(
      bars
    );

  const intraday =
    intradayTrendAgent(
      bars,
      cfg
    );

  const momentum =
    momentumAgent(
      bars,
      cfg
    );

  const meanReversion =
    meanReversionAgent(
      bars
    );

  const swing =
    swingTrendAgent(
      bars,
      cfg
    );

  const risk =
    riskAgent(
      bars,
      cfg
    );

  const thesis =
    thesisAgent(
      market,
      relative,
      intraday,
      momentum,
      swing
    );

  const timing =
    timingAgent(
      bars,
      intraday,
      momentum,
      meanReversion,
      cfg
    );

  const invalidation =
    invalidationAgent(
      bars,
      intraday,
      swing
    );

  const dayMeta =
    dayMetaAgent(
      thesis,
      momentum,
      intraday,
      meanReversion,
      timing,
      risk,
      invalidation,
      cfg
    );

  const swingMeta =
    swingMetaAgent(
      thesis,
      swing,
      relative,
      risk,
      invalidation,
      cfg
    );

  const final =
    finalDecision(
      dayMeta,
      swingMeta,
      timing,
      risk,
      invalidation
    );

  return {
    market,
    relative,
    intraday,
    momentum,
    meanReversion,
    swing,
    risk,
    thesis,
    timing,
    invalidation,
    dayMeta,
    swingMeta,
    final,
  };
}

/* =========================================================
 * EXECUTION
 * ========================================================= */

function executeBuy(
  price,
  slippageRate
) {
  return (
    price *
    (1 + slippageRate)
  );
}

function executeSell(
  price,
  slippageRate
) {
  return (
    price *
    (1 - slippageRate)
  );
}

function tradeReturn(
  entryPrice,
  exitPrice,
  feeRate
) {
  const gross =
    (
      exitPrice -
      entryPrice
    ) /
    entryPrice;

  return (
    gross -
    feeRate * 2
  );
}

/* =========================================================
 * DRAW DOWN
 * ========================================================= */

function maxDrawdown(
  equityCurve
) {
  if (
    !equityCurve.length
  ) {
    return 0;
  }

  let peak =
    equityCurve[0];

  let maxDd = 0;

  for (
    const value of
      equityCurve
  ) {
    if (
      value > peak
    ) {
      peak = value;
    }

    if (
      peak > 0
    ) {
      const dd =
        (
          peak -
          value
        ) / peak;

      maxDd =
        Math.max(
          maxDd,
          dd
        );
    }
  }

  return maxDd;
}

/* =========================================================
 * SHARPE / SORTINO
 * ========================================================= */

function sharpeRatio(
  returns,
  barsPerYear = 3276
) {
  if (
    returns.length < 2
  ) {
    return null;
  }

  const mean =
    average(returns);

  const deviation =
    std(returns);

  if (
    !deviation
  ) {
    return null;
  }

  return (
    (mean /
      deviation) *
    Math.sqrt(
      barsPerYear
    )
  );
}

function sortinoRatio(
  returns,
  barsPerYear = 3276
) {
  if (
    returns.length < 2
  ) {
    return null;
  }

  const mean =
    average(returns);

  const negative =
    returns.filter(
      (value) =>
        value < 0
    );

  if (
    !negative.length
  ) {
    return mean > 0
      ? Infinity
      : 0;
  }

  const downside =
    Math.sqrt(
      negative.reduce(
        (sum, value) =>
          sum +
          value ** 2,
        0
      ) /
        negative.length
    );

  if (
    !downside
  ) {
    return null;
  }

  return (
    (mean /
      downside) *
    Math.sqrt(
      barsPerYear
    )
  );
}

/* =========================================================
 * DAY KEY
 * ========================================================= */

function dayKey(bar) {
  if (bar.date) {
    return bar.date.slice(
      0,
      10
    );
  }

  if (
    bar.timestamp
  ) {
    return new Date(
      bar.timestamp *
        1000
    )
      .toISOString()
      .slice(
        0,
        10
      );
  }

  return '';
}

/* =========================================================
 * MAIN BACKTEST
 * ========================================================= */

function runQuantBacktest(
  bars,
  dates,
  options = {}
) {
  const cfg = {
    ...DEFAULTS,
    ...options,
  };

  if (
    !bars ||
    bars.length < 120
  ) {
    throw new Error(
      '데이트레이딩 백테스트에는 최소 120개의 장중 봉이 필요합니다.'
    );
  }

  let cash =
    cfg.initialCapital;

  let position =
    null;

  const equityCurve = [];
  const returns = [];
  const trades = [];

  let previousEquity =
    cfg.initialCapital;

  let currentDay =
    null;

  let tradesToday = 0;

  const agentSnapshots = [];

  /*
   * 충분한 warm-up 이후 시작.
   */
  const startIndex =
    Math.max(
      80,
      cfg.swingSlowPeriod +
        5
    );

  for (
    let t = startIndex;
    t < bars.length;
    t++
  ) {
    const bar =
      bars[t];

    const date =
      dates?.[t] ||
      dayKey(bar);

    const today =
      dayKey(bar) ||
      date;

    if (
      today !==
      currentDay
    ) {
      currentDay =
        today;

      tradesToday = 0;
    }

    const history =
      bars.slice(
        0,
        t + 1
      );

    const agents =
      analyzeAgents(
        history,
        cfg
      );

    /*
     * 최근 Agent 상태를 저장.
     */
    if (
      t ===
        bars.length - 1 ||
      t % 10 === 0
    ) {
      agentSnapshots.push({
        date,

        decision:
          agents.final
            .decision,

        score:
          agents.final.score,

        day:
          agents.dayMeta,

        swing:
          agents.swingMeta,

        risk:
          agents.risk,

        timing:
          agents.timing,
      });
    }

    /*
     * 현재 포지션 평가.
     */
    let equity =
      cash;

    if (
      position
    ) {
      equity =
        position.cashAfterEntry +
        position.quantity *
          bar.close;
    }

    /* =====================================================
     * EXIT ENGINE
     * ===================================================== */

    if (
      position
    ) {
      if (
        bar.high >
        position.highestPrice
      ) {
        position.highestPrice =
          bar.high;
      }

      const stopPrice =
        position.entryPrice -
        position.atr *
          cfg.atrStop;

      const targetPrice =
        position.entryPrice +
        position.atr *
          cfg.atrTarget;

      const trailingStop =
        position.highestPrice -
        position.atr *
          cfg.atrTrailing;

      let exitPrice =
        null;

      let exitReason =
        null;

      /*
       * STOP 우선.
       */
      if (
        bar.low <=
        stopPrice
      ) {
        exitPrice =
          stopPrice;

        exitReason =
          'ATR_STOP';
      } else if (
        bar.high >=
        targetPrice
      ) {
        exitPrice =
          targetPrice;

        exitReason =
          'ATR_TARGET';
      } else if (
        position.highestPrice >
          position.entryPrice &&
        bar.low <=
          trailingStop
      ) {
        exitPrice =
          trailingStop;

        exitReason =
          'TRAILING_STOP';
      } else if (
        agents.invalidation
          .score < 35
      ) {
        exitPrice =
          bar.close;

        exitReason =
          'THESIS_INVALIDATED';
      } else if (
        agents.final
          .decision ===
        'NO_TRADE'
      ) {
        /*
         * 기존 thesis가 완전히
         * 무너진 경우에만 종료.
         */
        if (
          position.holdingBars >=
          2
        ) {
          exitPrice =
            bar.close;

          exitReason =
            'META_EXIT';
        }
      } else if (
        position.holdingBars >=
        cfg.maxHoldingBars
      ) {
        exitPrice =
          bar.close;

        exitReason =
          'TIME_EXIT';
      }

      /*
       * 세션 종료 방지.
       */
      const nextBar =
        bars[t + 1];

      if (
        !nextBar ||
        dayKey(nextBar) !==
          today
      ) {
        if (
          exitPrice === null
        ) {
          exitPrice =
            bar.close;

          exitReason =
            'END_OF_SESSION';
        }
      }

      if (
        exitPrice !== null
      ) {
        const actualExit =
          executeSell(
            exitPrice,
            cfg.slippageRate
          );

        const proceeds =
          position.quantity *
          actualExit;

        const fee =
          proceeds *
          cfg.feeRate;

        cash =
          position.cashAfterEntry +
          proceeds -
          fee;

        const result =
          tradeReturn(
            position.entryPrice,
            actualExit,
            cfg.feeRate
          );

        trades.push({
          type: 'SELL',

          date,

          price:
            actualExit,

          entryPrice:
            position.entryPrice,

          returnPct:
            result * 100,

          reason:
            exitReason,

          holdingBars:
            position.holdingBars,

          setup:
            position.setup,

          entryDecision:
            position.entryDecision,

          entryScore:
            position.entryScore,
        });

        position =
          null;

        tradesToday++;

        equity =
          cash;
      } else {
        position.holdingBars++;
      }
    }

    /* =====================================================
     * ENTRY ENGINE
     * ===================================================== */

    if (
      !position &&
      tradesToday <
        cfg.maxTradesPerDay
    ) {
      const finalDecision =
        agents.final
          .decision;

      /*
       * DAY BUY만 즉시 진입.
       *
       * SWING BUY_DAY_WAIT는
       * 스윙 thesis는 좋지만
       * timing이 나쁘므로
       * 이 DAY 백테스트에서는
       * 추격 진입하지 않는다.
       */
      const canEnter =
        finalDecision ===
        'DAY_BUY';

      if (
        canEnter &&
        agents.final.score >=
          cfg.dayMinScore &&
        agents.risk.risk !==
          'HIGH' &&
        agents.invalidation
          .valid
      ) {
        const atrValue =
          agents.risk.atr;

        if (
          atrValue &&
          atrValue > 0
        ) {
          const entryPrice =
            executeBuy(
              bar.close,
              cfg.slippageRate
            );

          const riskPerShare =
            atrValue *
            cfg.atrStop;

          const riskCapital =
            cash *
            cfg.riskPerTrade;

          let quantity =
            Math.floor(
              riskCapital /
                riskPerShare
            );

          const maxCapital =
            cash *
            cfg.maxPositionPct;

          const maxQuantity =
            Math.floor(
              maxCapital /
                (
                  entryPrice *
                  (
                    1 +
                    cfg.feeRate
                  )
                )
            );

          quantity =
            Math.min(
              quantity,
              maxQuantity
            );

          /*
           * 최소 기대 손익비 확인.
           */
          const expectedTarget =
            entryPrice +
            atrValue *
              cfg.atrTarget;

          const expectedStop =
            entryPrice -
            atrValue *
              cfg.atrStop;

          const upside =
            expectedTarget -
            entryPrice;

          const downside =
            entryPrice -
            expectedStop;

          const riskReward =
            downside > 0
              ? upside /
                downside
              : 0;

          if (
            quantity > 0 &&
            riskReward >=
              cfg.minRiskReward
          ) {
            const cost =
              quantity *
              entryPrice;

            const fee =
              cost *
              cfg.feeRate;

            if (
              cost + fee <=
              cash
            ) {
              cash -=
                cost + fee;

              position = {
                entryPrice,

                quantity,

                cashAfterEntry:
                  cash,

                atr:
                  atrValue,

                highestPrice:
                  bar.high,

                holdingBars:
                  0,

                setup:
                  'MULTI_AGENT_DAY',

                entryDecision:
                  finalDecision,

                entryScore:
                  agents.final.score,

                riskReward,
              };

              trades.push({
                type: 'BUY',

                date,

                price:
                  entryPrice,

                quantity,

                strength:
                  agents.final.score,

                setup:
                  'MULTI_AGENT_DAY',

                reason:
                  'MULTI_AGENT_CONSENSUS',

                riskReward,

                agents: {
                  market:
                    agents.market.score,

                  relative:
                    agents.relative.score,

                  intraday:
                    agents.intraday.score,

                  momentum:
                    agents.momentum.score,

                  swing:
                    agents.swing.score,

                  risk:
                    agents.risk.score,

                  timing:
                    agents.timing.score,
                },
              });

              tradesToday++;

              equity =
                cash +
                quantity *
                  bar.close;
            }
          }
        }
      }
    }

    if (
      position
    ) {
      equity =
        position.cashAfterEntry +
        position.quantity *
          bar.close;
    } else {
      equity =
        cash;
    }

    equityCurve.push(
      equity
    );

    if (
      previousEquity > 0
    ) {
      returns.push(
        equity /
          previousEquity -
          1
      );
    }

    previousEquity =
      equity;
  }

  /* =====================================================
   * FINAL EXIT
   * ===================================================== */

  if (
    position
  ) {
    const last =
      bars[
        bars.length - 1
      ];

    const actualExit =
      executeSell(
        last.close,
        cfg.slippageRate
      );

    const proceeds =
      position.quantity *
      actualExit;

    const fee =
      proceeds *
      cfg.feeRate;

    cash =
      position.cashAfterEntry +
      proceeds -
      fee;

    const result =
      tradeReturn(
        position.entryPrice,
        actualExit,
        cfg.feeRate
      );

    trades.push({
      type: 'SELL',

      date:
        dates?.[
          bars.length - 1
        ],

      price:
        actualExit,

      entryPrice:
        position.entryPrice,

      returnPct:
        result * 100,

      reason:
        'END_OF_DATA',

      holdingBars:
        position.holdingBars,

      setup:
        position.setup,
    });

    position =
      null;
  }

  /* =====================================================
   * STATISTICS
   * ===================================================== */

  const startPrice =
    bars[startIndex].close;

  const endPrice =
    bars[
      bars.length - 1
    ].close;

  const buyHoldReturn =
    (
      (
        endPrice -
        startPrice
      ) /
      startPrice
    ) * 100;

  const strategyReturn =
    (
      (
        cash -
        cfg.initialCapital
      ) /
      cfg.initialCapital
    ) * 100;

  const completedTrades =
    trades.filter(
      (trade) =>
        trade.type ===
        'SELL'
    );

  const wins =
    completedTrades.filter(
      (trade) =>
        Number(
          trade.returnPct
        ) > 0
    );

  const losses =
    completedTrades.filter(
      (trade) =>
        Number(
          trade.returnPct
        ) < 0
    );

  const winRate =
    completedTrades.length
      ? (
          wins.length /
          completedTrades.length
        ) * 100
      : null;

  const grossProfit =
    wins.reduce(
      (sum, trade) =>
        sum +
        Number(
          trade.returnPct
        ),
      0
    );

  const grossLoss =
    Math.abs(
      losses.reduce(
        (sum, trade) =>
          sum +
          Number(
            trade.returnPct
          ),
        0
      )
    );

  const profitFactor =
    grossLoss > 0
      ? grossProfit /
        grossLoss
      : null;

  const mdd =
    maxDrawdown(
      equityCurve
    ) * 100;

  const sharpe =
    sharpeRatio(
      returns
    );

  const sortino =
    sortinoRatio(
      returns
    );

  const dayTrades =
    completedTrades.filter(
      (trade) =>
        trade.setup ===
        'MULTI_AGENT_DAY'
    ).length;

  const setupCounts = {
    MULTI_AGENT_DAY:
      dayTrades,
  };

  /*
   * Agent average statistics.
   */
  const latest =
    agentSnapshots[
      agentSnapshots.length - 1
    ];

  return {
    strategyReturnPct:
      strategyReturn.toFixed(
        2
      ),

    buyHoldReturnPct:
      buyHoldReturn.toFixed(
        2
      ),

    alphaPct:
      (
        strategyReturn -
        buyHoldReturn
      ).toFixed(2),

    numTrades:
      completedTrades.length,

    winRatePct:
      winRate !== null
        ? winRate.toFixed(
            1
          )
        : 'N/A',

    profitFactor:
      profitFactor !== null
        ? profitFactor.toFixed(
            2
          )
        : 'N/A',

    sharpe:
      sharpe !== null
        ? Number(
            sharpe.toFixed(
              2
            )
          )
        : 'N/A',

    sortino:
      sortino !== null &&
      Number.isFinite(
        sortino
      )
        ? Number(
            sortino.toFixed(
              2
            )
          )
        : 'N/A',

    maxDrawdownPct:
      mdd.toFixed(2),

    trades:
      trades.slice(-50),

    equityCurve,

    setupCounts,

    latestAgents:
      latest || null,

    agentSnapshots:
      agentSnapshots.slice(
        -100
      ),

    parameters:
      cfg,

    dataType:
      '30분봉 멀티에이전트 OHLCV',

    architecture: {
      day: [
        'MARKET',
        'RELATIVE_STRENGTH',
        'INTRADAY_TREND',
        'MOMENTUM',
        'MEAN_REVERSION',
        'RISK',
        'TIMING',
        'INVALIDATION',
        'DAY_META',
      ],

      swing: [
        'MARKET',
        'RELATIVE_STRENGTH',
        'SWING_TREND',
        'RISK',
        'INVALIDATION',
        'SWING_META',
      ],

      final:
        'FINAL_DECISION_ENGINE',
    },

    limitation:
      '현재 백테스트는 OHLCV 기반입니다. 과거 시점의 뉴스/실적/매크로 이벤트를 point-in-time으로 재구성하지 않으므로 해당 정보는 백테스트에 사용하지 않습니다. 실제 뉴스 기반 AI 판단은 실시간 분석 레이어에서 별도로 처리해야 합니다.',
  };
}

/* =========================================================
 * LEGACY API
 * ========================================================= */

function runBacktest(
  closes,
  dates,
  options = {}
) {
  if (
    !closes ||
    closes.length < 40
  ) {
    throw new Error(
      '백테스트에 필요한 데이터가 부족합니다'
    );
  }

  const bars =
    closes.map(
      (close, i) => {
        const previous =
          i > 0
            ? closes[i - 1]
            : close;

        return {
          open:
            previous,

          high:
            Math.max(
              close,
              previous
            ),

          low:
            Math.min(
              close,
              previous
            ),

          close,

          volume:
            1,
        };
      }
    );

  return runQuantBacktest(
    bars,
    dates,
    options
  );
}

/* =========================================================
 * UP PROBABILITY
 * ========================================================= */

function computeUpProbability(
  closes,
  score
) {
  if (
    !closes ||
    closes.length < 30
  ) {
    return {
      byHorizon: {},
    };
  }

  const horizons = [
    1,
    5,
    10,
    20,
  ];

  const result = {};

  for (
    const horizon of
      horizons
  ) {
    const returns = [];

    for (
      let i = 20;
      i <
      closes.length -
        horizon;
      i++
    ) {
      const base =
        closes[i];

      const future =
        closes[
          i + horizon
        ];

      if (
        base > 0
      ) {
        returns.push(
          (
            (
              future -
              base
            ) /
            base
          ) * 100
        );
      }
    }

    if (
      returns.length < 5
    ) {
      result[horizon] = {
        probability:
          null,

        avgReturnPct:
          null,

        confidence:
          '데이터 부족',
      };

      continue;
    }

    const positive =
      returns.filter(
        (value) =>
          value > 0
      ).length;

    const probability =
      (
        positive /
        returns.length
      ) * 100;

    const avg =
      average(
        returns
      );

    result[horizon] = {
      probability:
        Number(
          probability.toFixed(
            1
          )
        ),

      avgReturnPct:
        Number(
          avg.toFixed(2)
        ),

      confidence:
        returns.length >=
        100
          ? '높음'
          : returns.length >=
              30
            ? '중간'
            : '낮음',
    };
  }

  return {
    byHorizon:
      result,

    score,
  };
}

module.exports = {
  runQuantBacktest,
  runBacktest,
  computeUpProbability,
  analyzeAgents,
};
