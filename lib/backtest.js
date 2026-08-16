// lib/backtest.js
// Point-in-time Multi-Agent Backtest
//
// 핵심 원칙:
// 1. 현재 시점의 뉴스/시장정보를 과거 봉에 사용하지 않는다.
// 2. 매 봉에서 해당 봉 이전 데이터만 Agent에 전달한다.
// 3. 라이브와 동일한 agentEngine + ensembleJudge를 사용한다.
// 4. contextSeries가 있으면 해당 timestamp 이하의 정보만 사용한다.
// 5. contextSeries가 없으면 가격/거래량 기반 기술 Agent만 사용한다.

const {
  runAgentEngine,
} = require('./engine/agentEngine');

const DEFAULTS = {
  initialCapital: 100000,

  feeRate: 0.0005,

  slippageRate: 0.0005,

  riskPerTrade: 0.0075,

  maxPositionPct: 0.35,

  maxTradesPerDay: 8,

  warmup: 120,

  dayIntervalBars: 1,

  atrPeriod: 14,

  stopATR: 1.35,

  targetATR: 2.4,

  trailingATR: 1.5,

  maxHoldingBars: 24,

  minConfidence: 0.42,

  minRiskReward: 1.5,

  contextLookback: 1,
};

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function round(value, digits = 2) {
  const n = Number(value);

  if (!Number.isFinite(n)) return null;

  const factor =
    10 ** digits;

  return (
    Math.round(
      n * factor
    ) / factor
  );
}

function normalizeBars(bars) {
  if (!Array.isArray(bars)) return [];

  return bars
    .map(
      (bar, index) => ({
        ...bar,
        open:
          finite(bar.open),
        high:
          finite(bar.high),
        low:
          finite(bar.low),
        close:
          finite(bar.close),
        volume:
          Math.max(
            0,
            finite(bar.volume)
          ),
        timestamp:
          Number.isFinite(
            Number(bar.timestamp)
          )
            ? Number(bar.timestamp)
            : null,
        date:
          bar.date ||
          null,
        _index:
          index,
      })
    )
    .filter(
      bar =>
        bar.close > 0 &&
        bar.high >= bar.low
    );
}

function getDateKey(bar, fallbackIndex) {
  if (bar?.date) {
    return String(
      bar.date
    ).slice(0, 10);
  }

  if (bar?.timestamp) {
    return new Date(
      bar.timestamp * 1000
    )
      .toISOString()
      .slice(0, 10);
  }

  return `bar-${fallbackIndex}`;
}

function calculateAtr(bars, period = 14) {
  if (
    bars.length <
    period + 1
  ) {
    return null;
  }

  const trs = [];

  for (
    let i =
      bars.length - period;
    i < bars.length;
    i++
  ) {
    const current =
      bars[i];

    const previous =
      bars[i - 1];

    if (!current || !previous) continue;

    trs.push(
      Math.max(
        current.high -
          current.low,
        Math.abs(
          current.high -
          previous.close
        ),
        Math.abs(
          current.low -
          previous.close
        )
      )
    );
  }

  if (!trs.length) return null;

  return (
    trs.reduce(
      (a, b) => a + b,
      0
    ) /
    trs.length
  );
}

function getHistoricalContext(
  contextSeries,
  timestamp,
  index
) {
  if (
    !contextSeries ||
    typeof contextSeries !== 'object'
  ) {
    return {
      market: {},
      sector: {},
      news: [],
      earnings: {},
    };
  }

  /*
   * contextSeries can be:
   *
   * {
   *   market: [
   *     { timestamp, data }
   *   ],
   *   sector: [...],
   *   news: [...],
   *   earnings: [...]
   * }
   */
  function latest(
    series,
    mapper
  ) {
    if (!Array.isArray(series)) {
      return null;
    }

    let result = null;

    for (const item of series) {
      const itemTime =
        Number(
          item?.timestamp ??
          (
            item?.date
              ? Date.parse(
                  item.date
                ) / 1000
              : NaN
          )
        );

      if (
        Number.isFinite(itemTime) &&
        Number.isFinite(timestamp)
      ) {
        if (
          itemTime <=
          timestamp
        ) {
          result =
            mapper(item);
        }
      } else if (
        Number.isFinite(
          Number(item?.index)
        ) &&
        Number(item.index) <= index
      ) {
        result =
          mapper(item);
      }
    }

    return result;
  }

  const market =
    latest(
      contextSeries.market,
      item =>
        item.data ||
        item.market ||
        {}
    ) || {};

  const sector =
    latest(
      contextSeries.sector,
      item =>
        item.data ||
        item.sector ||
        {}
    ) || {};

  const news =
    latest(
      contextSeries.news,
      item =>
        item.articles ||
        item.news ||
        []
    ) || [];

  const earnings =
    latest(
      contextSeries.earnings,
      item =>
        item.data ||
        item.earnings ||
        {}
    ) || {};

  return {
    market,
    sector,
    news:
      Array.isArray(news)
        ? news
        : [],
    earnings,
  };
}

