// lib/indicators.js
// Multi-Agent Quant Engine
//
// 모든 배열은 과거 -> 최신 순서.
//
// Agent:
// 1. Trend
// 2. Momentum
// 3. VWAP
// 4. Breakout
// 5. Mean Reversion
// 6. Volume
// 7. Volatility
// 8. Market Regime
// 9. Price Action
// 10. Risk
//
// 최종적으로 Ensemble Judge가
// 여러 Agent의 의견을 종합하여
// LONG / WAIT / EXIT를 결정한다.

function sma(values, period) {
  if (!values || values.length < period) {
    return null;
  }

  const slice = values.slice(-period);

  return (
    slice.reduce((a, b) => a + b, 0) /
    period
  );
}

function ema(values, period) {
  if (!values || values.length < period) {
    return null;
  }

  const k = 2 / (period + 1);

  let value = sma(
    values.slice(0, period),
    period
  );

  for (let i = period; i < values.length; i++) {
    value =
      values[i] * k +
      value * (1 - k);
  }

  return value;
}

function emaSeries(values, period) {
  if (!values || values.length < period) {
    return [];
  }

  const k = 2 / (period + 1);

  const result = [];

  let value = sma(
    values.slice(0, period),
    period
  );

  result.push(value);

  for (let i = period; i < values.length; i++) {
    value =
      values[i] * k +
      value * (1 - k);

    result.push(value);
  }

  return result;
}

