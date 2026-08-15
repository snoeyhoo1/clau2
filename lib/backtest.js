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

function computeUpProbability(
  closes,
  technicalScore = 0
) {
  if (
    !Array.isArray(closes) ||
    closes.length < 20
  ) {
    return 50;
  }

  const recent =
    closes.slice(-20);

  let up = 0;

  for (
    let i = 1;
    i < recent.length;
    i++
  ) {
    if (
      recent[i] >
      recent[i - 1]
    ) {
      up++;
    }
  }

  const base =
    (
      up /
      (recent.length - 1)
    ) *
    100;

  return round(
    clamp(
      base +
        finite(
          technicalScore
        ) *
          0.2,
      0,
      100
    ),
    1
  );
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
  computeUpProbability,
  analyzeAgents,
};