/*
 * "지금과 비슷한 신호가 떴을 때 N거래일 후 실제로
 * 얼마나 자주 올랐는가"를 계산한다.
 *
 * 방법 (analog matching):
 * 1. "신호 지문(fingerprint)"을 최근 20거래일 수익률로 정의한다.
 *    (기술점수는 지문을 미세 조정하는 데만 사용 - 순수 가격 모멘텀이 핵심)
 * 2. 과거 전체 구간에서 같은 지문(±허용오차)을 가진 시점들을 찾는다.
 * 3. 그 시점들에서 각 horizon(5/10/20 거래일) 뒤 실제로 오른 비율과
 *    평균 수익률을 계산한다.
 * 4. 표본이 너무 적으면(8개 미만) "데이터 부족"으로 표시한다.
 *
 * 완전한 미래 예측이 아니라 과거 데이터 기반 참고 지표이며,
 * UI(app.js renderUpProbability)가 기대하는
 * { byHorizon: { [horizon]: { probability, avgReturnPct, sampleSize } } }
 * 형태로 반환한다.
 */
const UP_PROBABILITY_HORIZONS = [5, 10, 20];
const UP_PROBABILITY_LOOKBACK = 20;
const UP_PROBABILITY_MIN_SAMPLES = 8;

function fingerprintReturn(closes, index, lookback) {
  const start = closes[index - lookback];
  const end = closes[index];

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start === 0
  ) {
    return null;
  }

  return ((end - start) / start) * 100;
}

function computeUpProbability(
  closes,
  technicalScore = 0
) {
  const byHorizon = {};

  for (const horizon of UP_PROBABILITY_HORIZONS) {
    byHorizon[horizon] = {
      probability: null,
      avgReturnPct: null,
      sampleSize: 0,
    };
  }

  if (
    !Array.isArray(closes) ||
    closes.length <
      UP_PROBABILITY_LOOKBACK +
        Math.max(...UP_PROBABILITY_HORIZONS) +
        1
  ) {
    return { byHorizon };
  }

  const lastIndex = closes.length - 1;

  const currentFingerprint =
    fingerprintReturn(
      closes,
      lastIndex,
      UP_PROBABILITY_LOOKBACK
    );

  if (currentFingerprint === null) {
    return { byHorizon };
  }

  /*
   * 기술점수로 지문을 살짝 보정한다.
   * (강한 기술 신호일수록 비슷한 모멘텀 구간을
   *  조금 더 좁혀서 매칭 정확도를 높임)
   */
  const scoreAdjustedFingerprint =
    currentFingerprint +
    finite(technicalScore) * 0.05;

  /*
   * 허용 오차: 지문 크기에 비례하되 최소 3%p는 보장.
   */
  const tolerance = Math.max(
    3,
    Math.abs(scoreAdjustedFingerprint) * 0.35
  );

  for (const horizon of UP_PROBABILITY_HORIZONS) {
    let upCount = 0;
    let sampleSize = 0;
    let returnSum = 0;

    /*
     * 과거 구간을 훑되, horizon 뒤 데이터가
     * 존재하는 시점까지만 후보로 삼는다.
     */
    for (
      let i = UP_PROBABILITY_LOOKBACK;
      i <= lastIndex - horizon;
      i++
    ) {
      const pastFingerprint =
        fingerprintReturn(
          closes,
          i,
          UP_PROBABILITY_LOOKBACK
        );

      if (pastFingerprint === null) continue;

      if (
        Math.abs(
          pastFingerprint -
            scoreAdjustedFingerprint
        ) > tolerance
      ) {
        continue;
      }

      const future = closes[i + horizon];
      const anchor = closes[i];

      if (
        !Number.isFinite(future) ||
        !Number.isFinite(anchor) ||
        anchor === 0
      ) {
        continue;
      }

      const forwardReturnPct =
        ((future - anchor) / anchor) * 100;

      sampleSize++;
      returnSum += forwardReturnPct;

      if (forwardReturnPct > 0) {
        upCount++;
      }
    }

    if (sampleSize >= UP_PROBABILITY_MIN_SAMPLES) {
      byHorizon[horizon] = {
        probability: round(
          (upCount / sampleSize) * 100,
          1
        ),
        avgReturnPct: round(
          returnSum / sampleSize,
          2
        ),
        sampleSize,
      };
    } else {
      byHorizon[horizon] = {
        probability: null,
        avgReturnPct: null,
        sampleSize,
      };
    }
  }

  return { byHorizon };
}

