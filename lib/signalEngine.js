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
  getHeadlines,
} = require('./dataSources');

const TECH_WEIGHT = 0.65;
const NEWS_WEIGHT = 0.35;

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
    quant.strength >= 80
  ) {
    return {
      label: '퀀트 매수',
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
   * 기존 3년 데이터 유지.
   */
  const quote =
    await getQuoteAndHistory(
      ticker,
      '3y'
    );

  const headlines =
    await getHeadlines(
      ticker,
      10,
      label
    );

  /*
   * 기존 UI용 기술점수.
   */
  const tech =
    technicalScore(
      quote.closes
    );

  /*
   * 뉴스.
   */
  const claudeResult =
    await scoreWithClaude(
      headlines,
      ticker,
      label
    );

  const news =
    claudeResult ||
    sentimentScore(
      headlines
    );

  /*
   * 기존 종합점수.
   *
   * UI 호환을 위해 유지한다.
   */
  const combined =
    tech.score *
      TECH_WEIGHT +
    news.score *
      NEWS_WEIGHT;

  const classification =
    classify(combined);

  /*
   * 새 퀀트 전략.
   */
  const quant =
    quantSignal(
      quote.bars
    );

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
            ((quote.currentPrice -
              quote.previousClose) /
              quote.previousClose) *
            100
          ).toFixed(2)
        : null,

    /*
     * 기존 화면 호환.
     */
    combinedScore:
      Math.round(combined),

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
        news.headlines || [],
      source:
        news.source,
    },

    /*
     * 새 전략 결과.
     */
    quant: {
      signal:
        quant.signal,

      strength:
        quant.strength,

      classification:
        quantClass.label,

      color:
        quantClass.color,

      reason:
        quant.reason,

      indicators:
        quant.indicators,
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
        w =>
          buildSignal(
            w.ticker,
            w.label
          )
      )
    );

  return results.map(
    (result, index) => {
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
          result.reason?.message ||
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
      s => !s.error
    );

  /*
   * 기존 화면은 combinedScore 기준으로
   * 계속 정렬한다.
   */
  const sorted =
    [...valid].sort(
      (a, b) =>
        b.combinedScore -
        a.combinedScore
    );

  const buyCount =
    valid.filter(
      s =>
        s.signalColor ===
        'buy'
    ).length;

  const sellCount =
    valid.filter(
      s =>
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
   * 새 퀀트 전략 통계.
   */
  const quantBuyCount =
    valid.filter(
      s =>
        s.quant?.signal ===
          1 &&
        s.quant?.strength >=
          70
    ).length;

  const quantExitCount =
    valid.filter(
      s =>
        s.quant?.signal ===
        -1
    ).length;

  return {
    ranked:
      sorted,

    errors:
      signals.filter(
        s => s.error
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

      exitCount:
        quantExitCount,

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
