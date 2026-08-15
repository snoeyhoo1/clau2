// lib/signalEngine.js

const {
  technicalScore,
  quantSignal,
} = require('./indicators');

const {
  sentimentScore,
} = require('./sentiment');

const {
  scoreWithClaude,
} = require('./sentimentClaude');

const {
  computeUpProbability,
} = require('./backtest');

const {
  getQuoteAndHistory,
  getIntradayHistory,
  getHeadlines,
} = require('./dataSources');

const TECH_WEIGHT =
  0.65;

const NEWS_WEIGHT =
  0.35;

function classify(score) {
  if (score >= 40) {
    return {
      label: '매수 우세',
      color: 'buy',
    };
  }

  if (score <= -40) {
    return {
      label: '매도 우세',
      color: 'sell',
    };
  }

  return {
    label: '중립',
    color: 'hold',
  };
}

function quantClassification(
  quant
) {
  if (!quant) {
    return {
      label: '대기',
      color: 'hold',
    };
  }

  if (
    quant.signal === 1 &&
    quant.strength >= 75
  ) {
    return {
      label: '퀀트 매수',
      color: 'buy',
    };
  }

  if (
    quant.signal === 1 &&
    quant.strength >= 58
  ) {
    return {
      label: '퀀트 관심',
      color: 'buy',
    };
  }

  if (
    quant.signal === -1
  ) {
    return {
      label: '퀀트 청산',
      color: 'sell',
    };
  }

  return {
    label: '퀀트 대기',
    color: 'hold',
  };
}

async function buildSignal(
  ticker,
  label
) {
  /*
   * 기존 일봉 데이터.
   * UI와 기존 상승확률을 유지한다.
   */
  const [
    quoteResult,
    intradayResult,
    headlinesResult,
  ] =
    await Promise.allSettled([
      getQuoteAndHistory(
        ticker,
        '3y',
        '1d'
      ),

      getIntradayHistory(
        ticker,
        '60d',
        '30m'
      ),

      getHeadlines(
        ticker,
        10,
        label
      ),
    ]);

  if (
    quoteResult.status !==
    'fulfilled'
  ) {
    throw quoteResult.reason;
  }

  const quote =
    quoteResult.value;

  const intraday =
    intradayResult.status ===
    'fulfilled'
      ? intradayResult.value
      : null;

  const headlines =
    headlinesResult.status ===
    'fulfilled'
      ? headlinesResult.value
      : [];

  /*
   * 기존 기술 분석.
   */
  const tech =
    technicalScore(
      quote.closes
    );

  /*
   * 뉴스 분석.
   */
  let claudeResult = null;

  try {
    claudeResult =
      await scoreWithClaude(
        headlines,
        ticker,
        label
      );
  } catch {
    claudeResult = null;
  }

  const news =
    claudeResult ||
    sentimentScore(
      headlines
    );

  /*
   * 기존 combinedScore 유지.
   */
  const combined =
    tech.score *
      TECH_WEIGHT +
    news.score *
      NEWS_WEIGHT;

  const classification =
    classify(
      combined
    );

  /*
   * 핵심:
   * 장중 30분봉으로 퀀트 전략 실행.
   */
  const quant =
    intraday
      ? quantSignal(
          intraday.bars
        )
      : {
          signal: 0,
          strength: 0,
          setup: 'NONE',
          reason:
            '장중 데이터 없음',
          indicators: {},
        };

  const quantClass =
    quantClassification(
      quant
    );

  /*
   * 기존 상승확률 유지.
   */
  const upProb =
    computeUpProbability(
      quote.closes,
      tech.score
    );

  return {
    ticker,

    label:
      label || ticker,

    currentPrice:
      quote.currentPrice,

    previousClose:
      quote.previousClose,

    currency:
      quote.currency,

    changePct:
      quote.previousClose
        ? (
            (
              (quote.currentPrice -
                quote.previousClose) /
              quote.previousClose
            ) *
            100
          ).toFixed(2)
        : null,

    /*
     * 기존 UI.
     */
    combinedScore:
      Math.round(
        combined
      ),

    classification:
      classification.label,

    signalColor:
      classification.color,

    technical: {
      score:
        Math.round(
          tech.score
        ),

      detail:
        tech.detail,
    },

    news: {
      score:
        Math.round(
          news.score
        ),

      detail:
        news.detail,

      headlines:
        news.headlines ||
        [],

      source:
        news.source,
    },

    /*
     * 새로운 데이트레이딩 퀀트.
     */
    quant: {
      signal:
        quant.signal,

      strength:
        quant.strength,

      setup:
        quant.setup,

      classification:
        quantClass.label,

      color:
        quantClass.color,

      reason:
        quant.reason,

      indicators:
        quant.indicators,

      timeframe:
        '30m',

      lookback:
        '60d',
    },

    upProbability:
      upProb,

    updatedAt:
      new Date().toISOString(),

    disclaimer:
      '이 신호는 참고용 분석 결과이며 투자 조언이 아닙니다. 실제 거래 전 수수료, 슬리피지 및 시장 상황을 반드시 고려해야 합니다.',
  };
}