function calculatePositionSize({
  equity,
  price,
  atr,
  cfg,
}) {
  if (
    !equity ||
    !price ||
    !atr
  ) {
    return 0;
  }

  const riskCapital =
    equity *
    cfg.riskPerTrade;

  const stopDistance =
    atr *
    cfg.stopATR;

  if (
    stopDistance <= 0
  ) {
    return 0;
  }

  const shares =
    riskCapital /
    stopDistance;

  const maxValue =
    equity *
    cfg.maxPositionPct;

  const maxShares =
    maxValue /
    price;

  return Math.max(
    0,
    Math.floor(
      Math.min(
        shares,
        maxShares
      )
    )
  );
}

function executionCost(
  price,
  cfg,
  direction
) {
  const fee =
    price *
    cfg.feeRate;

  const slippage =
    price *
    cfg.slippageRate;

  return direction === 'BUY'
    ? price +
        fee +
        slippage
    : price -
        fee -
        slippage;
}

function updateTrailingStop(
  position,
  high
) {
  if (
    !position ||
    !position.atr
  ) {
    return;
  }

  const candidate =
    high -
    position.atr *
      position.trailingATR;

  if (
    candidate >
    position.stop
  ) {
    position.stop =
      candidate;
  }
}

function runQuantBacktest(
  inputBars,
  dates = [],
  options = {}
) {
  const cfg = {
    ...DEFAULTS,
    ...options,
  };

  const bars =
    normalizeBars(
      inputBars
    );

  if (
    bars.length <
    cfg.warmup + 10
  ) {
    return {
      initialCapital:
        cfg.initialCapital,
      finalCapital:
        cfg.initialCapital,
      returnPct: 0,
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      maxDrawdownPct: 0,
      sharpe: 0,
      trades: [],
      equityCurve: [],
      signalCoverage: 0,
      contextCoverage: 0,
      error:
        '백테스트 데이터 부족',
    };
  }

  const contextSeries =
    options.contextSeries ||
    {};

  let cash =
    cfg.initialCapital;

  let position = null;

  let peakEquity =
    cfg.initialCapital;

  let maxDrawdown =
    0;

  let wins = 0;
  let losses = 0;

  let grossProfit = 0;
  let grossLoss = 0;

  let signalCount = 0;
  let evaluatedCount = 0;

  let contextCount = 0;

  const trades = [];
  const equityCurve = [];

  const dailyTradeCount =
    new Map();

  function currentEquity(price) {
    if (!position) {
      return cash;
    }

    return (
      cash +
      position.shares *
        price
    );
  }

  function closePosition(
    index,
    price,
    reason
  ) {
    if (!position) return;

    const exitPrice =
      executionCost(
        price,
        cfg,
        'SELL'
      );

    const proceeds =
      position.shares *
      exitPrice;

    cash +=
      proceeds;

    const pnl =
      (
        exitPrice -
        position.entryPrice
      ) *
      position.shares;

    const pnlPct =
      (
        (
          exitPrice -
          position.entryPrice
        ) /
        position.entryPrice
      ) *
      100;

    const trade = {
      entryIndex:
        position.entryIndex,
      exitIndex:
        index,

      entryDate:
        position.entryDate,

      exitDate:
        dates[index] ||
        bars[index]?.date ||
        null,

      entryPrice:
        round(
          position.entryPrice
        ),

      exitPrice:
        round(
          exitPrice
        ),

      shares:
        position.shares,

      pnl:
        round(pnl),

      pnlPct:
        round(pnlPct),

      reason,

      setup:
        position.setup,

      confidence:
        position.confidence,

      regime:
        position.regime,
    };

    trades.push(
      trade
    );

    if (pnl > 0) {
      wins++;
      grossProfit +=
        pnl;
    } else {
      losses++;
      grossLoss +=
        Math.abs(pnl);
    }

    position = null;
  }

  for (
    let i = cfg.warmup;
    i < bars.length;
    i++
  ) {
    const bar =
      bars[i];

    const history =
      bars.slice(
        0,
        i + 1
      );

    const timestamp =
      Number(
        bar.timestamp
      );

    const historicalContext =
      getHistoricalContext(
        contextSeries,
        timestamp,
        i
      );

    const hasContext =
      Object.keys(
        historicalContext.market ||
        {}
      ).length > 0 ||
      Object.keys(
        historicalContext.sector ||
        {}
      ).length > 0 ||
      historicalContext.news.length > 0 ||
      Object.keys(
        historicalContext.earnings ||
        {}
      ).length > 0;

    if (hasContext) {
      contextCount++;
    }

    /*
     * Point-in-time guarantee:
     * history는 i까지 포함.
     * i+1 이후 데이터는 절대 사용하지 않는다.
     */
    const result =
      runAgentEngine({
        bars:
          history,
        market:
          historicalContext.market,
        sector:
          historicalContext.sector,
        news:
          historicalContext.news,
        earnings:
          historicalContext.earnings,
        mode:
          'DAY',
        position:
          position
            ? {
                marketValue:
                  position.shares *
                  bar.close,
                atr:
                  position.atr,
              }
            : {},
      });

    evaluatedCount++;

    if (
      result.signal !== 0
    ) {
      signalCount++;
    }

    const price =
      bar.close;

    /*
     * Manage open position first.
     */
    if (position) {
      updateTrailingStop(
        position,
        bar.high
      );

      const holdingBars =
        i -
        position.entryIndex;

      if (
        bar.low <=
        position.stop
      ) {
        closePosition(
          i,
          position.stop,
          'STOP'
        );
      } else if (
        bar.high >=
        position.target
      ) {
        closePosition(
          i,
          position.target,
          'TARGET'
        );
      } else if (
        result.signal === -1 &&
        result.confidence >=
          cfg.minConfidence
      ) {
        closePosition(
          i,
          price,
          'AI_EXIT'
        );
      } else if (
        holdingBars >=
        cfg.maxHoldingBars
      ) {
        closePosition(
          i,
          price,
          'TIME_EXIT'
        );
      }
    }

    /*
     * Entry.
     */
    if (!position) {
      const dateKey =
        getDateKey(
          bar,
          i
        );

      const count =
        dailyTradeCount.get(
          dateKey
        ) || 0;

      if (
        count <
        cfg.maxTradesPerDay &&
        result.signal === 1 &&
        result.confidence >=
          cfg.minConfidence &&
        !result.ensemble?.blocked
      ) {
        const atr =
          Number(
            result.agents?.RISK
              ?.evidence?.atr
          ) ||
          calculateAtr(
            history,
            cfg.atrPeriod
          );

        const entryPrice =
          executionCost(
            price,
            cfg,
            'BUY'
          );

        const shares =
          calculatePositionSize({
            equity:
              currentEquity(
                price
              ),
            price:
              entryPrice,
            atr,
            cfg,
          });

        const riskDistance =
          atr *
          cfg.stopATR;

        const rewardDistance =
          atr *
          cfg.targetATR;

        const riskReward =
          riskDistance > 0
            ? rewardDistance /
              riskDistance
            : 0;

        if (
          shares > 0 &&
          riskReward >=
            cfg.minRiskReward
        ) {
          position = {
            entryIndex:
              i,

            entryDate:
              dates[i] ||
              bar.date ||
              null,

            entryPrice,

            shares,

            atr,

            stop:
              entryPrice -
              riskDistance,

            target:
              entryPrice +
              rewardDistance,

            trailingATR:
              cfg.trailingATR,

            setup:
              result.setup,

            confidence:
              result.confidence,

            regime:
              result.regime,
          };

          cash -=
            shares *
            entryPrice;

          dailyTradeCount.set(
            dateKey,
            count + 1
          );
        }
      }
    }

    const equity =
      currentEquity(
        price
      );

    peakEquity =
      Math.max(
        peakEquity,
        equity
      );

    const drawdown =
      peakEquity > 0
        ? (
            (
              equity -
              peakEquity
            ) /
            peakEquity
          ) *
          100
        : 0;

    maxDrawdown =
      Math.min(
        maxDrawdown,
        drawdown
      );

    equityCurve.push({
      index: i,
      date:
        dates[i] ||
        bar.date ||
        null,
      equity:
        round(equity, 2),
      drawdownPct:
        round(drawdown, 2),
    });
  }

  if (position) {
    closePosition(
      bars.length - 1,
      bars.at(-1).close,
      'END'
    );
  }

  const finalCapital =
    cash;

  const returnPct =
    (
      (
        finalCapital -
        cfg.initialCapital
      ) /
      cfg.initialCapital
    ) *
    100;

  const totalTrades =
    trades.length;

  const winRate =
    totalTrades
      ? (
          wins /
          totalTrades
        ) *
        100
      : 0;

  const profitFactor =
    grossLoss > 0
      ? grossProfit /
        grossLoss
      : grossProfit > 0
        ? Infinity
        : 0;

  const returns = [];

  for (
    let i = 1;
    i < equityCurve.length;
    i++
  ) {
    const previous =
      equityCurve[i - 1].equity;

    const current =
      equityCurve[i].equity;

    if (
      previous > 0 &&
      current > 0
    ) {
      returns.push(
        Math.log(
          current /
          previous
        )
      );
    }
  }

  const meanReturn =
    returns.length
      ? returns.reduce(
          (a, b) =>
            a + b,
          0
        ) /
        returns.length
      : 0;

  const variance =
    returns.length > 1
      ? returns.reduce(
          (sum, value) =>
            sum +
            (
              value -
              meanReturn
            ) ** 2,
          0
        ) /
        (returns.length - 1)
      : 0;

  const stdReturn =
    Math.sqrt(
      variance
    );

  const sharpe =
    stdReturn > 0
      ? (
          meanReturn /
          stdReturn
        ) *
        Math.sqrt(252)
      : 0;

  return {
    initialCapital:
      cfg.initialCapital,

    finalCapital:
      round(
        finalCapital,
        2
      ),

    returnPct:
      round(
        returnPct,
        2
      ),

    totalTrades,

    wins,
    losses,

    winRate:
      round(
        winRate,
        2
      ),

    profitFactor:
      Number.isFinite(
        profitFactor
      )
        ? round(
            profitFactor,
            2
          )
        : null,

    maxDrawdownPct:
      round(
        maxDrawdown,
        2
      ),

    sharpe:
      round(
        sharpe,
        3
      ),

    signalCoverage:
      evaluatedCount
        ? round(
            signalCount /
              evaluatedCount,
            3
          )
        : 0,

    contextCoverage:
      evaluatedCount
        ? round(
            contextCount /
              evaluatedCount,
            3
          )
        : 0,

    pointInTime:
      true,

    trades,

    equityCurve,
  };
}

