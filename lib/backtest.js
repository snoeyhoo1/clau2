// lib/backtest.js
// Adaptive Intraday Quant Momentum 백테스트
//
// 실제 체결을 완벽하게 재현하는 시스템이 아니라
// OHLCV 일봉 데이터를 이용한 현실적인 전략 검증용.
//
// 미래 데이터 참조 방지:
// 모든 의사결정은 현재 봉까지의 데이터만 사용한다.

const {
  technicalScore,
  quantSignal,
} = require('./indicators');

const DEFAULTS = {
  initialCapital: 100000,

  feeRate: 0.0005,
  slippageRate: 0.0005,

  riskPerTrade: 0.01,

  atrStop: 1.8,
  atrTarget: 3.2,
  atrTrailing: 2.2,

  maxHoldingBars: 12,

  minStrength: 70,
};

function maxDrawdown(equityCurve) {
  if (!equityCurve.length) return 0;

  let peak = equityCurve[0];
  let maxDd = 0;

  for (const value of equityCurve) {
    if (value > peak) {
      peak = value;
    }

    if (peak > 0) {
      const dd =
        (peak - value) / peak;

      if (dd > maxDd) {
        maxDd = dd;
      }
    }
  }

  return maxDd;
}

function average(values) {
  if (!values.length) return null;

  return (
    values.reduce(
      (a, b) => a + b,
      0
    ) / values.length
  );
}

