// lib/indicators.js
// ============================================================
// Multi-Agent Quant Engine
//
// 모든 배열:
// 과거 -> 최신 순서
//
// 목적:
// - 순수 기술지표 계산
// - 독립적인 시장 판단 Agent
// - Ensemble Judge가 사용할 feature 제공
//
// Signal:
//   1  = LONG
//   0  = WAIT
//  -1  = EXIT / SHORT bias
//
// 주의:
// 이 파일은 외부 뉴스/API를 직접 호출하지 않는다.
// 뉴스/시장심리/거시환경은 별도 Agent에서 처리한다.
// ============================================================


// ============================================================
// Utility
// ============================================================

function clamp(value, min = -100, max = 100) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return min < 0 ? 0 : min;
  }

  return Math.max(min, Math.min(max, n));
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function safePositive(value) {
  const n = Number(value);

  return Number.isFinite(n) && n > 0
    ? n
    : null;
}

function lastValue(values) {
  if (!values || !values.length) {
    return null;
  }

  return values[values.length - 1];
}

function previousValue(values) {
  if (!values || values.length < 2) {
    return null;
  }

  return values[values.length - 2];
}


// ============================================================
// SMA
// ============================================================

function sma(values, period) {
  if (
    !values ||
    !Number.isInteger(period) ||
    period <= 0 ||
    values.length < period
  ) {
    return null;
  }

  const slice = values.slice(-period);

  const sum = slice.reduce(
    (a, b) => a + safeNumber(b),
    0
  );

  return sum / period;
}


// ============================================================
// EMA
// ============================================================

function ema(values, period) {
  if (
    !values ||
    !Number.isInteger(period) ||
    period <= 0 ||
    values.length < period
  ) {
    return null;
  }

  const k = 2 / (period + 1);

  let value = sma(
    values.slice(0, period),
    period
  );

  if (value === null) {
    return null;
  }

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    value =
      safeNumber(values[i]) * k +
      value * (1 - k);
  }

  return value;
}


// ============================================================
// EMA Series
// ============================================================

function emaSeries(values, period) {
  if (
    !values ||
    !Number.isInteger(period) ||
    period <= 0 ||
    values.length < period
  ) {
    return [];
  }

  const k = 2 / (period + 1);

  const result = [];

  let value = sma(
    values.slice(0, period),
    period
  );

  if (value === null) {
    return [];
  }

  result.push(value);

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    value =
      safeNumber(values[i]) * k +
      value * (1 - k);

    result.push(value);
  }

  return result;
}


// ============================================================
// RSI
//
// 기존 단순 RSI 대신 Wilder-style smoothing 사용.
// 데이트레이딩에서 좀 더 안정적인 RSI 계산.
// ============================================================

function rsi(closes, period = 14) {
  if (
    !closes ||
    closes.length < period + 1 ||
    period <= 0
  ) {
    return null;
  }

  let gainSum = 0;
  let lossSum = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {
    const diff =
      safeNumber(closes[i]) -
      safeNumber(closes[i - 1]);

    if (diff > 0) {
      gainSum += diff;
    } else {
      lossSum -= diff;
    }
  }

  let avgGain =
    gainSum / period;

  let avgLoss =
    lossSum / period;

  for (
    let i = period + 1;
    i < closes.length;
    i++
  ) {
    const diff =
      safeNumber(closes[i]) -
      safeNumber(closes[i - 1]);

    const gain =
      diff > 0
        ? diff
        : 0;

    const loss =
      diff < 0
        ? -diff
        : 0;

    avgGain =
      (
        avgGain *
          (period - 1) +
        gain
      ) /
      period;

    avgLoss =
      (
        avgLoss *
          (period - 1) +
        loss
      ) /
      period;
  }

  if (avgLoss === 0) {
    return avgGain > 0
      ? 100
      : 50;
  }

  const rs =
    avgGain /
    avgLoss;

  return (
    100 -
    100 /
      (1 + rs)
  );
}


// ============================================================
// RSI Series
// ============================================================

function rsiSeries(
  closes,
  period = 14
) {
  if (
    !closes ||
    closes.length < period + 1
  ) {
    return [];
  }

  const result = [];

  let gainSum = 0;
  let lossSum = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {
    const diff =
      closes[i] -
      closes[i - 1];

    if (diff > 0) {
      gainSum += diff;
    } else {
      lossSum -= diff;
    }
  }

  let avgGain =
    gainSum / period;

  let avgLoss =
    lossSum / period;

  const firstRsi =
    avgLoss === 0
      ? 100
      : 100 -
        100 /
          (
            1 +
            avgGain /
              avgLoss
          );

  result.push(firstRsi);

  for (
    let i = period + 1;
    i < closes.length;
    i++
  ) {
    const diff =
      closes[i] -
      closes[i - 1];

    const gain =
      diff > 0
        ? diff
        : 0;

    const loss =
      diff < 0
        ? -diff
        : 0;

    avgGain =
      (
        avgGain *
          (period - 1) +
        gain
      ) /
      period;

    avgLoss =
      (
        avgLoss *
          (period - 1) +
        loss
      ) /
      period;

    const value =
      avgLoss === 0
        ? 100
        : 100 -
          100 /
            (
              1 +
              avgGain /
                avgLoss
            );

    result.push(value);
  }

  return result;
}


