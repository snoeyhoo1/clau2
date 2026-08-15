// lib/indicators.js
// 기술적 지표 + 데이트레이딩 퀀트 전략
// 모든 배열은 과거 -> 최신 순서

function sma(values, period) {
  if (
    !values ||
    values.length < period
  ) {
    return null;
  }

  const slice =
    values.slice(-period);

  return (
    slice.reduce(
      (a, b) => a + b,
      0
    ) / period
  );
}

function ema(values, period) {
  if (
    !values ||
    values.length < period
  ) {
    return null;
  }

  const k =
    2 / (period + 1);

  let value =
    sma(
      values.slice(
        0,
        period
      ),
      period
    );

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    value =
      values[i] * k +
      value * (1 - k);
  }

  return value;
}

function emaSeries(
  values,
  period
) {
  if (
    !values ||
    values.length < period
  ) {
    return [];
  }

  const k =
    2 / (period + 1);

  const result = [];

  let value =
    sma(
      values.slice(
        0,
        period
      ),
      period
    );

  result.push(value);

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    value =
      values[i] * k +
      value * (1 - k);

    result.push(value);
  }

  return result;
}

function rsi(
  closes,
  period = 14
) {
  if (
    !closes ||
    closes.length <
      period + 1
  ) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (
    let i =
      closes.length - period;
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

  if (
    avgLoss === 0
  ) {
    return 100;
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

  if (
    !signalLine.length
  ) {
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
      stdDevMult * stdDev,

    middle:
      mean,

    lower:
      mean -
      stdDevMult * stdDev,

    width:
      mean
        ? (
            (stdDevMult *
              2 *
              stdDev) /
            mean
          ) * 100
        : 0,
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
        (a, b) => a + b,
        0
      ) / period;

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
      ) / period;

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

  if (
    !volumeTotal
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
      (a, b) => a + b,
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
    (slice[
      slice.length - 1
    ] - mean) /
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

/**
 * 데이트레이딩 퀀트 전략.
 *
 * 전략 A:
 * Trend Momentum
 *
 * 전략 B:
 * VWAP Pullback
 *
 * 전략 C:
 * Breakout
 *
 * 세 전략을 점수화하고
 * 일정 점수 이상이면 진입한다.
 *
 * signal:
 *  1  = LONG
 *  0  = WAIT
 * -1  = EXIT
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

    breakoutPeriod: 12,

    atrPeriod: 14,

    volumePeriod: 20,

    rocFastPeriod: 3,
    rocSlowPeriod: 10,

    rsiPeriod: 14,

    entryThreshold: 58,

    ...options,
  };

  if (
    !bars ||
    bars.length < 80
  ) {
    return {
      signal: 0,
      strength: 0,
      setup: 'NONE',
      reason: '데이터 부족',
      indicators: {},
    };
  }

  const opens =
    bars.map(
      (b) => Number(b.open)
    );

  const highs =
    bars.map(
      (b) => Number(b.high)
    );

  const lows =
    bars.map(
      (b) => Number(b.low)
    );

  const closes =
    bars.map(
      (b) => Number(b.close)
    );

  const volumes =
    bars.map(
      (b) =>
        Number(b.volume) || 0
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

  const fastRoc =
    roc(
      closes,
      cfg.rocFastPeriod
    );

  const slowRoc =
    roc(
      closes,
      cfg.rocSlowPeriod
    );

  const volumeZ =
    zScore(
      volumes,
      cfg.volumePeriod
    );

  const priorHigh =
    highest(
      highs.slice(
        0,
        -1
      ),
      cfg.breakoutPeriod
    );

  const priorLow =
    lowest(
      lows.slice(
        0,
        -1
      ),
      cfg.breakoutPeriod
    );

  const bb =
    bollingerBands(
      closes,
      20,
      2
    );

  if (
    !emaFast ||
    !emaSlow ||
    !emaTrend ||
    !atrValue ||
    !currentVwap
  ) {
    return {
      signal: 0,
      strength: 0,
      setup: 'NONE',
      reason: '지표 부족',
      indicators: {},
    };
  }

  const trendUp =
    emaFast >
      emaSlow &&
    emaSlow >
      emaTrend;

  const trendDown =
    emaFast <
      emaSlow &&
    emaSlow <
      emaTrend;

  const aboveVwap =
    last >
    currentVwap;

  const belowVwap =
    last <
    currentVwap;

  const volumeConfirmed =
    volumeZ !== null &&
    volumeZ >= -0.2;

  const volumeStrong =
    volumeZ !== null &&
    volumeZ >= 0.7;

  const momentumUp =
    fastRoc !== null &&
    slowRoc !== null &&
    fastRoc > 0 &&
    slowRoc > 0;

  const momentumDown =
    fastRoc !== null &&
    slowRoc !== null &&
    fastRoc < 0 &&
    slowRoc < 0;

  const breakoutUp =
    priorHigh !== null &&
    last >
      priorHigh;

  const breakdown =
    priorLow !== null &&
    last <
      priorLow;

  const vwapDistance =
    atrValue > 0
      ? (
          last -
          currentVwap
        ) / atrValue
      : 0;

  const pullbackToVwap =
    Math.abs(
      vwapDistance
    ) <= 1.25;

  const healthyRsi =
    currentRsi !== null &&
    currentRsi >= 45 &&
    currentRsi <= 72;

  const oversoldRecovery =
    currentRsi !== null &&
    currentRsi >= 30 &&
    currentRsi < 48;

  const notOverextended =
    vwapDistance < 2.5;

  /*
   * Trend Momentum
   */
  let momentumScore = 0;

  if (trendUp)
    momentumScore += 25;

  if (aboveVwap)
    momentumScore += 15;

  if (momentumUp)
    momentumScore += 20;

  if (volumeConfirmed)
    momentumScore += 10;

  if (healthyRsi)
    momentumScore += 10;

  if (breakoutUp)
    momentumScore += 20;

  if (!notOverextended)
    momentumScore -= 20;

  /*
   * VWAP Pullback
   */
  let pullbackScore = 0;

  if (trendUp)
    pullbackScore += 25;

  if (aboveVwap)
    pullbackScore += 15;

  if (pullbackToVwap)
    pullbackScore += 20;

  if (
    oversoldRecovery
  ) {
    pullbackScore += 15;
  }

  if (momentumUp)
    pullbackScore += 15;

  if (volumeConfirmed)
    pullbackScore += 10;

  /*
   * Breakout
   */
  let breakoutScore = 0;

  if (trendUp)
    breakoutScore += 20;

  if (breakoutUp)
    breakoutScore += 30;

  if (volumeStrong)
    breakoutScore += 25;

  if (aboveVwap)
    breakoutScore += 10;

  if (momentumUp)
    breakoutScore += 15;

  /*
   * 가장 강한 setup 선택.
   */
  const candidates = [
    {
      name: 'TREND_MOMENTUM',
      score: momentumScore,
    },

    {
      name: 'VWAP_PULLBACK',
      score: pullbackScore,
    },

    {
      name: 'BREAKOUT',
      score: breakoutScore,
    },
  ];

  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );

  const best =
    candidates[0];

  /*
   * 평균회귀 보조 전략.
   *
   * 강한 상승 추세에서
   * VWAP 아래로 살짝 밀렸다가
   * 회복하는 경우.
   */
  const vwapRecovery =
    trendUp &&
    last >= currentVwap &&
    previous < currentVwap &&
    momentumUp;

  if (
    vwapRecovery &&
    pullbackScore >= 50
  ) {
    pullbackScore += 12;
  }

  const finalCandidates = [
    {
      name: 'TREND_MOMENTUM',
      score: momentumScore,
    },

    {
      name: 'VWAP_PULLBACK',
      score: pullbackScore,
    },

    {
      name: 'BREAKOUT',
      score: breakoutScore,
    },
  ].sort(
    (a, b) =>
      b.score -
      a.score
  );

  const finalBest =
    finalCandidates[0];

  /*
   * 과도한 추격 방지.
   */
  const tooExtended =
    vwapDistance > 2.8;

  /*
   * bearish exit.
   */
  const bearish =
    trendDown ||
    (
      belowVwap &&
      momentumDown &&
      currentRsi !== null &&
      currentRsi < 45
    );

  let signal = 0;

  let reason =
    '조건 대기';

  let setup =
    'NONE';

  let strength =
    Math.max(
      0,
      Math.min(
        100,
        finalBest.score
      )
    );

  if (
    bearish &&
    strength < 55
  ) {
    signal = -1;

    setup = 'EXIT';

    reason =
      '단기 추세 및 VWAP 모멘텀 약화';
  } else if (
    !tooExtended &&
    finalBest.score >=
      cfg.entryThreshold
  ) {
    signal = 1;

    setup =
      finalBest.name;

    if (
      setup ===
      'TREND_MOMENTUM'
    ) {
      reason =
        'EMA 추세 + VWAP + 모멘텀 확인';
    } else if (
      setup ===
      'VWAP_PULLBACK'
    ) {
      reason =
        '상승 추세 내 VWAP 눌림목 회복';
    } else {
      reason =
        '고점 돌파 + 거래량 + 모멘텀 확인';
    }
  } else if (
    tooExtended
  ) {
    reason =
      '신호는 강하지만 단기 과열';
  }

  return {
    signal,

    strength,

    setup,

    reason,

    indicators: {
      price: last,
      previousPrice: previous,

      emaFast,
      emaSlow,
      emaTrend,

      atr: atrValue,

      vwap:
        currentVwap,

      vwapDistance,

      rsi:
        currentRsi,

      rocFast:
        fastRoc,

      rocSlow:
        slowRoc,

      volumeZ,

      priorHigh,

      priorLow,

      bollinger:
        bb,

      trendUp,
      trendDown,

      aboveVwap,
      belowVwap,

      volumeConfirmed,
      volumeStrong,

      momentumUp,
      momentumDown,

      breakoutUp,
      breakdown,

      pullbackToVwap,
      healthyRsi,
      oversoldRecovery,

      vwapRecovery,
      tooExtended,

      setupScores: {
        trendMomentum:
          momentumScore,

        vwapPullback:
          pullbackScore,

        breakout:
          breakoutScore,
      },
    },
  };
}

/**
 * 기존 UI용 기술점수.
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
      reason: '데이터 부족',
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
    macd(closes);

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
      rsiVal.toFixed(1);

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