function std(values) {
  if (values.length < 2) return null;

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

function sharpeRatio(returns) {
  if (returns.length < 2) return null;

  const mean = average(returns);
  const deviation = std(returns);

  if (!deviation) return null;

  /*
   * 일봉 기준 연율화.
   */
  return (
    (mean / deviation) *
    Math.sqrt(252)
  );
}

function sortinoRatio(returns) {
  if (returns.length < 2) return null;

  const mean = average(returns);

  const negative =
    returns.filter(
      value => value < 0
    );

  if (!negative.length) {
    return mean > 0 ? Infinity : 0;
  }

  const downside =
    Math.sqrt(
      negative.reduce(
        (sum, value) =>
          sum + value ** 2,
        0
      ) / negative.length
    );

  if (!downside) return null;

  return (
    (mean / downside) *
    Math.sqrt(252)
  );
}

function executeBuy(price, slippageRate) {
  return (
    price *
    (1 + slippageRate)
  );
}

function executeSell(price, slippageRate) {
  return (
    price *
    (1 - slippageRate)
  );
}

function calculateTradeReturn(
  entryPrice,
  exitPrice,
  feeRate
) {
  const gross =
    (exitPrice - entryPrice) /
    entryPrice;

  const fees =
    feeRate * 2;

  return gross - fees;
}

/*
 * OHLCV 기반 전략 백테스트
 */
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
    bars.length < 220
  ) {
    throw new Error(
      '퀀트 백테스트에는 최소 220개 이상의 OHLCV 데이터가 필요합니다'
    );
  }

  let capital =
    cfg.initialCapital;

  let position = null;

  const equityCurve = [];
  const dailyReturns = [];
  const trades = [];

  let previousEquity =
    capital;

  for (
    let t = 200;
    t < bars.length;
    t++
  ) {
    const history =
      bars.slice(0, t + 1);

    const bar = bars[t];

    const signal =
      quantSignal(history);

    /*
     * 현재 평가 자산.
     */
    let equity = capital;

    if (position) {
      equity =
        position.remainingCapital +
        position.quantity *
          bar.close;
    }

    /*
     * 포지션이 있으면 먼저 청산 여부 판단.
     */
    if (position) {
      const atrValue =
        position.atr;

      const stopPrice =
        position.entryPrice -
        atrValue * cfg.atrStop;

      const targetPrice =
        position.entryPrice +
        atrValue * cfg.atrTarget;

      /*
       * 최고가 갱신.
       */
      if (
        bar.high >
        position.highestPrice
      ) {
        position.highestPrice =
          bar.high;
      }

      const trailingStop =
        position.highestPrice -
        atrValue *
          cfg.atrTrailing;

      let exitPrice = null;
      let exitReason = null;

      /*
       * 보수적으로 같은 봉에서
       * stop과 target이 모두 맞으면
       * stop을 먼저 체결한 것으로 처리.
       */
      if (bar.low <= stopPrice) {
        exitPrice = stopPrice;
        exitReason = 'ATR_STOP';
      } else if (
        bar.high >= targetPrice
      ) {
        exitPrice = targetPrice;
        exitReason = 'ATR_TARGET';
      } else if (
        bar.low <= trailingStop &&
        position.highestPrice >
          position.entryPrice +
            atrValue
      ) {
        exitPrice =
          trailingStop;
        exitReason =
          'TRAILING_STOP';
      } else if (
        signal.signal === -1
      ) {
        exitPrice = bar.close;
        exitReason =
          'TREND_EXIT';
      } else if (
        position.holdingBars >=
        cfg.maxHoldingBars
      ) {
        exitPrice = bar.close;
        exitReason =
          'TIME_EXIT';
      }

      if (exitPrice !== null) {
        const actualExit =
          executeSell(
            exitPrice,
            cfg.slippageRate
          );

        const tradeReturn =
          calculateTradeReturn(
            position.entryPrice,
            actualExit,
            cfg.feeRate
          );

        const proceeds =
          position.quantity *
          actualExit;

        const fee =
          proceeds *
          cfg.feeRate;

        capital =
          position.remainingCapital +
          proceeds -
          fee;

        trades.push({
          type: 'SELL',
          date: dates?.[t],
          price: actualExit,
          entryPrice:
            position.entryPrice,
          returnPct:
            tradeReturn * 100,
          reason: exitReason,
          holdingBars:
            position.holdingBars,
        });

        position = null;
        equity = capital;
      } else {
        position.holdingBars++;
      }
    }

    /*
     * 포지션이 없을 때만 신규 진입.
     */
    if (
      !position &&
      signal.signal === 1 &&
      signal.strength >=
        cfg.minStrength
    ) {
      const entryPrice =
        executeBuy(
          bar.close,
          cfg.slippageRate
        );

      const atrValue =
        signal.indicators.atr;

      if (
        atrValue &&
        atrValue > 0
      ) {
        /*
         * ATR stop까지의 위험을 기준으로
         * 포지션 크기를 결정.
         */
        const riskPerShare =
          atrValue *
          cfg.atrStop;

        const riskCapital =
          capital *
          cfg.riskPerTrade;

        let quantity =
          Math.floor(
            riskCapital /
              riskPerShare
          );

        /*
         * 현금보다 큰 포지션 금지.
         */
        const maxQuantity =
          Math.floor(
            capital /
              (entryPrice *
                (1 + cfg.feeRate))
          );

        quantity =
          Math.min(
            quantity,
            maxQuantity
          );

        if (quantity > 0) {
          const cost =
            quantity *
            entryPrice;

          const fee =
            cost *
            cfg.feeRate;

          capital -=
            cost + fee;

          position = {
            entryPrice,
            quantity,
            remainingCapital:
              capital,
            atr: atrValue,
            highestPrice:
              bar.high,
            holdingBars: 0,
          };

          trades.push({
            type: 'BUY',
            date: dates?.[t],
            price: entryPrice,
            quantity,
            strength:
              signal.strength,
            reason:
              signal.reason,
          });

          /*
           * 포지션 내부의 현금은 0으로 본다.
           */
          position.remainingCapital =
            capital;

          equity =
            capital +
            quantity *
              bar.close;
        }
      }
    }

    /*
     * 마지막 평가값.
     */
    if (position) {
      equity =
        position.remainingCapital +
        position.quantity *
          bar.close;
    } else {
      equity = capital;
    }

    equityCurve.push(equity);

    if (previousEquity > 0) {
      dailyReturns.push(
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
  if (position) {
    const last =
      bars[bars.length - 1];

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

    capital =
      position.remainingCapital +
      proceeds -
      fee;

    const tradeReturn =
      calculateTradeReturn(
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
      price: actualExit,
      entryPrice:
        position.entryPrice,
      returnPct:
        tradeReturn * 100,
      reason:
        'END_OF_DATA',
      holdingBars:
        position.holdingBars,
    });

    position = null;
  }

  /*
   * Buy & Hold.
   */
  const startPrice =
    bars[200].close;

  const endPrice =
    bars[bars.length - 1].close;

  const buyHoldReturn =
    ((endPrice -
      startPrice) /
      startPrice) *
    100;

  const strategyReturn =
    ((capital -
      cfg.initialCapital) /
      cfg.initialCapital) *
    100;

  const completedTrades =
    trades.filter(
      t => t.type === 'SELL'
    );

  const wins =
    completedTrades.filter(
      t =>
        Number(t.returnPct) > 0
    );

  const losses =
    completedTrades.filter(
      t =>
        Number(t.returnPct) < 0
    );

  const winRate =
    completedTrades.length
      ? (wins.length /
          completedTrades.length) *
        100
      : null;

  const grossProfit =
    wins.reduce(
      (sum, t) =>
        sum +
        Number(t.returnPct),
      0
    );

  const grossLoss =
    Math.abs(
      losses.reduce(
        (sum, t) =>
          sum +
          Number(t.returnPct),
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
      dailyReturns
    );

  const sortino =
    sortinoRatio(
      dailyReturns
    );

  return {
    strategyReturnPct:
      strategyReturn.toFixed(2),

    buyHoldReturnPct:
      buyHoldReturn.toFixed(2),

    alphaPct:
      (
        strategyReturn -
        buyHoldReturn
      ).toFixed(2),

    numTrades:
      completedTrades.length,

    winRatePct:
      winRate !== null
        ? winRate.toFixed(1)
        : 'N/A',

    profitFactor:
      profitFactor !== null
        ? profitFactor.toFixed(2)
        : 'N/A',

    sharpe:
      sharpe !== null
        ? Number(
            sharpe.toFixed(2)
          )
        : 'N/A',

    sortino:
      sortino !== null &&
      Number.isFinite(sortino)
        ? Number(
            sortino.toFixed(2)
          )
        : 'N/A',

    maxDrawdownPct:
      mdd.toFixed(2),

    trades:
      trades.slice(-20),

    equityCurve,

    parameters: cfg,

    limitation:
      '일봉 OHLCV 기반 백테스트입니다. 실제 체결가격, 장중 순서, 세금, 거래정지, 호가잔량 등은 완전히 재현되지 않습니다.',
  };
}

/*
 * 기존 API 호환.
 *
 * 예전에는 closes만 받았기 때문에
 * 호출 코드가 남아 있어도 작동하도록 만든다.
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

  /*
   * OHLCV가 없는 구형 호출은
   * 종가 기반의 synthetic bar를 만들어
   * 호환성을 유지한다.
   *
   * 실제 API에서는 runQuantBacktest()를 사용한다.
   */
  const bars = closes.map(
    (close, i) => {
      const previous =
        i > 0
          ? closes[i - 1]
          : close;

      const range =
        Math.max(
          close * 0.01,
          Math.abs(
            close - previous
          ) * 1.5
        );

      return {
        open: previous,
        high:
          Math.max(
            previous,
            close
          ) + range,
        low:
          Math.min(
            previous,
            close
          ) - range,
        close,
        volume: 1000000,
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
  currentScore,
  {
    tolerance = 15,
    forwardDaysList = [
      3,
      5,
      10,
    ],
    lookback = 30,
    minSample = 8,
  } = {}
) {
  const maxForward =
    Math.max(
      ...forwardDaysList
    );

  if (
    closes.length <
    lookback +
      maxForward +
      10
  ) {
    return {
      byHorizon: {},
      note:
        '데이터 부족으로 계산 불가',
    };
  }

  const scoreAtT =
    new Array(
      closes.length
    ).fill(null);

  for (
    let t = lookback;
    t < closes.length;
    t++
  ) {
    scoreAtT[t] =
      technicalScore(
        closes.slice(
          0,
          t + 1
        )
      ).score;
  }

  function computeForHorizon(
    forwardDays,
    tol
  ) {
    let upCount = 0;
    let sampleCount = 0;
    let returnSum = 0;

    for (
      let t = lookback;
      t <
      closes.length -
        forwardDays;
      t++
    ) {
      if (
        Math.abs(
          scoreAtT[t] -
            currentScore
        ) <= tol
      ) {
        sampleCount++;

        const fwdReturn =
          (closes[
            t + forwardDays
          ] -
            closes[t]) /
          closes[t];

        returnSum +=
          fwdReturn;

        if (
          fwdReturn > 0
        ) {
          upCount++;
        }
      }
    }

    return {
      upCount,
      sampleCount,
      avgReturn:
        sampleCount
          ? (returnSum /
              sampleCount) *
            100
          : null,
    };
  }

  const byHorizon = {};

  for (
    const forwardDays of
    forwardDaysList
  ) {
    let tol =
      tolerance;

    let result =
      computeForHorizon(
        forwardDays,
        tol
      );

    let widened = false;

    let attempts = 0;

    while (
      result.sampleCount <
        minSample &&
      attempts < 2
    ) {
      tol *= 1.7;

      result =
        computeForHorizon(
          forwardDays,
          tol
        );

      widened = true;
      attempts++;
    }

    if (
      result.sampleCount === 0
    ) {
      byHorizon[
        forwardDays
      ] = {
        probability: null,
        sampleSize: 0,
        note:
          '유사 신호 사례 없음',
      };

      continue;
    }

    const probability =
      Math.round(
        (result.upCount /
          result.sampleCount) *
          100
      );

    const confidence =
      result.sampleCount >= 20
        ? '표본 충분'
        : result.sampleCount >=
          minSample
        ? '표본 보통'
        : '표본 적음(참고만)';

    byHorizon[
      forwardDays
    ] = {
      probability,
      sampleSize:
        result.sampleCount,
      avgReturnPct:
        result.avgReturn !== null
          ? result.avgReturn.toFixed(
              2
            )
          : null,
      confidence,
      toleranceUsed:
        Math.round(tol),
      widened,
      note:
        `과거 ${result.sampleCount}회 유사 신호 중 ${result.upCount}회 ${forwardDays}거래일 후 상승`,
    };
  }

  return {
    byHorizon,
    primaryHorizon:
      forwardDaysList.includes(
        5
      )
        ? 5
        : forwardDaysList[0],
  };
}

module.exports = {
  runBacktest,
  runQuantBacktest,
  computeUpProbability,
};