async function buildSignals(
  watchlist
) {
  const results =
    await Promise.allSettled(
      watchlist.map(
        (w) =>
          buildSignal(
            w.ticker,
            w.label
          )
      )
    );

  return results.map(
    (
      result,
      index
    ) => {
      if (
        result.status ===
        'fulfilled'
      ) {
        return result.value;
      }

      return {
        ticker:
          watchlist[index]
            .ticker,

        label:
          watchlist[index]
            .label,

        error:
          result.reason
            ?.message ||
          '데이터를 가져오지 못했습니다',
      };
    }
  );
}

async function scanUniverse(
  universe
) {
  const signals =
    await buildSignals(
      universe
    );

  const valid =
    signals.filter(
      (s) => !s.error
    );

  /*
   * 기존 UI 순위.
   */
  const sorted =
    [...valid].sort(
      (a, b) =>
        b.combinedScore -
        a.combinedScore
    );

  const buyCount =
    valid.filter(
      (s) =>
        s.signalColor ===
        'buy'
    ).length;

  const sellCount =
    valid.filter(
      (s) =>
        s.signalColor ===
        'sell'
    ).length;

  const breadth =
    valid.length
      ? Math.round(
          (buyCount /
            valid.length) *
            100
        )
      : null;

  /*
   * 퀀트 통계.
   */
  const quantBuyCount =
    valid.filter(
      (s) =>
        s.quant?.signal ===
          1 &&
        s.quant?.strength >=
          58
    ).length;

  const strongQuantBuyCount =
    valid.filter(
      (s) =>
        s.quant?.signal ===
          1 &&
        s.quant?.strength >=
          75
    ).length;

  const quantExitCount =
    valid.filter(
      (s) =>
        s.quant?.signal ===
        -1
    ).length;

  const setupCounts = {
    trendMomentum:
      valid.filter(
        (s) =>
          s.quant?.setup ===
          'TREND_MOMENTUM'
      ).length,

    vwapPullback:
      valid.filter(
        (s) =>
          s.quant?.setup ===
          'VWAP_PULLBACK'
      ).length,

    breakout:
      valid.filter(
        (s) =>
          s.quant?.setup ===
          'BREAKOUT'
      ).length,
  };

  return {
    ranked:
      sorted,

    errors:
      signals.filter(
        (s) => s.error
      ),

    breadth: {
      buyPct:
        breadth,

      buyCount,

      sellCount,

      holdCount:
        valid.length -
        buyCount -
        sellCount,

      total:
        valid.length,
    },

    quantSummary: {
      buyCount:
        quantBuyCount,

      strongBuyCount:
        strongQuantBuyCount,

      exitCount:
        quantExitCount,

      setupCounts,

      total:
        valid.length,
    },
  };
}

module.exports = {
  buildSignal,
  buildSignals,
  scanUniverse,
};