// ============================================================
// MACD
// ============================================================

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

  if (
    !fastSeries.length ||
    !slowSeries.length
  ) {
    return null;
  }

  const offset =
    fastSeries.length -
    slowSeries.length;

  const macdLine =
    slowSeries.map(
      (value, i) =>
        fastSeries[
          i + offset
        ] -
        value
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
        ] -
        value
    );

  return {
    macd:
      lastValue(
        macdLine
      ),

    signal:
      lastValue(
        signalLine
      ),

    histogram:
      lastValue(
        histogram
      ),

    macdLine,
    signalLine,
    histogramSeries:
      histogram,
  };
}


// ============================================================
// Bollinger Bands
// ============================================================

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
      (a, b) =>
        a +
        safeNumber(b),
      0
    ) /
    period;

  const variance =
    slice.reduce(
      (sum, value) =>
        sum +
        (
          safeNumber(value) -
          mean
        ) ** 2,
      0
    ) /
    period;

  const deviation =
    Math.sqrt(
      variance
    );

  const upper =
    mean +
    stdDevMult *
      deviation;

  const lower =
    mean -
    stdDevMult *
      deviation;

  return {
    upper,
    middle: mean,
    lower,

    stdDev:
      deviation,

    width:
      mean !== 0
        ? (
            (
              upper -
              lower
            ) /
            mean
          ) *
          100
        : 0,

    percentB:
      upper !== lower
        ? (
            lastValue(closes) -
            lower
          ) /
          (
            upper -
            lower
          )
        : 0,
  };
}


// ============================================================
// True Range
// ============================================================

function trueRange(
  high,
  low,
  previousClose
) {
  const h =
    safeNumber(high);

  const l =
    safeNumber(low);

  const pc =
    safeNumber(previousClose);

  return Math.max(
    h - l,
    Math.abs(h - pc),
    Math.abs(l - pc)
  );
}


// ============================================================
// ATR Series
// ============================================================

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
      .slice(0, period)
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


// ============================================================
// ATR
// ============================================================

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
    ? lastValue(series)
    : null;
}


// ============================================================
// VWAP
//
// 주의:
// period VWAP은 rolling VWAP이다.
// 실제 장중 VWAP이 필요하면 market/session layer에서
// 세션 시작점을 기준으로 계산하는 것이 더 정확하다.
// ============================================================

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
        safeNumber(highs[i]) +
        safeNumber(lows[i]) +
        safeNumber(closes[i])
      ) /
      3;

    const volume =
      Math.max(
        0,
        safeNumber(
          volumes[i]
        )
      );

    priceVolume +=
      typical *
      volume;

    volumeTotal +=
      volume;
  }

  if (
    volumeTotal <= 0
  ) {
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


// ============================================================
// ROC
// ============================================================

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
    lastValue(closes);

  const previous =
    closes[
      closes.length -
        1 -
        period
    ];

  if (
    !previous ||
    !Number.isFinite(
      previous
    )
  ) {
    return null;
  }

  return (
    (
      (
        current -
        previous
      ) /
      previous
    ) *
    100
  );
}


// ============================================================
// Standard Deviation
// ============================================================

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
        a +
        safeNumber(b),
      0
    ) /
    period;

  const variance =
    slice.reduce(
      (sum, value) =>
        sum +
        (
          safeNumber(value) -
          mean
        ) ** 2,
      0
    ) /
    period;

  return Math.sqrt(
    variance
  );
}


// ============================================================
// Z Score
// ============================================================

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
        a +
        safeNumber(b),
      0
    ) /
    period;

  const deviation =
    stdDev(
      values,
      period
    );

  if (
    deviation === null ||
    deviation === 0
  ) {
    return 0;
  }

  return (
    (
      lastValue(slice) -
      mean
    ) /
    deviation
  );
}


// ============================================================
// Highest
// ============================================================

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
    ...values
      .slice(-period)
      .map(safeNumber)
  );
}


// ============================================================
// Lowest
// ============================================================

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
    ...values
      .slice(-period)
      .map(safeNumber)
  );
}


// ============================================================
// Trend Strength
// ============================================================

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
    (
      (
        fast -
        slow
      ) /
      slow
    ) *
    100
  );
}


// ============================================================
// Slope
// ============================================================

function slope(
  values,
  period = 10
) {
  if (
    !values ||
    values.length <= period
  ) {
    return null;
  }

  const current =
    lastValue(values);

  const previous =
    values[
      values.length -
        1 -
        period
    ];

  if (
    previous === 0 ||
    previous === null
  ) {
    return null;
  }

  return (
    (
      current -
      previous
    ) /
    previous
  ) *
  100;
}


// ============================================================
// ATR Percent
// ============================================================

function atrPercent(
  last,
  atrValue
) {
  if (
    !last ||
    !atrValue
  ) {
    return null;
  }

  return (
    atrValue /
    last
  ) *
  100;
}


// ============================================================
// Candle Feature
// ============================================================

function candleFeatures(
  bar
) {
  if (!bar) {
    return null;
  }

  const open =
    safeNumber(
      bar.open
    );

  const high =
    safeNumber(
      bar.high
    );

  const low =
    safeNumber(
      bar.low
    );

  const close =
    safeNumber(
      bar.close
    );

  const range =
    Math.max(
      0,
      high - low
    );

  const body =
    close - open;

  const bodySize =
    Math.abs(body);

  const upperWick =
    Math.max(
      0,
      high -
        Math.max(
          open,
          close
        )
    );

  const lowerWick =
    Math.max(
      0,
      Math.min(
        open,
        close
      ) -
      low
    );

  return {
    open,
    high,
    low,
    close,

    range,

    body,
    bodySize,

    bodyRatio:
      range > 0
        ? bodySize /
          range
        : 0,

    upperWick,
    lowerWick,

    bullish:
      body > 0,

    bearish:
      body < 0,
  };
}


