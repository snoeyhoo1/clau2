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
//
// 개선:
// - 거래 빈도 개선
// - 과도한 진입 제한 완화
// - 비정상 OHLCV 방어
// - 동일 신호 연속 진입 방지
// - 실제 체결 비용 반영
// - 기존 API 호환 유지

const {
  quantSignal,
} = require('./indicators');

const DEFAULTS = {
  initialCapital: 100000,

  feeRate: 0.0005,

  slippageRate: 0.0005,

  // 한 번의 거래에 계좌의 몇 %를 위험에 노출할지
  riskPerTrade: 0.005,

  // ATR 기반 손절
  atrStop: 1.2,

  // ATR 기반 목표가
  atrTarget: 2.0,

  // ATR 기반 트레일링
  atrTrailing: 1.2,

  // 30분봉 기준 최대 보유
  maxHoldingBars: 8,

  // 거래 빈도 개선
  minStrength: 52,

  // 한 종목에 계좌의 최대 투자 비율
  maxPositionPct: 0.35,

  // 하루 최대 거래 횟수
  maxTradesPerDay: 12,
};

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function normalizeBar(bar, previousClose = null) {
  const close = safeNumber(
    bar?.close,
    previousClose ?? 0
  );

  const previous =
    previousClose !== null
      ? previousClose
      : close;

  const open = safeNumber(
    bar?.open,
    previous
  );

  const high = safeNumber(
    bar?.high,
    Math.max(open, close)
  );

  const low = safeNumber(
    bar?.low,
    Math.min(open, close)
  );

  const volume = safeNumber(
    bar?.volume,
    0
  );

  return {
    ...bar,

    open,

    high: Math.max(
      high,
      open,
      close
    ),

    low: Math.min(
      low,
      open,
      close
    ),

    close,

    volume,
  };
}

function maxDrawdown(
  equityCurve
) {
  if (
    !equityCurve ||
    !equityCurve.length
  ) {
    return 0;
  }

  let peak =
    safeNumber(
      equityCurve[0]
    );

  let maxDd = 0;

  for (
    const rawValue of
      equityCurve
  ) {
    const value =
      safeNumber(
        rawValue,
        peak
      );

    if (
      value > peak
    ) {
      peak = value;
    }

    if (
      peak > 0
    ) {
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
    !values ||
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
    !values ||
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
    !returns ||
    returns.length < 2
  ) {
    return null;
  }

  const mean =
    average(returns);

  const deviation =
    std(returns);

  if (
    deviation === null ||
    deviation <= 0
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
    !returns ||
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
    safeNumber(price) *
    (1 +
      safeNumber(
        slippageRate
      ))
  );
}

function executeSell(
  price,
  slippageRate
) {
  return (
    safeNumber(price) *
    (1 -
      safeNumber(
        slippageRate
      ))
  );
}

function tradeReturn(
  entryPrice,
  exitPrice,
  feeRate
) {
  if (
    !entryPrice ||
    entryPrice <= 0
  ) {
    return 0;
  }

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
    bar?.date
  ) {
    return String(
      bar.date
    ).slice(
      0,
      10
    );
  }

  if (
    bar?.timestamp
  ) {
    const timestamp =
      Number(
        bar.timestamp
      );

    if (
      Number.isFinite(
        timestamp
      )
    ) {
      return new Date(
        timestamp *
          1000
      )
        .toISOString()
        .slice(
          0,
          10
        );
    }
  }

  return '';
}

function getSignalValue(
  signal,
  key,
  fallback = null
) {
  if (
    !signal ||
    typeof signal !==
      'object'
  ) {
    return fallback;
  }

  return signal[key] ??
    fallback;
}

function getStrength(
  signal
) {
  return safeNumber(
    getSignalValue(
      signal,
      'strength',
      0
    )
  );
}

function isLongSignal(
  signal
) {
  return (
    getSignalValue(
      signal,
      'signal',
      0
    ) === 1
  );
}

