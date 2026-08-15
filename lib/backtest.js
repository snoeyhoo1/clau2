// lib/backtest.js
// 30분봉 데이트레이딩 퀀트 백테스트
//
// 전략:
// 1. Trend Momentum
// 2. VWAP Pullback
// 3. Breakout
//
// 수수료 + 슬리피지
// ATR 기반 손절/익절/트레일링
// Time Exit
// 위험 기반 포지션 사이징

const {
  quantSignal,
} = require('./indicators');

const DEFAULTS = {
  initialCapital:
    100000,

  feeRate:
    0.0005,

  slippageRate:
    0.0005,

  riskPerTrade:
    0.0075,

  atrStop:
    1.35,

  atrTarget:
    2.4,

  atrTrailing:
    1.5,

  maxHoldingBars:
    10,

  minStrength:
    58,

  maxPositionPct:
    0.35,

  maxTradesPerDay:
    6,
};

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

    if (peak > 0) {
      const dd =
        (peak - value) /
        peak;

      if (
        dd > maxDd
      ) {
        maxDd = dd;
      }
    }
  }

  return maxDd;
}

function average(
  values
) {
  if (
    !values.length
  ) {
    return null;
  }

  return (
    values.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    values.length
  );
}

function std(
  values
) {
  if (
    values.length < 2
  ) {
    return null;
  }

  const mean =
    average(values);

  const variance =
    values.reduce(
      (sum, value) =>
        sum +
        (value - mean) ** 2,
      0
    ) /
    (values.length - 1);

  return Math.sqrt(
    variance
  );
}

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

function executeBuy(
  price,
  slippageRate
) {
  return (
    price *
    (1 +
      slippageRate)
  );
}

function executeSell(
  price,
  slippageRate
) {
  return (
    price *
    (1 -
      slippageRate)
  );
}

function tradeReturn(
  entryPrice,
  exitPrice,
  feeRate
) {
  const gross =
    (exitPrice -
      entryPrice) /
    entryPrice;

  return (
    gross -
    feeRate * 2
  );
}

function dayKey(
  bar
) {
  if (
    bar.date
  ) {
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

  for (
    let t = 80;
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

    const signal =
      quantSignal(
        history
      );

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

    /*
     * 기존 포지션 청산.
     */
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
       * 같은 봉에서
       * stop/target 모두 닿으면
       * 보수적으로 stop 우선.
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
        signal.signal ===
        -1
      ) {
        exitPrice =
          bar.close;

        exitReason =
          'SIGNAL_EXIT';
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
       * 장중 마지막 봉에서
       * overnight 보유 방지.
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

    /*
     * 신규 진입.
     */
    if (
      !position &&
      signal.signal ===
        1 &&
      signal.strength >=
        cfg.minStrength &&
      tradesToday <
        cfg.maxTradesPerDay
    ) {
      const atrValue =
        signal.indicators?.atr;

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

        /*
         * 최대 투자 비중 제한.
         */
        const maxCapital =
          cash *
          cfg.maxPositionPct;

        const maxQuantity =
          Math.floor(
            maxCapital /
              (
                entryPrice *
                (1 +
                  cfg.feeRate)
              )
          );

        quantity =
          Math.min(
            quantity,
            maxQuantity
          );

        /*
         * 최소 1주.
         */
        if (
          quantity > 0
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
                signal.setup,
            };

            trades.push({
              type: 'BUY',

              date,

              price:
                entryPrice,

              quantity,

              strength:
                signal.strength,

              setup:
                signal.setup,

              reason:
                signal.reason,
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

  /*
   * 마지막 봉 강제 청산.
   */
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

  /*
   * Buy & Hold.
   */
  const startPrice =
    bars[80].close;

  const endPrice =
    bars[
      bars.length - 1
    ].close;

  const buyHoldReturn =
    (
      (endPrice -
        startPrice) /
      startPrice
    ) * 100;

  const strategyReturn =
    (
      (cash -
        cfg.initialCapital) /
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

  const setups = {
    TREND_MOMENTUM:
      completedTrades.filter(
        (trade) =>
          trade.setup ===
          'TREND_MOMENTUM'
      ).length,

    VWAP_PULLBACK:
      completedTrades.filter(
        (trade) =>
          trade.setup ===
          'VWAP_PULLBACK'
      ).length,

    BREAKOUT:
      completedTrades.filter(
        (trade) =>
          trade.setup ===
          'BREAKOUT'
      ).length,
  };

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
      trades.slice(-30),

    equityCurve,

    setupCounts:
      setups,

    parameters:
      cfg,

    dataType:
      '30분봉 장중 OHLCV',

    limitation:
      '30분봉 OHLCV 기반 백테스트입니다. 실제 장중 체결 순서, 호가잔량, 체결지연, 세금, 거래정지 등은 완전히 재현되지 않습니다.',
  };
}

/*
 * 기존 API 호환.
 */
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
            (future -
              base) /
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
};