// ============================================================
// Agent Result Factory
// ============================================================

function createAgent(
  name,
  score,
  confidence = 50,
  extra = {}
) {
  const finalScore =
    clamp(
      score
    );

  return {
    name,

    signal:
      finalScore >= 20
        ? 1
        : finalScore <= -20
          ? -1
          : 0,

    score:
      Number(
        finalScore.toFixed(
          2
        )
      ),

    confidence:
      Number(
        clamp(
          confidence,
          0,
          100
        ).toFixed(
          1
        )
      ),

    evidence:
      extra.evidence ||
      [],

    risks:
      extra.risks ||
      [],

    ...extra,
  };
}


// ============================================================
// Agent 1
// TREND
// ============================================================

function trendAgent(
  closes,
  emaFast,
  emaSlow,
  emaTrend,
  atrValue
) {
  let score = 0;

  const evidence = [];
  const risks = [];

  const shortSlope =
    slope(
      closes,
      5
    );

  const mediumSlope =
    slope(
      closes,
      15
    );

  if (
    emaFast &&
    emaSlow
  ) {
    if (
      emaFast >
      emaSlow
    ) {
      score += 30;

      evidence.push(
        'EMA fast > EMA slow'
      );
    } else {
      score -= 30;

      risks.push(
        'EMA fast < EMA slow'
      );
    }
  }

  if (
    emaSlow &&
    emaTrend
  ) {
    if (
      emaSlow >
      emaTrend
    ) {
      score += 30;

      evidence.push(
        '중기 EMA > 장기 EMA'
      );
    } else {
      score -= 30;

      risks.push(
        '중기 EMA < 장기 EMA'
      );
    }
  }

  if (
    shortSlope !== null
  ) {
    if (
      shortSlope > 0.1
    ) {
      score += 15;

      evidence.push(
        '단기 가격 slope 상승'
      );
    } else if (
      shortSlope < -0.1
    ) {
      score -= 15;

      risks.push(
        '단기 가격 slope 하락'
      );
    }
  }

  if (
    mediumSlope !== null
  ) {
    if (
      mediumSlope > 0.3
    ) {
      score += 20;

      evidence.push(
        '중기 추세 상승'
      );
    } else if (
      mediumSlope < -0.3
    ) {
      score -= 20;

      risks.push(
        '중기 추세 하락'
      );
    }
  }

  if (
    atrValue &&
    emaFast &&
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
          ? 10
          : -10;
    }
  }

  const confidence =
    Math.min(
      95,
      50 +
        Math.abs(score) *
          0.45
    );

  return createAgent(
    'TREND',
    score,
    confidence,
    {
      shortSlope,
      mediumSlope,
    }
  );
}


// ============================================================
// Agent 2
// MOMENTUM
// ============================================================