/*
 * ============================================================
 * WALK-FORWARD VALIDATION (out-of-sample 검증)
 *
 * 지금 agent 가중치/임계값은 전부 고정값(하드코딩)이라 "학습"
 * 자체가 없다. 그래서 엄밀한 의미의 walk-forward optimization
 * (구간마다 파라미터를 다시 학습)은 적용할 수 없다.
 *
 * 대신 여기서 하는 건 "구간별 out-of-sample 안정성 검증"이다:
 * 전체 기간을 N개의 연속 구간(fold)으로 나누고, 각 구간을
 * 완전히 독립적으로 백테스트해서 - 특정 한 구간(예: 강세장)에서만
 * 우연히 잘 맞았던 건 아닌지, 여러 시기에 걸쳐 꾸준히 통하는지
 * 확인한다.
 *
 * 각 fold는 자신의 warmup(지표 계산용 선행 구간)을 별도로 갖고
 * 시작하므로, fold끼리 미래 정보가 새어 들어가는 lookahead는 없다.
 * ============================================================
 */
function runWalkForwardValidation(
  inputBars,
  options = {}
) {
  const cfg = {
    ...DEFAULTS,
    ...options,
  };

  const bars = normalizeBars(inputBars);

  const dates =
    Array.isArray(options.dates)
      ? options.dates
      : bars.map(b => b.date || null);

  const folds = Math.max(
    2,
    Math.min(8, Number(options.folds) || 4)
  );

  const tradableLength =
    bars.length - cfg.warmup;

  if (
    tradableLength <
    folds * 20
  ) {
    return {
      ok: false,
      error:
        '구간 검증에 필요한 데이터가 부족합니다. ' +
        '더 긴 기간을 선택해주세요.',
      folds: [],
    };
  }

  const chunkSize = Math.floor(
    tradableLength / folds
  );

  const foldResults = [];

  for (let k = 0; k < folds; k++) {
    const tradingStart =
      cfg.warmup + k * chunkSize;

    const tradingEnd =
      k === folds - 1
        ? bars.length
        : cfg.warmup +
          (k + 1) * chunkSize;

    const sliceStart =
      tradingStart - cfg.warmup;

    const sliceBars = bars.slice(
      sliceStart,
      tradingEnd
    );

    const sliceDates = dates.slice(
      sliceStart,
      tradingEnd
    );

    const result = runQuantBacktest(
      sliceBars,
      sliceDates,
      {
        ...options,
        warmup: cfg.warmup,
      }
    );

    foldResults.push({
      fold: k + 1,
      startDate:
        dates[tradingStart] || null,
      endDate:
        dates[tradingEnd - 1] || null,
      barCount:
        tradingEnd - tradingStart,
      returnPct: result.returnPct,
      winRate: result.winRate,
      totalTrades: result.totalTrades,
      profitFactor:
        result.profitFactor,
      maxDrawdownPct:
        result.maxDrawdownPct,
      sharpe: result.sharpe,
    });
  }

  const profitableFolds =
    foldResults.filter(
      f => f.returnPct > 0
    ).length;

  const returns = foldResults.map(
    f => f.returnPct
  );

  const meanReturn =
    returns.reduce((a, b) => a + b, 0) /
    returns.length;

  const variance =
    returns.reduce(
      (sum, r) =>
        sum + (r - meanReturn) ** 2,
      0
    ) / returns.length;

  const stdReturn = Math.sqrt(variance);

  /*
   * consistency: 구간 간 수익률 편차가 평균 대비 얼마나 큰가.
   * 값이 작을수록(즉 stdReturn이 meanReturn 대비 작을수록)
   * 특정 구간에 의존하지 않고 고르게 통했다는 뜻.
   * meanReturn이 0에 가까우면 비율 자체가 불안정하므로 null 처리.
   */
  const consistencyRatio =
    Math.abs(meanReturn) > 0.01
      ? round(
          stdReturn / Math.abs(meanReturn),
          2
        )
      : null;

  return {
    ok: true,
    folds: foldResults,
    summary: {
      totalFolds: folds,
      profitableFolds,
      profitableFoldRatio: round(
        profitableFolds / folds,
        2
      ),
      meanReturnPct: round(
        meanReturn,
        2
      ),
      stdReturnPct: round(
        stdReturn,
        2
      ),
      consistencyRatio,
      verdict:
        profitableFolds === folds
          ? '모든 구간에서 수익 - 비교적 안정적'
          : profitableFolds >=
            Math.ceil(folds / 2)
            ? '일부 구간에서만 수익 - 특정 시장 상황에 의존할 수 있음'
            : '대부분 구간에서 손실 - 이 설정을 실거래에 쓰기엔 위험함',
    },
  };
}

function runBacktest(
  bars,
  options = {}
) {
  const dates =
    Array.isArray(
      options.dates
    )
      ? options.dates
      : bars.map(
          b =>
            b.date ||
            null
        );

  return runQuantBacktest(
    bars,
    dates,
    options
  );
}

function analyzeAgents(
  bars,
  options = {}
) {
  if (
    !Array.isArray(bars) ||
    bars.length < 100
  ) {
    return null;
  }

  return runAgentEngine({
    bars,
    market:
      options.market || {},
    sector:
      options.sector || {},
    news:
      options.news || [],
    earnings:
      options.earnings || {},
    mode:
      options.mode || 'DAY',
  });
}

module.exports = {
  runQuantBacktest,
  runBacktest,
  runWalkForwardValidation,
  computeUpProbability,
  analyzeAgents,
};