function isExitSignal(
  signal
) {
  return (
    getSignalValue(
      signal,
      'signal',
      0
    ) === -1
  );
}

function runQuantBacktest(
  bars,
  dates,
  options = {}
) {
  const cfg = {
    ...DEFAULTS,
    ...(options || {}),
  };

  if (
    !Array.isArray(bars) ||
    bars.length < 120
  ) {
    throw new Error(
      '데이트레이딩 백테스트에는 최소 120개의 장중 봉이 필요합니다.'
    );
  }

  /*
   * OHLCV 정규화.
   */
  const normalizedBars =
    [];

  for (
    let i = 0;
    i < bars.length;
    i++
  ) {
    const previous =
      i > 0
        ? normalizedBars[
            i - 1
          ].close
        : null;

    const normalized =
      normalizeBar(
        bars[i],
        previous
      );

    if (
      normalized.close <= 0
    ) {
      continue;
    }

    normalizedBars.push(
      normalized
    );
  }

  if (
    normalizedBars.length <
    120
  ) {
    throw new Error(
      '유효한 OHLCV 데이터가 부족합니다.'
    );
  }

  bars =
    normalizedBars;

  let cash =
    safeNumber(
      cfg.initialCapital,
      100000
    );

  const startingCapital =
    cash;

  let position =
    null;

  const equityCurve = [];

  const returns = [];

  const trades = [];

  let previousEquity =
    startingCapital;

  let currentDay =
    null;

  let tradesToday = 0;

  /*
   * 동일 신호가 계속 발생할 때
   * 같은 셋업으로 즉시 재진입하는 것을 방지.
   */
  let lastEntrySetup =
    null;

  let lastEntryBar =
    -Infinity;

  for (
    let t = 80;
    t < bars.length;
    t++
  ) {
    const bar =
      bars[t];

    const date =
      dates?.[t] ||
      bar.date ||
      dayKey(bar);

    const today =
      dayKey(bar) ||
      dayKey({
        date,
      });

    /*
     * 날짜가 바뀌면 일일 거래 제한 초기화.
     */
    if (
      today !==
      currentDay
    ) {
      currentDay =
        today;

      tradesToday = 0;

      lastEntrySetup =
        null;

      lastEntryBar =
        -Infinity;
    }

    const history =
      bars.slice(
        0,
        t + 1
      );

    let signal;

    try {
      signal =
        quantSignal(
          history
        );
    } catch (
      error
    ) {
      signal = {
        signal: 0,

        strength: 0,

        setup: null,

        reason:
          'SIGNAL_ERROR',

        indicators: {},
      };
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

    /*
     * ============================
     * 기존 포지션 청산
     * ============================
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
       * Stop 우선.
       *
       * 같은 봉에서 stop/target 모두
       * 발생한 경우 보수적으로 처리.
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
        isExitSignal(
          signal
        )
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
       * 세션 종료 시 overnight 방지.
       */
      const nextBar =
        bars[t + 1];

      const nextDay =
        nextBar
          ? dayKey(nextBar)
          : null;

      if (
        !nextBar ||
        nextDay !== today
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

          quantity:
            position.quantity,

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

        equity =
          cash;
      } else {
        position.holdingBars++;
      }
    }

    /*
     * ============================
     * 신규 진입
     * ============================
     */
    const strength =
      getStrength(
        signal
      );

    const setup =
      getSignalValue(
        signal,
        'setup',
        null
      );

    const canEnter =
      !position &&
      isLongSignal(
        signal
      ) &&
      strength >=
        cfg.minStrength &&
      tradesToday <
        cfg.maxTradesPerDay;

    /*
     * 동일 셋업이 바로 연속 발생하면
     * 한 봉 정도 쉬고 다시 진입.
     */
    const repeatedSetup =
      setup &&
      setup ===
        lastEntrySetup &&
      t -
        lastEntryBar <=
        1;

    if (
      canEnter &&
      !repeatedSetup
    ) {
      const atrValue =
        safeNumber(
          signal
            ?.indicators
            ?.atr,
          0
        );

      if (
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

        if (
          riskPerShare > 0
        ) {
          const riskCapital =
            cash *
            cfg.riskPerTrade;

          let quantity =
            Math.floor(
              riskCapital /
                riskPerShare
            );

          /*
           * 최대 투자 비중.
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

            const entryFee =
              cost *
              cfg.feeRate;

            if (
              cost +
                entryFee <=
              cash
            ) {
              cash -=
                cost +
                entryFee;

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

                setup,

                strength,

                entryBar:
                  t,
              };

              trades.push({
                type: 'BUY',

                date,

                price:
                  entryPrice,

                quantity,

                strength,

                setup,

                reason:
                  getSignalValue(
                    signal,
                    'reason',
                    ''
                  ),
              });

              tradesToday++;

              lastEntrySetup =
                setup;

              lastEntryBar =
                t;

              equity =
                cash +
                quantity *
                  bar.close;
            }
          }
        }
      }
    }

    /*
     * 최종 equity.
     */
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
      previousEquity >
      0
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
   * ============================
   * 마지막 봉 강제 청산
   * ============================
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
        ] ||
        last.date ||
        dayKey(last),

      price:
        actualExit,

      entryPrice:
        position.entryPrice,

      quantity:
        position.quantity,

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
   * ============================
   * Buy & Hold
   * ============================
   */
  const startIndex =
    Math.min(
      80,
      bars.length - 1
    );

  const startPrice =
    safeNumber(
      bars[startIndex]
        .close
    );

  const endPrice =
    safeNumber(
      bars[
        bars.length - 1
      ].close
    );

  const buyHoldReturn =
    startPrice > 0
      ? (
          (endPrice -
            startPrice) /
          startPrice
        ) * 100
      : 0;

  const strategyReturn =
    (
      (cash -
        startingCapital) /
      startingCapital
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
        safeNumber(
          trade.returnPct
        ) > 0
    );

  const losses =
    completedTrades.filter(
      (trade) =>
        safeNumber(
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
        safeNumber(
          trade.returnPct
        ),
      0
    );

  const grossLoss =
    Math.abs(
      losses.reduce(
        (sum, trade) =>
          sum +
          safeNumber(
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

  /*
   * 평균 거래 수익률.
   */
  const tradeReturns =
    completedTrades.map(
      (trade) =>
        safeNumber(
          trade.returnPct
        )
    );

  const averageTradeReturn =
    average(
      tradeReturns
    );

  /*
   * 평균 보유시간.
   */
  const holdingBars =
    completedTrades.map(
      (trade) =>
        safeNumber(
          trade.holdingBars
        )
    );

  const averageHoldingBars =
    average(
      holdingBars
    );

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

    averageTradeReturnPct:
      averageTradeReturn !==
        null
        ? averageTradeReturn.toFixed(
            2
          )
        : 'N/A',

    averageHoldingBars:
      averageHoldingBars !==
        null
        ? averageHoldingBars.toFixed(
            1
          )
        : 'N/A',

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
 *
 * close 데이터만 들어오는 경우
 * 기존처럼 OHLC를 가상 생성한다.
 */
function runBacktest(
  closes,
  dates,
  options = {}
) {
  if (
    !Array.isArray(
      closes
    ) ||
    closes.length < 40
  ) {
    throw new Error(
      '백테스트에 필요한 데이터가 부족합니다'
    );
  }

  const bars =
    closes.map(
      (rawClose, i) => {
        const close =
          safeNumber(
            rawClose,
            0
          );

        const previous =
          i > 0
            ? safeNumber(
                closes[
                  i - 1
                ],
                close
              )
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

          date:
            dates?.[i],
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
    !Array.isArray(
      closes
    ) ||
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
        safeNumber(
          closes[i]
        );

      const future =
        safeNumber(
          closes[
            i + horizon
          ]
        );

      if (
        base > 0 &&
        future > 0
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
        avg !== null
          ? Number(
              avg.toFixed(
                2
              )
            )
          : null,

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
