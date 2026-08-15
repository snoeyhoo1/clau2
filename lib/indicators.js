// lib/indicators.js
// 기술적 지표 + 퀀트 전략용 지표
// 모든 배열은 과거 -> 최신 순서

function sma(values, period) {
  if (!values || values.length < period) return null;

  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (!values || values.length < period) return null;

  const k = 2 / (period + 1);
  let value = sma(values.slice(0, period), period);

  for (let i = period; i < values.length; i++) {
    value = values[i] * k + value * (1 - k);
  }

  return value;
}

function emaSeries(values, period) {
  if (!values || values.length < period) return [];

  const k = 2 / (period + 1);
  const result = [];

  let value = sma(values.slice(0, period), period);
  result.push(value);

  for (let i = period; i < values.length; i++) {
    value = values[i] * k + value * (1 - k);
    result.push(value);
  }

  return result;
}

function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];

    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(
  closes,
  fast = 12,
  slow = 26,
  signalPeriod = 9
) {
  if (!closes || closes.length < slow + signalPeriod) {
    return null;
  }

  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);

  const offset = fastSeries.length - slowSeries.length;

  const macdLine = slowSeries.map(
    (value, i) => fastSeries[i + offset] - value
  );

  const signalLine = emaSeries(
    macdLine,
    signalPeriod
  );

  if (!signalLine.length) return null;

  const signalOffset =
    macdLine.length - signalLine.length;

  const histogram = signalLine.map(
    (value, i) =>
      macdLine[i + signalOffset] - value
  );

  return {
    macd: macdLine[macdLine.length - 1],
    signal: signalLine[signalLine.length - 1],
    histogram: histogram[histogram.length - 1],
  };
}

function bollingerBands(
  closes,
  period = 20,
  stdDevMult = 2
) {
  if (!closes || closes.length < period) return null;

  const slice = closes.slice(-period);

  const mean =
    slice.reduce((a, b) => a + b, 0) / period;

  const variance =
    slice.reduce(
      (sum, value) =>
        sum + (value - mean) ** 2,
      0
    ) / period;

  const stdDev = Math.sqrt(variance);

  return {
    upper: mean + stdDevMult * stdDev,
    middle: mean,
    lower: mean - stdDevMult * stdDev,
    width: mean
      ? ((stdDevMult * 2 * stdDev) / mean) * 100
      : 0,
  };
}

function trueRange(high, low, previousClose) {
  return Math.max(
    high - low,
    Math.abs(high - previousClose),
    Math.abs(low - previousClose)
  );
}