function rsi(closes, period = 14) {
  if (
    !closes ||
    closes.length < period + 1
  ) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (
    let i = closes.length - period;
    i < closes.length;
    i++
  ) {
    const diff =
      closes[i] -
      closes[i - 1];

    if (diff > 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }

  const avgGain =
    gains / period;

  const avgLoss =
    losses / period;

  if (avgLoss === 0) {
    return 100;
  }

  const rs =
    avgGain / avgLoss;

  return (
    100 -
    100 / (1 + rs)
  );
}

function macd(
  closes,
  fast = 12,
  slow = 26,
  signalPeriod = 9
) {
  if (
    !closes ||
    closes.length <
      slow + signalPeriod
  ) {
    return null;
  }

  const fastSeries =
    emaSeries(
      closes,
      fast
    );

  const slowSeries =
    emaSeries(
      closes,
      slow
    );

  const offset =
    fastSeries.length -
    slowSeries.length;

  const macdLine =
    slowSeries.map(
      (value, i) =>
        fastSeries[
          i + offset
        ] - value
    );

  const signalLine =
    emaSeries(
      macdLine,
      signalPeriod
    );

  if (!signalLine.length) {
    return null;
  }

  const signalOffset =
    macdLine.length -
    signalLine.length;

  const histogram =
    signalLine.map(
      (value, i) =>
        macdLine[
          i + signalOffset
        ] - value
    );

  return {
    macd:
      macdLine[
        macdLine.length - 1
      ],

    signal:
      signalLine[
        signalLine.length - 1
      ],

    histogram:
      histogram[
        histogram.length - 1
      ],
  };
}

function bollingerBands(
  closes,
  period = 20,
  stdDevMult = 2
) {
  if (
    !closes ||
    closes.length < period
  ) {
    return null;
  }

  const slice =
    closes.slice(-period);

  const mean =
    slice.reduce(
      (a, b) => a + b,
      0
    ) / period;

  const variance =
    slice.reduce(
      (sum, value) =>
        sum +
        (value - mean) ** 2,
      0
    ) / period;

  const stdDev =
    Math.sqrt(variance);

  return {
    upper:
      mean +
      stdDevMult *
        stdDev,

    middle:
      mean,

    lower:
      mean -
      stdDevMult *
        stdDev,

    width:
      mean
        ? (
            (stdDevMult *
              2 *
              stdDev) /
            mean
          ) *
          100
        : 0,

    stdDev,
  };
}

function trueRange(
  high,
  low,
  previousClose
) {
  return Math.max(
    high - low,
    Math.abs(
      high -
        previousClose
    ),
    Math.abs(
      low -
        previousClose
    )
  );
}

function atrSeries(
  highs,
  lows,
  closes,
  period = 14
) {
  if (
    !highs ||
    !lows ||
    !closes ||
    closes.length <
      period + 1
  ) {
    return [];
  }

  const trs = [];

  for (
    let i = 1;
    i < closes.length;
    i++
  ) {
    trs.push(
      trueRange(
        highs[i],
        lows[i],
        closes[i - 1]
      )
    );
  }

  if (
    trs.length < period
  ) {
    return [];
  }

  const result = [];

  let value =
    trs
      .slice(
        0,
        period
      )
      .reduce(
        (a, b) =>
          a + b,
        0
      ) /
    period;

  result.push(value);

  for (
    let i = period;
    i < trs.length;
    i++
  ) {
    value =
      (
        value *
          (period - 1) +
        trs[i]
      ) /
      period;

    result.push(value);
  }

  return result;
}

function atr(
  highs,
  lows,
  closes,
  period = 14
) {
  const series =
    atrSeries(
      highs,
      lows,
      closes,
      period
    );

  return series.length
    ? series[
        series.length - 1
      ]
    : null;
}

function vwap(
  highs,
  lows,
  closes,
  volumes,
  period = 20
) {
  if (
    !highs ||
    !lows ||
    !closes ||
    !volumes ||
    closes.length < period
  ) {
    return null;
  }

  let priceVolume = 0;
  let volumeTotal = 0;

  const start =
    closes.length -
    period;

  for (
    let i = start;
    i < closes.length;
    i++
  ) {
    const typical =
      (
        highs[i] +
        lows[i] +
        closes[i]
      ) / 3;

    const volume =
      Number(
        volumes[i]
      ) || 0;

    priceVolume +=
      typical * volume;

    volumeTotal +=
      volume;
  }

  if (!volumeTotal) {
    return sma(
      closes,
      period
    );
  }

  return (
    priceVolume /
    volumeTotal
  );
}

function roc(
  closes,
  period = 10
) {
  if (
    !closes ||
    closes.length <= period
  ) {
    return null;
  }

  const current =
    closes[
      closes.length - 1
    ];

  const previous =
    closes[
      closes.length -
        1 -
        period
    ];

  if (!previous) {
    return null;
  }

  return (
    ((current -
      previous) /
      previous) *
    100
  );
}

function stdDev(
  values,
  period = 20
) {
  if (
    !values ||
    values.length < period
  ) {
    return null;
  }

  const slice =
    values.slice(-period);

  const mean =
    slice.reduce(
      (a, b) =>
        a + b,
      0
    ) / period;

  const variance =
    slice.reduce(
      (sum, value) =>
        sum +
        (value - mean) ** 2,
      0
    ) / period;

  return Math.sqrt(
    variance
  );
}

function zScore(
  values,
  period = 20
) {
  if (
    !values ||
    values.length < period
  ) {
    return null;
  }

  const slice =
    values.slice(-period);

  const mean =
    slice.reduce(
      (a, b) =>
        a + b,
      0
    ) / period;

  const deviation =
    stdDev(
      values,
      period
    );

  if (!deviation) {
    return 0;
  }

  return (
    (
      slice[
        slice.length - 1
      ] -
      mean
    ) /
    deviation
  );
}

function highest(
  values,
  period
) {
  if (
    !values ||
    values.length < period
  ) {
    return null;
  }

  return Math.max(
    ...values.slice(-period)
  );
}

function lowest(
  values,
  period
) {
  if (
    !values ||
    values.length < period
  ) {
    return null;
  }

  return Math.min(
    ...values.slice(-period)
  );
}

function trendStrength(
  closes,
  fastPeriod = 20,
  slowPeriod = 50
) {
  const fast =
    ema(
      closes,
      fastPeriod
    );

  const slow =
    ema(
      closes,
      slowPeriod
    );

  if (
    !fast ||
    !slow
  ) {
    return null;
  }

  return (
    ((fast - slow) /
      slow) *
    100
  );
}

function clamp(
  value,
  min = -100,
  max = 100
) {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}

function safeNumber(
  value,
  fallback = 0
) {
  return Number.isFinite(
    Number(value)
  )
    ? Number(value)
    : fallback;
}

/*
 * ============================================================
 * Agent 1: Trend
 * ============================================================
 */

function trendAgent(
  closes,
  emaFast,
  emaSlow,
  emaTrend,
  atrValue
) {
  let score = 0;

  if (
    emaFast &&
    emaSlow &&
    emaTrend
  ) {
    if (
      emaFast >
      emaSlow
    ) {
      score += 30;
    } else {
      score -= 30;
    }

    if (
      emaSlow >
      emaTrend
    ) {
      score += 30;
    } else {
      score -= 30;
    }

    const slope =
      closes.length >= 10
        ? (
            closes[
              closes.length - 1
            ] -
            closes[
              closes.length - 10
            ]
          ) /
          closes[
            closes.length - 10
          ]
        : 0;

    if (slope > 0) {
      score += 25;
    } else if (
      slope < 0
    ) {
      score -= 25;
    }

    if (
      atrValue &&
      emaTrend
    ) {
      const distance =
        Math.abs(
          emaFast -
            emaTrend
        ) /
        atrValue;

      if (
        distance > 0.5
      ) {
        score +=
          emaFast >
          emaTrend
            ? 15
            : -15;
      }
    }
  }

  return {
    name: 'TREND',
    score: clamp(score),
  };
}

/*
 * ============================================================
 * Agent 2: Momentum
 * ============================================================
 */

function momentumAgent(
  closes,
  rsiValue,
  macdValue
) {
  let score = 0;

  const roc3 =
    roc(closes, 3);

  const roc8 =
    roc(closes, 8);

  const roc20 =
    roc(closes, 20);

  if (
    roc3 !== null
  ) {
    if (roc3 > 0) {
      score += 20;
    } else {
      score -= 20;
    }
  }

  if (
    roc8 !== null
  ) {
    if (roc8 > 0) {
      score += 25;
    } else {
      score -= 25;
    }
  }

  if (
    roc20 !== null
  ) {
    if (roc20 > 0) {
      score += 20;
    } else {
      score -= 20;
    }
  }

  if (macdValue) {
    if (
      macdValue.histogram >
      0
    ) {
      score += 20;
    } else {
      score -= 20;
    }

    if (
      macdValue.macd >
      macdValue.signal
    ) {
      score += 15;
    } else {
      score -= 15;
    }
  }

  /*
   * RSI는 단순히 높을수록
   * 좋은 것으로 판단하지 않는다.
   *
   * 50~65:
   * 건강한 상승 모멘텀.
   *
   * 70 이상:
   * 과열 가능성.
   */
  if (
    rsiValue !== null
  ) {
    if (
      rsiValue >= 50 &&
      rsiValue <= 65
    ) {
      score += 20;
    } else if (
      rsiValue > 70
    ) {
      score -= 15;
    } else if (
      rsiValue < 35
    ) {
      score += 5;
    } else if (
      rsiValue < 45
    ) {
      score -= 10;
    }
  }

  return {
    name: 'MOMENTUM',
    score: clamp(score),

    details: {
      roc3,
      roc8,
      roc20,
      rsi: rsiValue,
    },
  };
}

/*
 * ============================================================
 * Agent 3: VWAP
 * ============================================================
 */

function vwapAgent(
  last,
  currentVwap,
  atrValue
) {
  if (
    !currentVwap ||
    !atrValue
  ) {
    return {
      name: 'VWAP',
      score: 0,
    };
  }

  const distance =
    (
      last -
      currentVwap
    ) /
    atrValue;

  let score = 0;

  if (
    distance > 0 &&
    distance < 1.5
  ) {
    score += 45;
  }

  if (
    distance >= 1.5 &&
    distance < 2.5
  ) {
    score += 15;
  }

  if (
    distance >= 2.5
  ) {
    score -= 35;
  }

  if (
    distance < 0 &&
    distance > -0.8
  ) {
    score += 5;
  }

  if (
    distance <= -0.8
  ) {
    score -= 35;
  }

  return {
    name: 'VWAP',
    score: clamp(score),
    distance,
  };
}

/*
 * ============================================================
 * Agent 4: Breakout
 * ============================================================
 */

function breakoutAgent(
  highs,
  lows,
  closes,
  volumes
) {
  if (
    closes.length < 30
  ) {
    return {
      name: 'BREAKOUT',
      score: 0,
    };
  }

  const last =
    closes[
      closes.length - 1
    ];

  const previousHigh =
    Math.max(
      ...highs.slice(
        -21,
        -1
      )
    );

  const previousLow =
    Math.min(
      ...lows.slice(
        -21,
        -1
      )
    );

  const volumeZ =
    zScore(
      volumes,
      20
    );

  let score = 0;

  if (
    last >
    previousHigh
  ) {
    score += 55;
  }

  if (
    last <
    previousLow
  ) {
    score -= 45;
  }

  if (
    volumeZ !== null
  ) {
    if (
      volumeZ > 1
    ) {
      score += 25;
    } else if (
      volumeZ > 0.3
    ) {
      score += 10;
    } else if (
      volumeZ < -0.5
    ) {
      score -= 20;
    }
  }

  return {
    name: 'BREAKOUT',
    score: clamp(score),

    breakoutUp:
      last >
      previousHigh,

    breakdown:
      last <
      previousLow,

    previousHigh,
    previousLow,
    volumeZ,
  };
}

/*
 * ============================================================
 * Agent 5: Mean Reversion
 * ============================================================
 */

function meanReversionAgent(
  closes,
  rsiValue,
  bb,
  currentVwap
) {
  let score = 0;

  const last =
    closes[
      closes.length - 1
    ];

  if (bb) {
    if (
      last <
      bb.lower
    ) {
      score += 55;
    }

    if (
      last >
      bb.upper
    ) {
      score -= 45;
    }

    if (
      last >
      bb.lower &&
      last <
      bb.middle
    ) {
      score += 10;
    }
  }

  if (
    rsiValue !== null
  ) {
    if (
      rsiValue < 30
    ) {
      score += 35;
    } else if (
      rsiValue < 40
    ) {
      score += 15;
    }

    if (
      rsiValue > 75
    ) {
      score -= 35;
    }
  }

  if (
    currentVwap &&
    last <
      currentVwap
  ) {
    const distance =
      (
        currentVwap -
        last
      ) /
      currentVwap;

    if (
      distance > 0.01
    ) {
      score += 15;
    }
  }

  return {
    name: 'MEAN_REVERSION',
    score: clamp(score),
  };
}

/*
 * ============================================================
 * Agent 6: Volume
 * ============================================================
 */

function volumeAgent(
  volumes
) {
  const volumeZ =
    zScore(
      volumes,
      20
    );

  let score = 0;

  if (
    volumeZ === null
  ) {
    return {
      name: 'VOLUME',
      score: 0,
    };
  }

  if (
    volumeZ >= 1.5
  ) {
    score += 45;
  } else if (
    volumeZ >= 0.7
  ) {
    score += 30;
  } else if (
    volumeZ >= 0
  ) {
    score += 10;
  } else if (
    volumeZ < -1
  ) {
    score -= 20;
  }

  return {
    name: 'VOLUME',
    score: clamp(score),
    volumeZ,
  };
}

/*
 * ============================================================
 * Agent 7: Volatility
 * ============================================================
 */

function volatilityAgent(
  highs,
  lows,
  closes,
  atrValue,
  bb
) {
  if (
    !atrValue ||
    !closes.length
  ) {
    return {
      name: 'VOLATILITY',
      score: 0,
      regime:
        'UNKNOWN',
    };
  }

  const last =
    closes[
      closes.length - 1
    ];

  const atrPct =
    (
      atrValue /
      last
    ) * 100;

  let score = 0;

  let regime =
    'NORMAL';

  if (
    bb &&
    bb.width < 1.5
  ) {
    regime =
      'SQUEEZE';

    score += 15;
  }

  if (
    atrPct < 0.5
  ) {
    regime =
      'LOW_VOL';

    score -= 10;
  }

  if (
    atrPct > 4
  ) {
    regime =
      'HIGH_VOL';

    score -= 15;
  }

  return {
    name: 'VOLATILITY',
    score: clamp(score),
    atrPct,
    regime,
  };
}

/*
 * ============================================================
 * Agent 8: Market Regime
 * ============================================================
 */

function regimeAgent(
  closes,
  emaFast,
  emaSlow,
  emaTrend,
  atrValue,
  bb
) {
  let regime =
    'SIDEWAYS';

  let score = 0;

  if (
    emaFast &&
    emaSlow &&
    emaTrend
  ) {
    const bullish =
      emaFast >
        emaSlow &&
      emaSlow >
        emaTrend;

    const bearish =
      emaFast <
        emaSlow &&
      emaSlow <
        emaTrend;

    if (bullish) {
      regime =
        'BULL_TREND';

      score += 40;
    } else if (
      bearish
    ) {
      regime =
        'BEAR_TREND';

      score -= 40;
    }
  }

  if (
    bb &&
    bb.width < 2
  ) {
    regime =
      'COMPRESSION';

    score += 5;
  }

  if (
    atrValue &&
    closes.length >= 20
  ) {
    const last =
      closes[
        closes.length - 1
      ];

    const atrPct =
      (
        atrValue /
        last
      ) * 100;

    if (
      atrPct > 3
    ) {
      regime =
        regime ===
        'BULL_TREND'
          ? 'BULL_HIGH_VOL'
          : 'HIGH_VOL';

      score -= 5;
    }
  }

  return {
    name: 'REGIME',
    score: clamp(score),
    regime,
  };
}

/*
 * ============================================================
 * Agent 9: Price Action
 * ============================================================
 */

function priceActionAgent(
  bars,
  atrValue
) {
  if (
    bars.length < 5 ||
    !atrValue
  ) {
    return {
      name: 'PRICE_ACTION',
      score: 0,
    };
  }

  const last =
    bars[
      bars.length - 1
    ];

  const previous =
    bars[
      bars.length - 2
    ];

  const body =
    last.close -
    last.open;

  const range =
    last.high -
    last.low;

  if (!range) {
    return {
      name: 'PRICE_ACTION',
      score: 0,
    };
  }

  const bodyRatio =
    Math.abs(body) /
    range;

  const upperWick =
    last.high -
    Math.max(
      last.open,
      last.close
    );

  const lowerWick =
    Math.min(
      last.open,
      last.close
    ) -
    last.low;

  let score = 0;

  /*
   * 강한 양봉.
   */
  if (
    body > 0 &&
    bodyRatio > 0.65
  ) {
    score += 35;
  }

  /*
   * 강한 음봉.
   */
  if (
    body < 0 &&
    bodyRatio > 0.65
  ) {
    score -= 35;
  }

  /*
   * 아래꼬리 회복.
   */
  if (
    lowerWick >
      Math.abs(body) *
        1.5 &&
    last.close >
      last.open
  ) {
    score += 20;
  }

  /*
   * 위꼬리 거부.
   */
  if (
    upperWick >
      Math.abs(body) *
        1.5 &&
    last.close <
      last.open
  ) {
    score -= 20;
  }

  return {
    name: 'PRICE_ACTION',
    score: clamp(score),

    bodyRatio,
    upperWick,
    lowerWick,
  };
}

/*
 * ============================================================
 * Agent 10: Risk
 * ============================================================
 */

function riskAgent(
  last,
  atrValue,
  currentVwap,
  bb
) {
  let score = 0;

  if (
    !atrValue ||
    !last
  ) {
    return {
      name: 'RISK',
      score: 0,
      blocked: false,
    };
  }

  const atrPct =
    (
      atrValue /
      last
    ) * 100;

  let blocked =
    false;

  /*
   * 너무 높은 변동성.
   */
  if (
    atrPct > 5
  ) {
    score -= 60;
    blocked = true;
  }

  /*
   * VWAP에서 지나치게 멀리 떨어진
   * 가격 추격 방지.
   */
  if (
    currentVwap
  ) {
    const distance =
      Math.abs(
        last -
          currentVwap
      ) /
      atrValue;

    if (
      distance > 3
    ) {
      score -= 60;
      blocked = true;
    }
  }

  /*
   * Bollinger 상단 극단값.
   */
  if (
    bb &&
    last >
      bb.upper &&
    bb.width > 4
  ) {
    score -= 35;
  }

  return {
    name: 'RISK',
    score: clamp(score),
    blocked,
    atrPct,
  };
}

/*
 * ============================================================
 * Ensemble Judge
 * ============================================================
 */

function judgeAgents(
  agents,
  regime,
  cfg
) {
  const baseWeights = {
    TREND: 1.15,
    MOMENTUM: 1.1,
    VWAP: 1.0,
    BREAKOUT: 1.0,
    MEAN_REVERSION: 0.8,
    VOLUME: 0.85,
    VOLATILITY: 0.65,
    REGIME: 1.0,
    PRICE_ACTION: 0.8,
    RISK: 1.25,
  };

  /*
   * 시장 국면에 따라
   * Agent 중요도를 동적으로 조절.
   */
  const weights = {
    ...baseWeights,
  };

  if (
    regime ===
    'BULL_TREND' ||
    regime ===
    'BULL_HIGH_VOL'
  ) {
    weights.TREND *= 1.25;
    weights.MOMENTUM *= 1.2;
    weights.BREAKOUT *= 1.15;
    weights.MEAN_REVERSION *= 0.65;
  }

  if (
    regime ===
    'BEAR_TREND'
  ) {
    weights.TREND *= 1.2;
    weights.MOMENTUM *= 1.15;
    weights.BREAKOUT *= 0.9;
    weights.MEAN_REVERSION *= 0.75;
  }

  if (
    regime ===
    'SIDEWAYS'
  ) {
    weights.MEAN_REVERSION *= 1.35;
    weights.VWAP *= 1.2;
    weights.BREAKOUT *= 0.8;
    weights.TREND *= 0.8;
  }

  if (
    regime ===
    'COMPRESSION'
  ) {
    weights.BREAKOUT *= 1.3;
    weights.VOLUME *= 1.15;
  }

  let weightedScore = 0;

  let totalWeight = 0;

  const contributions = {};

  agents.forEach(
    (agent) => {
      const weight =
        weights[
          agent.name
        ] || 1;

      const contribution =
        agent.score *
        weight;

      weightedScore +=
        contribution;

      totalWeight +=
        Math.abs(weight);

      contributions[
        agent.name
      ] = {
        score:
          Number(
            agent.score.toFixed(
              2
            )
          ),

        weight:
          Number(
            weight.toFixed(
              2
            )
          ),

        contribution:
          Number(
            contribution.toFixed(
              2
            )
          ),
      };
    }
  );

  const normalized =
    totalWeight
      ? weightedScore /
        totalWeight
      : 0;

  /*
   * 강한 합의가 있는지 확인.
   */
  const bullish =
    agents.filter(
      (agent) =>
        agent.score >= 20
    ).length;

  const bearish =
    agents.filter(
      (agent) =>
        agent.score <= -20
    ).length;

  const riskAgent =
    agents.find(
      (agent) =>
        agent.name ===
        'RISK'
    );

  const blocked =
    Boolean(
      riskAgent?.blocked
    );

  /*
   * 시장 전체 합의도.
   */
  const totalAgents =
    agents.length;

  const agreement =
    totalAgents
      ? Math.abs(
          bullish -
            bearish
        ) /
        totalAgents
      : 0;

  let confidence =
    Math.abs(
      normalized
    );

  /*
   * Agent 의견이 서로 충돌하면
   * confidence를 낮춘다.
   */
  if (
    bullish > 0 &&
    bearish > 0
  ) {
    confidence *=
      0.75;
  }

  /*
   * 명확한 합의가 있으면
   * confidence 상승.
   */
  if (
    bullish >= 6 &&
    bearish <= 2
  ) {
    confidence *=
      1.15;
  }

  if (
    bearish >= 6 &&
    bullish <= 2
  ) {
    confidence *=
      1.15;
  }

  confidence =
    clamp(
      confidence,
      0,
      100
    );

  let signal =
    0;

  let reason =
    '에이전트 의견 불충분';

  if (
    blocked
  ) {
    signal = 0;

    reason =
      'Risk Agent가 진입 차단';
  } else if (
    normalized >=
      cfg.longThreshold &&
    bullish >=
      cfg.minBullishAgents
  ) {
    signal = 1;

    reason =
      '다중 에이전트 상승 합의';
  } else if (
    normalized <=
      cfg.exitThreshold &&
    bearish >=
      cfg.minBearishAgents
  ) {
    signal = -1;

    reason =
      '다중 에이전트 하락 합의';
  }

  /*
   * 확신도가 너무 낮은 신호는 제거.
   */
  if (
    signal === 1 &&
    confidence <
      cfg.minConfidence
  ) {
    signal = 0;

    reason =
      '신호 방향은 상승이나 에이전트 확신도 부족';
  }

  return {
    signal,

    score:
      clamp(
        normalized
      ),

    confidence:
      Number(
        confidence.toFixed(
          1
        )
      ),

    agreement:
      Number(
        agreement.toFixed(
          2
        )
      ),

    bullishAgents:
      bullish,

    bearishAgents:
      bearish,

    contributions,
  };
}

/*
 * ============================================================
 * 새로운 Multi-Agent Quant Signal
 * ============================================================
 */

function quantSignal(
  bars,
  options = {}
) {
  const cfg = {
    emaFast: 9,
    emaSlow: 21,
    emaTrend: 50,

    vwapPeriod: 20,

    atrPeriod: 14,

    rsiPeriod: 14,

    longThreshold: 25,

    exitThreshold: -25,

    minConfidence: 38,

    minBullishAgents: 4,

    minBearishAgents: 4,

    ...options,
  };

  if (
    !bars ||
    bars.length < 100
  ) {
    return {
      signal: 0,
      strength: 0,
      confidence: 0,
      setup: 'NONE',
      reason: '데이터 부족',
      agents: {},
      indicators: {},
    };
  }

  const opens =
    bars.map(
      (b) =>
        safeNumber(
          b.open
        )
    );

  const highs =
    bars.map(
      (b) =>
        safeNumber(
          b.high
        )
    );

  const lows =
    bars.map(
      (b) =>
        safeNumber(
          b.low
        )
    );

  const closes =
    bars.map(
      (b) =>
        safeNumber(
          b.close
        )
    );

  const volumes =
    bars.map(
      (b) =>
        safeNumber(
          b.volume
        )
    );

  const last =
    closes[
      closes.length - 1
    ];

  const previous =
    closes[
      closes.length - 2
    ];

  const emaFast =
    ema(
      closes,
      cfg.emaFast
    );

  const emaSlow =
    ema(
      closes,
      cfg.emaSlow
    );

  const emaTrend =
    ema(
      closes,
      cfg.emaTrend
    );

  const atrValue =
    atr(
      highs,
      lows,
      closes,
      cfg.atrPeriod
    );

  const currentVwap =
    vwap(
      highs,
      lows,
      closes,
      volumes,
      cfg.vwapPeriod
    );

  const currentRsi =
    rsi(
      closes,
      cfg.rsiPeriod
    );

  const macdValue =
    macd(
      closes
    );

  const bb =
    bollingerBands(
      closes,
      20,
      2
    );

  /*
   * Market Regime을 먼저 계산.
   */
  const regimeResult =
    regimeAgent(
      closes,
      emaFast,
      emaSlow,
      emaTrend,
      atrValue,
      bb
    );

  /*
   * 모든 Agent 실행.
   */
  const agents = [
    trendAgent(
      closes,
      emaFast,
      emaSlow,
      emaTrend,
      atrValue
    ),

    momentumAgent(
      closes,
      currentRsi,
      macdValue
    ),

    vwapAgent(
      last,
      currentVwap,
      atrValue
    ),

    breakoutAgent(
      highs,
      lows,
      closes,
      volumes
    ),

    meanReversionAgent(
      closes,
      currentRsi,
      bb,
      currentVwap
    ),

    volumeAgent(
      volumes
    ),

    volatilityAgent(
      highs,
      lows,
      closes,
      atrValue,
      bb
    ),

    regimeResult,

    priceActionAgent(
      bars,
      atrValue
    ),

    riskAgent(
      last,
      atrValue,
      currentVwap,
      bb
    ),
  ];

  /*
   * 최종 Judge.
   */
  const decision =
    judgeAgents(
      agents,
      regimeResult.regime,
      cfg
    );

  /*
   * Setup 분류.
   */
  let setup =
    'NONE';

  const trend =
    agents.find(
      (a) =>
        a.name ===
        'TREND'
    );

  const momentum =
    agents.find(
      (a) =>
        a.name ===
        'MOMENTUM'
    );

  const breakout =
    agents.find(
      (a) =>
        a.name ===
        'BREAKOUT'
    );

  const meanReversion =
    agents.find(
      (a) =>
        a.name ===
        'MEAN_REVERSION'
    );

  const vwapAgentResult =
    agents.find(
      (a) =>
        a.name ===
        'VWAP'
    );

  if (
    breakout?.score >= 50 &&
    momentum?.score >= 20
  ) {
    setup =
      'BREAKOUT_MOMENTUM';
  } else if (
    trend?.score >= 45 &&
    momentum?.score >= 25 &&
    vwapAgentResult?.score >= 15
  ) {
    setup =
      'TREND_MOMENTUM';
  } else if (
    meanReversion?.score >= 35
  ) {
    setup =
      'MEAN_REVERSION';
  } else if (
    vwapAgentResult?.score >= 30
  ) {
    setup =
      'VWAP_REVERSION';
  } else if (
    trend?.score >= 25
  ) {
    setup =
      'TREND_FOLLOW';
  }

  /*
   * 최종 strength.
   *
   * 기존 backtest.js와 호환하기 위해
   * 0~100 형태로 반환.
   */
  const strength =
    Math.max(
      0,
      Math.min(
        100,
        50 +
          decision.score *
            0.5 +
          (
            decision.confidence -
            50
          ) *
            0.25
      )
    );

  /*
   * 최종 이유.
   */
  let reason =
    decision.reason;

  if (
    decision.signal === 1
  ) {
    reason =
      `${decision.reason}: ${setup}`;
  }

  /*
   * Agent 결과를
   * UI에서 바로 확인할 수 있도록
   * 객체 형태로 변환.
   */
  const agentMap = {};

  agents.forEach(
    (agent) => {
      agentMap[
        agent.name
      ] = agent;
    }
  );

  return {
    signal:
      decision.signal,

    strength:
      Number(
        strength.toFixed(
          1
        )
      ),

    confidence:
      decision.confidence,

    setup,

    reason,

    regime:
      regimeResult.regime,

    agents:
      agentMap,

    ensemble: {
      score:
        decision.score,

      confidence:
        decision.confidence,

      agreement:
        decision.agreement,

      bullishAgents:
        decision.bullishAgents,

      bearishAgents:
        decision.bearishAgents,

      contributions:
        decision.contributions,
    },

    indicators: {
      price:
        last,

      previousPrice:
        previous,

      emaFast,
      emaSlow,
      emaTrend,

      atr:
        atrValue,

      atrPct:
        atrValue &&
        last
          ? (
              (
                atrValue /
                last
              ) *
              100
            )
          : null,

      vwap:
        currentVwap,

      vwapDistance:
        currentVwap &&
        atrValue
          ? (
              (
                last -
                currentVwap
              ) /
              atrValue
            )
          : null,

      rsi:
        currentRsi,

      macd:
        macdValue,

      bollinger:
        bb,

      volumeZ:
        zScore(
          volumes,
          20
        ),

      roc3:
        roc(
          closes,
          3
        ),

      roc8:
        roc(
          closes,
          8
        ),

      roc20:
        roc(
          closes,
          20
        ),
    },
  };
}

/*
 * ============================================================
 * 기존 UI용 기술점수
 * ============================================================
 */

function technicalScore(
  closes
) {
  if (
    !closes ||
    closes.length < 30
  ) {
    return {
      score: 0,
      detail: {},
      reason:
        '데이터 부족',
    };
  }

  const last =
    closes[
      closes.length - 1
    ];

  const sma20 =
    sma(
      closes,
      20
    );

  const sma50 =
    sma(
      closes,
      Math.min(
        50,
        closes.length - 1
      )
    );

  const rsiVal =
    rsi(
      closes,
      14
    );

  const macdVal =
    macd(
      closes
    );

  const bb =
    bollingerBands(
      closes,
      20
    );

  let score = 0;

  const detail = {};

  if (
    sma20 &&
    sma50
  ) {
    if (
      sma20 >
      sma50
    ) {
      score += 25;

      detail.ma =
        '상승 추세 (SMA20 > SMA50)';
    } else {
      score -= 25;

      detail.ma =
        '하락 추세 (SMA20 < SMA50)';
    }
  }

  if (sma20) {
    if (
      last >
      sma20
    ) {
      score += 15;
    } else {
      score -= 15;
    }
  }

  if (
    rsiVal !== null
  ) {
    detail.rsi =
      rsiVal.toFixed(
        1
      );

    if (
      rsiVal >= 45 &&
      rsiVal <= 68
    ) {
      score += 10;

      detail.rsiSignal =
        '건전한 상승 모멘텀';
    } else if (
      rsiVal < 30
    ) {
      score += 8;

      detail.rsiSignal =
        '과매도';
    } else if (
      rsiVal > 75
    ) {
      score -= 8;

      detail.rsiSignal =
        '단기 과열';
    }
  }

  if (macdVal) {
    detail.macdHistogram =
      macdVal.histogram.toFixed(
        3
      );

    if (
      macdVal.histogram > 0
    ) {
      score += 15;
    } else {
      score -= 15;
    }
  }

  if (bb) {
    if (
      last >
      bb.middle
    ) {
      score += 10;
    } else {
      score -= 10;
    }
  }

  score =
    Math.max(
      -100,
      Math.min(
        100,
        score
      )
    );

  return {
    score,
    detail,
  };
}

module.exports = {
  sma,
  ema,
  emaSeries,
  rsi,
  macd,
  bollingerBands,
  atr,
  atrSeries,
  vwap,
  roc,
  stdDev,
  zScore,
  highest,
  lowest,
  trendStrength,
  quantSignal,
  technicalScore,
};