function momentumAgent(
  closes,
  rsiValue,
  macdValue
) {
  let score = 0;

  const evidence = [];
  const risks = [];

  const roc3 =
    roc(closes, 3);

  const roc8 =
    roc(closes, 8);

  const roc20 =
    roc(closes, 20);

  if (
    roc3 !== null
  ) {
    if (
      roc3 > 0
    ) {
      score += 15;
    } else {
      score -= 15;
    }
  }

  if (
    roc8 !== null
  ) {
    if (
      roc8 > 0
    ) {
      score += 20;
    } else {
      score -= 20;
    }
  }

  if (
    roc20 !== null
  ) {
    if (
      roc20 > 0
    ) {
      score += 15;
    } else {
      score -= 15;
    }
  }

  if (macdValue) {
    if (
      macdValue.histogram >
      0
    ) {
      score += 20;

      evidence.push(
        'MACD histogram positive'
      );
    } else {
      score -= 20;

      risks.push(
        'MACD histogram negative'
      );
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
   * RSI는 추세와 함께 해석한다.
   */
  if (
    rsiValue !== null
  ) {
    if (
      rsiValue >= 50 &&
      rsiValue <= 65
    ) {
      score += 15;

      evidence.push(
        'RSI healthy momentum zone'
      );
    } else if (
      rsiValue > 72
    ) {
      score -= 15;

      risks.push(
        'RSI 과열'
      );
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

  const confidence =
    Math.min(
      95,
      45 +
        Math.abs(score) *
          0.5
    );

  return createAgent(
    'MOMENTUM',
    score,
    confidence,
    {
      roc3,
      roc8,
      roc20,
      rsi: rsiValue,
    }
  );
}


// ============================================================
// Agent 3
// VWAP
// ============================================================

function vwapAgent(
  last,
  currentVwap,
  atrValue,
  previous,
  previousVwap
) {
  if (
    !currentVwap ||
    !atrValue
  ) {
    return createAgent(
      'VWAP',
      0,
      20
    );
  }

  const distance =
    (
      last -
      currentVwap
    ) /
    atrValue;

  let score = 0;

  const evidence = [];
  const risks = [];

  if (
    distance > 0 &&
    distance <= 1.5
  ) {
    score += 40;

    evidence.push(
      'VWAP 위에서 거래'
    );
  }

  if (
    distance > 1.5 &&
    distance <= 2.5
  ) {
    score += 15;

    risks.push(
      'VWAP에서 다소 이격'
    );
  }

  if (
    distance > 2.5
  ) {
    score -= 35;

    risks.push(
      'VWAP 과도한 추격'
    );
  }

  if (
    distance < 0 &&
    distance >= -0.5
  ) {
    score -= 5;
  }

  if (
    distance < -0.5
  ) {
    score -= 30;

    risks.push(
      'VWAP 하회'
    );
  }

  /*
   * VWAP reclaim.
   */
  if (
    previous !== null &&
    previousVwap !== null &&
    previous < previousVwap &&
    last >= currentVwap
  ) {
    score += 25;

    evidence.push(
      'VWAP reclaim'
    );
  }

  return createAgent(
    'VWAP',
    score,
    Math.min(
      95,
      50 +
        Math.abs(score) *
          0.5
    ),
    {
      distance,
    }
  );
}


// ============================================================
// Agent 4
// BREAKOUT
// ============================================================

function breakoutAgent(
  highs,
  lows,
  closes,
  volumes,
  period = 20
) {
  if (
    closes.length <
      period + 2
  ) {
    return createAgent(
      'BREAKOUT',
      0,
      20
    );
  }

  const last =
    lastValue(closes);

  /*
   * 현재 봉을 제외한 이전 고점.
   * look-ahead 방지.
   */
  const previousHigh =
    Math.max(
      ...highs.slice(
        -period - 1,
        -1
      )
    );

  const previousLow =
    Math.min(
      ...lows.slice(
        -period - 1,
        -1
      )
    );

  const volumeZ =
    zScore(
      volumes,
      20
    );

  let score = 0;

  const evidence = [];
  const risks = [];

  const breakoutUp =
    last >
    previousHigh;

  const breakdown =
    last <
    previousLow;

  if (
    breakoutUp
  ) {
    score += 50;

    evidence.push(
      '이전 고점 돌파'
    );
  }

  if (
    breakdown
  ) {
    score -= 50;

    risks.push(
      '이전 저점 이탈'
    );
  }

  if (
    breakoutUp &&
    volumeZ !== null
  ) {
    if (
      volumeZ >= 1.5
    ) {
      score += 30;

      evidence.push(
        '강한 거래량 동반'
      );
    } else if (
      volumeZ >= 0.5
    ) {
      score += 15;

      evidence.push(
        '거래량 확인'
      );
    } else {
      score -= 15;

      risks.push(
        '돌파 거래량 부족'
      );
    }
  }

  return createAgent(
    'BREAKOUT',
    score,
    Math.min(
      95,
      45 +
        Math.abs(score) *
          0.5
    ),
    {
      breakoutUp,
      breakdown,
      previousHigh,
      previousLow,
      volumeZ,
    }
  );
}


// ============================================================
// Agent 5
// MEAN REVERSION
// ============================================================

function meanReversionAgent(
  closes,
  rsiValue,
  bb,
  currentVwap
) {
  let score = 0;

  const evidence = [];
  const risks = [];

  const last =
    lastValue(closes);

  if (bb) {
    if (
      last <
      bb.lower
    ) {
      score += 40;

      evidence.push(
        'Bollinger lower band 이탈'
      );
    }

    if (
      last >
      bb.upper
    ) {
      score -= 40;

      risks.push(
        'Bollinger upper band 과열'
      );
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

      evidence.push(
        'RSI 과매도'
      );
    } else if (
      rsiValue < 40
    ) {
      score += 15;
    }

    if (
      rsiValue > 75
    ) {
      score -= 35;

      risks.push(
        'RSI 과열'
      );
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

      evidence.push(
        'VWAP 대비 할인'
      );
    }
  }

  return createAgent(
    'MEAN_REVERSION',
    score,
    Math.min(
      90,
      45 +
        Math.abs(score) *
          0.55
    )
  );
}


// ============================================================
// Agent 6
// VOLUME
// ============================================================

function volumeAgent(
  volumes
) {
  const volumeZ =
    zScore(
      volumes,
      20
    );

  if (
    volumeZ === null
  ) {
    return createAgent(
      'VOLUME',
      0,
      20
    );
  }

  let score = 0;

  const evidence = [];
  const risks = [];

  if (
    volumeZ >= 2
  ) {
    score += 45;

    evidence.push(
      '거래량 2σ 이상'
    );
  } else if (
    volumeZ >= 1
  ) {
    score += 30;

    evidence.push(
      '거래량 증가'
    );
  } else if (
    volumeZ >= 0
  ) {
    score += 10;
  } else if (
    volumeZ < -1
  ) {
    score -= 20;

    risks.push(
      '거래량 감소'
    );
  }

  return createAgent(
    'VOLUME',
    score,
    Math.min(
      90,
      45 +
        Math.abs(volumeZ) *
          15
    ),
    {
      volumeZ,
    }
  );
}


// ============================================================
// Agent 7
// VOLATILITY
// ============================================================

function volatilityAgent(
  closes,
  atrValue,
  bb
) {
  const last =
    lastValue(closes);

  if (
    !atrValue ||
    !last
  ) {
    return createAgent(
      'VOLATILITY',
      0,
      20,
      {
        regime:
          'UNKNOWN',
      }
    );
  }

  const atrPct =
    atrPercent(
      last,
      atrValue
    );

  let score = 0;

  let regime =
    'NORMAL';

  const evidence = [];
  const risks = [];

  if (
    bb &&
    bb.width < 1.5
  ) {
    regime =
      'SQUEEZE';

    score += 15;

    evidence.push(
      '변동성 압축'
    );
  }

  if (
    atrPct < 0.5
  ) {
    regime =
      'LOW_VOL';

    score -= 10;

    risks.push(
      '변동성 부족'
    );
  }

  if (
    atrPct > 4
  ) {
    regime =
      'HIGH_VOL';

    score -= 15;

    risks.push(
      '높은 변동성'
    );
  }

  if (
    atrPct > 7
  ) {
    regime =
      'EXTREME_VOL';

    score -= 40;

    risks.push(
      '극단적 변동성'
    );
  }

  return createAgent(
    'VOLATILITY',
    score,
    70,
    {
      atrPct,
      regime,
    }
  );
}


// ============================================================
// Agent 8
// MARKET REGIME
// ============================================================

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

  const evidence = [];
  const risks = [];

  const trendUp =
    emaFast &&
    emaSlow &&
    emaTrend &&
    emaFast >
      emaSlow &&
    emaSlow >
      emaTrend;

  const trendDown =
    emaFast &&
    emaSlow &&
    emaTrend &&
    emaFast <
      emaSlow &&
    emaSlow <
      emaTrend;

  if (
    trendUp
  ) {
    regime =
      'BULL_TREND';

    score += 45;

    evidence.push(
      'EMA 구조 상승'
    );
  } else if (
    trendDown
  ) {
    regime =
      'BEAR_TREND';

    score -= 45;

    risks.push(
      'EMA 구조 하락'
    );
  }

  if (
    bb &&
    bb.width < 2
  ) {
    regime =
      trendUp
        ? 'BULL_COMPRESSION'
        : 'COMPRESSION';

    score += 5;
  }

  if (
    atrValue &&
    lastValue(closes)
  ) {
    const atrPct =
      atrPercent(
        lastValue(closes),
        atrValue
      );

    if (
      atrPct > 3
    ) {
      if (
        trendUp
      ) {
        regime =
          'BULL_HIGH_VOL';
      } else if (
        trendDown
      ) {
        regime =
          'BEAR_HIGH_VOL';
      } else {
        regime =
          'HIGH_VOL';
      }
    }
  }

  return createAgent(
    'REGIME',
    score,
    Math.min(
      95,
      55 +
        Math.abs(score) *
          0.5
    ),
    {
      regime,
      trendUp,
      trendDown,
    }
  );
}


// ============================================================
// Agent 9
// PRICE ACTION
// ============================================================

function priceActionAgent(
  bars
) {
  if (
    !bars ||
    bars.length < 3
  ) {
    return createAgent(
      'PRICE_ACTION',
      0,
      20
    );
  }

  const last =
    candleFeatures(
      bars[
        bars.length - 1
      ]
    );

  const previous =
    candleFeatures(
      bars[
        bars.length - 2
      ]
    );

  if (
    !last ||
    !previous
  ) {
    return createAgent(
      'PRICE_ACTION',
      0,
      20
    );
  }

  let score = 0;

  const evidence = [];
  const risks = [];

  if (
    last.bullish &&
    last.bodyRatio > 0.65
  ) {
    score += 30;

    evidence.push(
      '강한 양봉'
    );
  }

  if (
    last.bearish &&
    last.bodyRatio > 0.65
  ) {
    score -= 30;

    risks.push(
      '강한 음봉'
    );
  }

  if (
    last.lowerWick >
      last.bodySize *
        1.5 &&
    last.bullish
  ) {
    score += 20;

    evidence.push(
      '하단 꼬리 회복'
    );
  }

  if (
    last.upperWick >
      last.bodySize *
        1.5 &&
    last.bearish
  ) {
    score -= 20;

    risks.push(
      '상단 꼬리 거부'
    );
  }

  /*
   * 이전 봉보다 강하게 회복.
   */
  if (
    last.bullish &&
    previous.bearish &&
    last.close >
      previous.open
  ) {
    score += 20;

    evidence.push(
      '이전 음봉 회복'
    );
  }

  return createAgent(
    'PRICE_ACTION',
    score,
    Math.min(
      90,
      50 +
        Math.abs(score) *
          0.5
    ),
    {
      candle: last,
      previousCandle:
        previous,
    }
  );
}


// ============================================================
// Agent 10
// RISK
// ============================================================

function riskAgent(
  last,
  atrValue,
  currentVwap,
  bb
) {
  let score = 0;

  let blocked =
    false;

  const evidence = [];
  const risks = [];

  if (
    !last ||
    !atrValue
  ) {
    return createAgent(
      'RISK',
      0,
      30,
      {
        blocked: false,
      }
    );
  }

  const atrPct =
    atrPercent(
      last,
      atrValue
    );

  /*
   * 극단적인 변동성에서는
   * 진입을 차단.
   */
  if (
    atrPct > 6
  ) {
    score -= 80;

    blocked = true;

    risks.push(
      '극단적 ATR'
    );
  } else if (
    atrPct > 4
  ) {
    score -= 30;

    risks.push(
      '높은 ATR'
    );
  } else if (
    atrPct >= 0.7
  ) {
    score += 10;

    evidence.push(
      '거래 가능한 변동성'
    );
  }

  /*
   * VWAP 추격 방지.
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
      score -= 70;

      blocked = true;

      risks.push(
        'VWAP 과도한 이격'
      );
    } else if (
      distance > 2.5
    ) {
      score -= 30;

      risks.push(
        'VWAP 이격 확대'
      );
    }
  }

  /*
   * BB 극단값.
   */
  if (
    bb &&
    last >
      bb.upper &&
    bb.width > 4
  ) {
    score -= 30;

    risks.push(
      'BB 상단 과열'
    );
  }

  return createAgent(
    'RISK',
    score,
    90,
    {
      blocked,
      atrPct,
    }
  );
}


// ============================================================
// Agent 11
// RELATIVE MOMENTUM
//
// 여러 timeframe에서 동시에 방향이 맞는지 확인.
// ============================================================

function relativeMomentumAgent(
  closes
) {
  const roc5 =
    roc(closes, 5);

  const roc15 =
    roc(closes, 15);

  const roc30 =
    roc(closes, 30);

  let score = 0;

  const evidence = [];
  const risks = [];

  const positive =
    [
      roc5,
      roc15,
      roc30,
    ].filter(
      (v) =>
        v !== null &&
        v > 0
    ).length;

  const negative =
    [
      roc5,
      roc15,
      roc30,
    ].filter(
      (v) =>
        v !== null &&
        v < 0
    ).length;

  if (
    positive === 3
  ) {
    score += 45;

    evidence.push(
      'multi-timeframe momentum aligned'
    );
  } else if (
    positive === 2
  ) {
    score += 25;
  }

  if (
    negative === 3
  ) {
    score -= 45;

    risks.push(
      'multi-timeframe momentum bearish'
    );
  } else if (
    negative === 2
  ) {
    score -= 25;
  }

  return createAgent(
    'RELATIVE_MOMENTUM',
    score,
    75,
    {
      roc5,
      roc15,
      roc30,
    }
  );
}


// ============================================================
// Agent 12
// TREND EXHAUSTION
//
// 상승 추세라도 너무 오래/빠르게 오른 경우
// 신규 진입을 감점.
// ============================================================

function exhaustionAgent(
  closes,
  rsiValue,
  atrValue,
  currentVwap
) {
  const last =
    lastValue(closes);

  let score = 0;

  const evidence = [];
  const risks = [];

  if (
    !last ||
    !atrValue
  ) {
    return createAgent(
      'EXHAUSTION',
      0,
      30
    );
  }

  const distanceFromVwap =
    currentVwap
      ? (
          last -
          currentVwap
        ) /
        atrValue
      : 0;

  if (
    distanceFromVwap > 2
  ) {
    score -= 25;

    risks.push(
      'VWAP 대비 과도한 상승'
    );
  }

  if (
    distanceFromVwap > 3
  ) {
    score -= 45;

    risks.push(
      '극단적 추격'
    );
  }

  if (
    rsiValue !== null
  ) {
    if (
      rsiValue > 75
    ) {
      score -= 35;

      risks.push(
        'RSI extreme'
      );
    } else if (
      rsiValue > 70
    ) {
      score -= 20;
    }
  }

  return createAgent(
    'EXHAUSTION',
    score,
    80,
    {
      distanceFromVwap,
    }
  );
}


// ============================================================
// Ensemble Judge
// ============================================================

function judgeAgents(
  agents,
  regime,
  cfg
) {
  const baseWeights = {
    TREND: 1.15,
    MOMENTUM: 1.1,
    VWAP: 0.95,
    BREAKOUT: 1.0,
    MEAN_REVERSION: 0.75,
    VOLUME: 0.8,
    VOLATILITY: 0.65,
    REGIME: 1.1,
    PRICE_ACTION: 0.8,
    RISK: 1.5,
    RELATIVE_MOMENTUM: 0.9,
    EXHAUSTION: 1.1,
  };

  const weights = {
    ...baseWeights,
  };

  /*
   * Regime adaptive weighting.
   */
  if (
    regime ===
      'BULL_TREND' ||
    regime ===
      'BULL_HIGH_VOL' ||
    regime ===
      'BULL_COMPRESSION'
  ) {
    weights.TREND *= 1.25;
    weights.MOMENTUM *= 1.2;
    weights.RELATIVE_MOMENTUM *= 1.15;
    weights.BREAKOUT *= 1.15;

    weights.MEAN_REVERSION *= 0.55;
  }

  if (
    regime ===
    'BEAR_TREND'
  ) {
    weights.TREND *= 1.2;
    weights.MOMENTUM *= 1.15;
    weights.RELATIVE_MOMENTUM *= 1.15;

    weights.BREAKOUT *= 0.9;
  }

  if (
    regime ===
    'BEAR_HIGH_VOL'
  ) {
    weights.RISK *= 1.35;
    weights.MOMENTUM *= 1.2;
  }

  if (
    regime ===
    'SIDEWAYS'
  ) {
    weights.MEAN_REVERSION *= 1.35;
    weights.VWAP *= 1.2;

    weights.BREAKOUT *= 0.75;
    weights.TREND *= 0.75;
  }

  if (
    regime ===
      'COMPRESSION' ||
    regime ===
      'BULL_COMPRESSION'
  ) {
    weights.BREAKOUT *= 1.35;
    weights.VOLUME *= 1.2;
  }

  if (
    regime ===
    'HIGH_VOL' ||
    regime ===
    'EXTREME_VOL'
  ) {
    weights.RISK *= 1.4;
    weights.BREAKOUT *= 0.9;
  }

  let weightedScore = 0;
  let totalWeight = 0;

  const contributions = {};

  let bullish = 0;
  let bearish = 0;
  let neutral = 0;

  agents.forEach(
    (agent) => {
      const weight =
        weights[
          agent.name
        ] ??
        1;

      /*
       * confidence를 이용해서
       * 확신 낮은 Agent의 영향력을 줄인다.
       */
      const confidenceMultiplier =
        0.5 +
        (
          safeNumber(
            agent.confidence,
            50
          ) /
          100
        );

      const effectiveWeight =
        weight *
        confidenceMultiplier;

      const contribution =
        agent.score *
        effectiveWeight;

      weightedScore +=
        contribution;

      totalWeight +=
        Math.abs(
          effectiveWeight
        );

      if (
        agent.signal > 0
      ) {
        bullish++;
      } else if (
        agent.signal < 0
      ) {
        bearish++;
      } else {
        neutral++;
      }

      contributions[
        agent.name
      ] = {
        score:
          Number(
            agent.score.toFixed(
              2
            )
          ),

        confidence:
          Number(
            safeNumber(
              agent.confidence,
              50
            ).toFixed(
              1
            )
          ),

        weight:
          Number(
            effectiveWeight.toFixed(
              3
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
    totalWeight > 0
      ? weightedScore /
        totalWeight
      : 0;

  /*
   * Risk Agent.
   */
  const risk =
    agents.find(
      (a) =>
        a.name ===
        'RISK'
    );

  const blocked =
    Boolean(
      risk &&
      risk.blocked
    );

  /*
   * 상승/하락 합의.
   */
  const total =
    agents.length;

  const agreement =
    total > 0
      ? Math.max(
          bullish,
          bearish
        ) /
        total
      : 0;

  /*
   * 독립적인 Agent들의
   * 방향 일치도.
   */
  const directionalAgents =
    agents.filter(
      (a) =>
        a.name !==
          'RISK' &&
        a.name !==
          'VOLATILITY'
    );

  const directionalBullish =
    directionalAgents.filter(
      (a) =>
        a.signal === 1
    ).length;

  const directionalBearish =
    directionalAgents.filter(
      (a) =>
        a.signal === -1
    ).length;

  const directionalTotal =
    directionalAgents.length;

  const directionalAgreement =
    directionalTotal
      ? Math.max(
          directionalBullish,
          directionalBearish
        ) /
        directionalTotal
      : 0;

  /*
   * confidence.
   */
  let confidence =
    Math.abs(
      normalized
    );

  confidence *=
    0.7 +
    directionalAgreement *
      0.5;

  /*
   * 양쪽 의견이 강하면
   * uncertainty 증가.
   */
  if (
    bullish >= 3 &&
    bearish >= 3
  ) {
    confidence *=
      0.72;
  }

  /*
   * 강한 합의.
   */
  if (
    bullish >=
      cfg.minBullishAgents &&
    bearish <= 2
  ) {
    confidence *=
      1.12;
  }

  if (
    bearish >=
      cfg.minBearishAgents &&
    bullish <= 2
  ) {
    confidence *=
      1.12;
  }

  confidence =
    clamp(
      confidence,
      0,
      100
    );

  let signal = 0;

  let reason =
    '충분한 합의 없음';

  /*
   * Risk block.
   */
  if (
    blocked
  ) {
    signal = 0;

    reason =
      'Risk Agent 진입 차단';
  } else if (
    normalized >=
      cfg.longThreshold &&
    bullish >=
      cfg.minBullishAgents &&
    confidence >=
      cfg.minConfidence
  ) {
    signal = 1;

    reason =
      '다중 Agent 상승 합의';
  } else if (
    normalized <=
      cfg.exitThreshold &&
    bearish >=
      cfg.minBearishAgents
  ) {
    signal = -1;

    reason =
      '다중 Agent 하락 합의';
  } else if (
    normalized > 0
  ) {
    reason =
      '상승 우위이나 진입 기준 미달';
  } else if (
    normalized < 0
  ) {
    reason =
      '하락 우위이나 확정 신호 부족';
  }

  /*
   * 낮은 confidence 제거.
   */
  if (
    signal === 1 &&
    confidence <
      cfg.minConfidence
  ) {
    signal = 0;

    reason =
      '상승 신호이나 confidence 부족';
  }

  return {
    signal,

    score:
      Number(
        clamp(
          normalized
        ).toFixed(
          2
        )
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
          3
        )
      ),

    directionalAgreement:
      Number(
        directionalAgreement.toFixed(
          3
        )
      ),

    bullishAgents:
      bullish,

    bearishAgents:
      bearish,

    neutralAgents:
      neutral,

    blocked,

    reason,

    contributions,
  };
}


// ============================================================
// Setup Classifier
// ============================================================

function classifySetup(
  agents,
  regime
) {
  const get =
    (name) =>
      agents.find(
        (a) =>
          a.name ===
          name
      );

  const trend =
    get('TREND');

  const momentum =
    get('MOMENTUM');

  const breakout =
    get('BREAKOUT');

  const vwapResult =
    get('VWAP');

  const mean =
    get('MEAN_REVERSION');

  const volume =
    get('VOLUME');

  const exhaustion =
    get('EXHAUSTION');

  if (
    breakout &&
    breakout.score >= 45 &&
    momentum &&
    momentum.score >= 20 &&
    volume &&
    volume.score >= 20
  ) {
    return 'BREAKOUT_MOMENTUM';
  }

  if (
    trend &&
    trend.score >= 45 &&
    momentum &&
    momentum.score >= 25 &&
    vwapResult &&
    vwapResult.score >= 15 &&
    exhaustion &&
    exhaustion.score > -25
  ) {
    return 'TREND_MOMENTUM';
  }

  if (
    mean &&
    mean.score >= 35 &&
    regime ===
      'SIDEWAYS'
  ) {
    return 'MEAN_REVERSION';
  }

  if (
    vwapResult &&
    vwapResult.score >= 30
  ) {
    return 'VWAP_RECLAIM';
  }

  if (
    trend &&
    trend.score >= 25
  ) {
    return 'TREND_FOLLOW';
  }

  return 'NONE';
}


// ============================================================
// Main Quant Signal
// ============================================================

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

    breakoutPeriod: 20,

    longThreshold: 22,

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
      regime: 'UNKNOWN',
      reason: '데이터 부족',
      agents: {},
      ensemble: {},
      indicators: {},
    };
  }

  /*
   * Normalize OHLCV.
   */
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
        Math.max(
          0,
          safeNumber(
            b.volume
          )
        )
    );

  const last =
    lastValue(closes);

  const previous =
    previousValue(closes);

  /*
   * Core indicators.
   */
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

  /*
   * 이전 VWAP.
   *
   * reclaim 판별을 위해
   * 마지막 봉 제외한 rolling VWAP 계산.
   */
  const previousVwap =
    vwap(
      highs.slice(0, -1),
      lows.slice(0, -1),
      closes.slice(0, -1),
      volumes.slice(0, -1),
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
   * Regime first.
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
   * All agents.
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
      atrValue,
      previous,
      previousVwap
    ),

    breakoutAgent(
      highs,
      lows,
      closes,
      volumes,
      cfg.breakoutPeriod
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
      closes,
      atrValue,
      bb
    ),

    regimeResult,

    priceActionAgent(
      bars
    ),

    riskAgent(
      last,
      atrValue,
      currentVwap,
      bb
    ),

    relativeMomentumAgent(
      closes
    ),

    exhaustionAgent(
      closes,
      currentRsi,
      atrValue,
      currentVwap
    ),
  ];

  /*
   * Judge.
   */
  const decision =
    judgeAgents(
      agents,
      regimeResult.regime,
      cfg
    );

  /*
   * Setup.
   */
  const setup =
    classifySetup(
      agents,
      regimeResult.regime
    );

  /*
   * Strength.
   *
   * 0~100.
   */
  let strength =
    50 +
    decision.score *
      0.5 +
    (
      decision.confidence -
      50
    ) *
      0.25;

  strength =
    clamp(
      strength,
      0,
      100
    );

  /*
   * Agent map.
   */
  const agentMap = {};

  agents.forEach(
    (agent) => {
      agentMap[
        agent.name
      ] = agent;
    }
  );

  let reason =
    decision.reason;

  if (
    decision.signal === 1
  ) {
    reason =
      `${decision.reason}: ${setup}`;
  }

  /*
   * Return.
   */
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

    regime:
      regimeResult.regime,

    reason,

    agents:
      agentMap,

    ensemble: {
      score:
        decision.score,

      confidence:
        decision.confidence,

      agreement:
        decision.agreement,

      directionalAgreement:
        decision.directionalAgreement,

      bullishAgents:
        decision.bullishAgents,

      bearishAgents:
        decision.bearishAgents,

      neutralAgents:
        decision.neutralAgents,

      blocked:
        decision.blocked,

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

      emaSpread:
        emaFast &&
        emaSlow
          ? (
              (
                emaFast -
                emaSlow
              ) /
              emaSlow
            ) *
            100
          : null,

      trendStrength:
        trendStrength(
          closes,
          cfg.emaFast,
          cfg.emaTrend
        ),

      atr:
        atrValue,

      atrPct:
        atrPercent(
          last,
          atrValue
        ),

      vwap:
        currentVwap,

      previousVwap,

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

      roc5:
        roc(
          closes,
          5
        ),

      roc8:
        roc(
          closes,
          8
        ),

      roc15:
        roc(
          closes,
          15
        ),

      roc20:
        roc(
          closes,
          20
        ),

      slope5:
        slope(
          closes,
          5
        ),

      slope15:
        slope(
          closes,
          15
        ),
    },
  };
}


// ============================================================
// Legacy Technical Score
//
// 기존 UI가 사용하더라도 깨지지 않게 유지.
// ============================================================

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
    lastValue(closes);

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
        '상승 추세';
    } else {
      score -= 25;

      detail.ma =
        '하락 추세';
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
        '건전한 모멘텀';
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
        '과열';
    }
  }

  if (macdVal) {
    detail.macdHistogram =
      macdVal.histogram.toFixed(
        4
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
    clamp(
      score
    );

  return {
    score,
    detail,
  };
}


// ============================================================
// Exports
// ============================================================

module.exports = {
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

  roc,

  stdDev,
  zScore,

  highest,
  lowest,

  trendStrength,
  slope,
  atrPercent,

  candleFeatures,

  trendAgent,
  momentumAgent,
  vwapAgent,
  breakoutAgent,
  meanReversionAgent,
  volumeAgent,
  volatilityAgent,
  regimeAgent,
  priceActionAgent,
  riskAgent,
  relativeMomentumAgent,
  exhaustionAgent,

  judgeAgents,
  classifySetup,

  quantSignal,
  technicalScore,
};