function atrSeries(highs, lows, closes, period = 14) {
  if (
    !highs ||
    !lows ||
    !closes ||
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
    trs.slice(0, period).reduce(
      (a, b) => a + b,
      0
    ) / period;

  result.push(value);

  for (let i = period; i < trs.length; i++) {
    value =
      (value * (period - 1) + trs[i]) /
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
  const series = atrSeries(
    highs,
    lows,
    closes,
    period
  );

  return series.length
    ? series[series.length - 1]
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
    closes.length - period;

  for (let i = start; i < closes.length; i++) {
    const typical =
      (highs[i] + lows[i] + closes[i]) / 3;

    const volume = Number(volumes[i]) || 0;

    priceVolume += typical * volume;
    volumeTotal += volume;
  }

  if (!volumeTotal) {
    return sma(closes, period);
  }

  return priceVolume / volumeTotal;
}

function roc(closes, period = 10) {
  if (!closes || closes.length <= period) {
    return null;
  }

  const current =
    closes[closes.length - 1];

  const previous =
    closes[closes.length - 1 - period];

  if (!previous) return null;

  return ((current - previous) / previous) * 100;
}

function stdDev(values, period = 20) {
  if (!values || values.length < period) {
    return null;
  }

  const slice = values.slice(-period);

  const mean =
    slice.reduce((a, b) => a + b, 0) /
    period;

  const variance =
    slice.reduce(
      (sum, value) =>
        sum + (value - mean) ** 2,
      0
    ) / period;

  return Math.sqrt(variance);
}

function zScore(values, period = 20) {
  if (!values || values.length < period) {
    return null;
  }

  const slice = values.slice(-period);

  const mean =
    slice.reduce((a, b) => a + b, 0) /
    period;

  const deviation = stdDev(
    values,
    period
  );

  if (!deviation) return 0;

  return (
    (slice[slice.length - 1] - mean) /
    deviation
  );
}

function highest(values, period) {
  if (!values || values.length < period) {
    return null;
  }

  return Math.max(
    ...values.slice(-period)
  );
}

function lowest(values, period) {
  if (!values || values.length < period) {
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
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);

  if (!fast || !slow || !slow) return null;

  return ((fast - slow) / slow) * 100;
}

/*
 * 퀀트 전략용 상태 계산.
 *
 * signal:
 *   1  = long
 *   0  = no trade
 *  -1  = exit / bearish
 */
function quantSignal(
  bars,
  options = {}
) {
  const {
    emaFastPeriod = 20,
    emaSlowPeriod = 50,
    emaTrendPeriod = 200,
    breakoutPeriod = 20,
    atrPeriod = 14,
    volumePeriod = 20,
    rocPeriod = 10,
  } = options;

  if (!bars || bars.length < 60) {
    return {
      signal: 0,
      strength: 0,
      reason: '데이터 부족',
      indicators: {},
    };
  }

  const opens = bars.map(b => b.open);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const closes = bars.map(b => b.close);
  const volumes = bars.map(b => b.volume || 0);

  const last =
    closes[closes.length - 1];

  const previous =
    closes[closes.length - 2];

  const emaFast = ema(
    closes,
    emaFastPeriod
  );

  const emaSlow = ema(
    closes,
    emaSlowPeriod
  );

  const emaTrend = ema(
    closes,
    emaTrendPeriod
  );

  const currentAtr = atr(
    highs,
    lows,
    closes,
    atrPeriod
  );

  const currentVwap = vwap(
    highs,
    lows,
    closes,
    volumes,
    20
  );

  const currentRsi = rsi(
    closes,
    14
  );

  const currentRoc = roc(
    closes,
    rocPeriod
  );

  const volumeZ = zScore(
    volumes,
    volumePeriod
  );

  const priorHigh = highest(
    highs.slice(0, -1),
    breakoutPeriod
  );

  const priorLow = lowest(
    lows.slice(0, -1),
    breakoutPeriod
  );

  if (
    !emaFast ||
    !emaSlow ||
    !emaTrend ||
    !currentAtr ||
    !currentVwap
  ) {
    return {
      signal: 0,
      strength: 0,
      reason: '지표 부족',
      indicators: {},
    };
  }

  /*
   * 핵심:
   *
   * 단순히 "점수 높음"이 아니라
   *
   * 1. 장기 상승 추세
   * 2. 중기 상승 추세
   * 3. 가격이 VWAP 위
   * 4. 모멘텀 양수
   * 5. 거래량 증가
   * 6. 돌파
   *
   * 여러 조건이 동시에 맞을 때만 진입.
   */

  const trendLong =
    last > emaTrend;

  const trendMedium =
    emaFast > emaSlow;

  const aboveVwap =
    last > currentVwap;

  const momentum =
    currentRoc !== null &&
    currentRoc > 0;

  const breakout =
    priorHigh !== null &&
    last > priorHigh;

  const volumeConfirmed =
    volumeZ !== null &&
    volumeZ >= 0.5;

  /*
   * RSI를 매수 조건으로 강제하지 않는다.
   *
   * RSI 70 이상이라고 무조건 매도하면
   * 강한 상승 추세를 너무 일찍 잘라버리는 문제가
   * 생길 수 있기 때문이다.
   */

  let strength = 0;

  if (trendLong) strength += 25;
  if (trendMedium) strength += 20;
  if (aboveVwap) strength += 15;
  if (momentum) strength += 15;
  if (breakout) strength += 15;
  if (volumeConfirmed) strength += 10;

  /*
   * 과열 방지.
   *
   * ATR 대비 지나치게 많이 올라간 경우
   * 추격 진입을 막는다.
   */
  const distanceFromVwap =
    currentVwap
      ? (last - currentVwap) /
        currentAtr
      : 0;

  const tooExtended =
    distanceFromVwap > 3;

  if (tooExtended) {
    strength -= 25;
  }

  /*
   * 강한 추세 + 돌파 + 거래량 확인일 때만
   * 실제 매수 신호.
   */
  const longEntry =
    trendLong &&
    trendMedium &&
    aboveVwap &&
    momentum &&
    breakout &&
    volumeConfirmed &&
    !tooExtended;

  /*
   * 추세가 깨진 경우 bearish 상태.
   */
  const bearish =
    last < emaSlow &&
    last < currentVwap &&
    currentRoc !== null &&
    currentRoc < 0;

  let signal = 0;
  let reason = '대기';

  if (longEntry) {
    signal = 1;
    reason =
      '추세 + 돌파 + 거래량 + 모멘텀 확인';
  } else if (bearish) {
    signal = -1;
    reason =
      '중기 추세 및 모멘텀 약화';
  } else if (tooExtended) {
    signal = 0;
    reason =
      '추세는 강하지만 단기 과도한 추격 구간';
  }

  return {
    signal,
    strength: Math.max(
      0,
      Math.min(100, strength)
    ),
    reason,
    indicators: {
      price: last,
      previousPrice: previous,
      emaFast,
      emaSlow,
      emaTrend,
      atr: currentAtr,
      vwap: currentVwap,
      rsi: currentRsi,
      roc: currentRoc,
      volumeZ,
      priorHigh,
      priorLow,
      distanceFromVwap,
      trendLong,
      trendMedium,
      aboveVwap,
      momentum,
      breakout,
      volumeConfirmed,
      tooExtended,
    },
  };
}

/*
 * 기존 UI와의 호환용.
 *
 * 기존 signalEngine은 technicalScore()를 사용하므로
 * 해당 API를 유지한다.
 */
function technicalScore(closes) {
  if (!closes || closes.length < 30) {
    return {
      score: 0,
      detail: {},
      reason: '데이터 부족',
    };
  }

  const last =
    closes[closes.length - 1];

  const sma20 = sma(closes, 20);
  const sma50 = sma(
    closes,
    Math.min(50, closes.length - 1)
  );

  const rsiVal = rsi(closes, 14);
  const macdVal = macd(closes);
  const bb = bollingerBands(
    closes,
    20
  );

  let score = 0;

  const detail = {};

  if (sma20 && sma50) {
    if (sma20 > sma50) {
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
    if (last > sma20) {
      score += 15;
    } else {
      score -= 15;
    }
  }

  if (rsiVal !== null) {
    detail.rsi =
      rsiVal.toFixed(1);

    if (
      rsiVal >= 45 &&
      rsiVal <= 68
    ) {
      score += 10;
      detail.rsiSignal =
        '건전한 상승 모멘텀';
    } else if (rsiVal < 30) {
      score += 8;
      detail.rsiSignal =
        '과매도';
    } else if (rsiVal > 75) {
      score -= 8;
      detail.rsiSignal =
        '단기 과열';
    }
  }

  if (macdVal) {
    detail.macdHistogram =
      macdVal.histogram.toFixed(3);

    if (macdVal.histogram > 0) {
      score += 15;
    } else {
      score -= 15;
    }
  }

  if (bb) {
    if (last > bb.middle) {
      score += 10;
    } else {
      score -= 10;
    }
  }

  score = Math.max(
    -100,
    Math.min(100, score)
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
