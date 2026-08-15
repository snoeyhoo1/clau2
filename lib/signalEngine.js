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
  getSimpleQuote,
} = require('./dataSources');

const {
  evaluateStrategy,
} = require('./strategyEngine');

const {
  FULL_UNIVERSE,
} = require('./universe');

/*
 * ============================================================
 * CACHE
 * ============================================================
 *
 * 시장/섹터 데이터는 모든 종목마다
 * 다시 요청하면 API 호출량이 폭발한다.
 *
 * 2분 캐시.
 */

const contextCache = new Map();

const CONTEXT_TTL =
  2 * 60 * 1000;

const SECTOR_MAP = {
  AAPL: 'XLK',
  MSFT: 'XLK',
  NVDA: 'XLK',
  AVGO: 'XLK',
  AMD: 'XLK',
  PLTR: 'XLK',

  GOOGL: 'XLC',
  META: 'XLC',
  NFLX: 'XLC',

  AMZN: 'XLY',
  TSLA: 'XLY',

  JPM: 'XLF',
  V: 'XLF',

  JNJ: 'XLV',

  WMT: 'XLP',
};

function isKoreanTicker(
  ticker
) {
  return (
    String(ticker || '')
      .toUpperCase()
      .endsWith('.KS') ||
    String(ticker || '')
      .toUpperCase()
      .endsWith('.KQ')
  );
}

function sectorTicker(
  ticker
) {
  const normalized =
    String(
      ticker || ''
    ).toUpperCase();

  if (
    isKoreanTicker(
      normalized
    )
  ) {
    return 'EWY';
  }

  return (
    SECTOR_MAP[
      normalized
    ] || 'SPY'
  );
}

/*
 * ============================================================
 * CONTEXT
 * ============================================================
 */

async function loadMarketContext(
  ticker
) {
  const korean =
    isKoreanTicker(
      ticker
    );

  const marketTickers =
    korean
      ? [
          '^KS11',
          '^KQ11',
          'EWY',
          '^VIX',
          '^TNX',
        ]
      : [
          'SPY',
          'QQQ',
          'IWM',
          '^GSPC',
          '^VIX',
          '^TNX',
        ];

  const sector =
    sectorTicker(
      ticker
    );

  const all =
    [
      ...marketTickers,
      sector,
    ].filter(
      (
        value,
        index,
        array
      ) =>
        array.indexOf(
          value
        ) === index
    );

  const cacheKey =
    all.join('|');

  const cached =
    contextCache.get(
      cacheKey
    );

  if (
    cached &&
    Date.now() -
      cached.time <
      CONTEXT_TTL
  ) {
    return cached.value;
  }

  const results =
    await Promise.allSettled(
      all.map(
        (symbol) =>
          getQuoteAndHistory(
            symbol,
            '3mo',
            '1d'
          )
      )
    );

  const data = {};

  all.forEach(
    (
      symbol,
      index
    ) => {
      const result =
        results[index];

      if (
        result.status ===
        'fulfilled'
      ) {
        data[
          symbol
        ] =
          result.value;
      }
    }
  );

  const context =
    korean
      ? {
          spy:
            data.EWY ||
            {},

          qqq:
            {},

          iwm:
            {},

          index:
            data[
              '^KS11'
            ] || {},

          qqqIndex:
            data[
              '^KQ11'
            ] || {},

          vix:
            data[
              '^VIX'
            ] || {},

          rates:
            data[
              '^TNX'
            ] || {},

          sector:
            data[
              sector
            ] || {},

          bars: data,
        }
      : {
          spy:
            data.SPY ||
            {},

          qqq:
            data.QQQ ||
            {},

          iwm:
            data.IWM ||
            {},

          index:
            data[
              '^GSPC'
            ] || {},

          vix:
            data[
              '^VIX'
            ] || {},

          rates:
            data[
              '^TNX'
            ] || {},

          sector:
            data[
              sector
            ] || {},

          bars: data,
        };

  contextCache.set(
    cacheKey,
    {
      time: Date.now(),
      value: context,
    }
  );

  return context;
}

/*
 * ============================================================
 * NEWS
 * ============================================================
 */

async function analyzeNews(
  headlines,
  ticker,
  label
) {
  let claude =
    null;

  try {
    claude =
      await scoreWithClaude(
        headlines,
        ticker,
        label
      );
  } catch {
    claude = null;
  }

  return (
    claude ||
    sentimentScore(
      headlines
    )
  );
}

/*
 * ============================================================
 * CLASSIFICATION
 * ============================================================
 */

function legacyClassification(
  score
) {
  if (
    score >= 40
  ) {
    return {
      label: '매수 우세',
      color: 'buy',
    };
  }

  if (
    score <= -40
  ) {
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
      label: '퀀트 강한 매수',
      color: 'buy',
    };
  }

  if (
    quant.signal === 1
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

/*
 * ============================================================
 * BUILD SIGNAL
 * ============================================================
 */

async function buildSignal(
  ticker,
  label
) {
  const normalizedTicker =
    String(
      ticker || ''
    )
      .trim()
      .toUpperCase();

  if (
    !normalizedTicker
  ) {
    throw new Error(
      '티커가 필요합니다.'
    );
  }

  /*
   * 기본 데이터.
   */
  const [
    quoteResult,
    intradayResult,
    headlinesResult,
    contextResult,
  ] =
    await Promise.allSettled([
      getQuoteAndHistory(
        normalizedTicker,
        '3y',
        '1d'
      ),

      getIntradayHistory(
        normalizedTicker,
        '60d',
        '30m'
      ),

      getHeadlines(
        normalizedTicker,
        15,
        label
      ),

      loadMarketContext(
        normalizedTicker
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

  const context =
    contextResult.status ===
    'fulfilled'
      ? contextResult.value
      : {
          spy: {},
          qqq: {},
          iwm: {},
          index: {},
          vix: {},
          rates: {},
          sector: {},
          bars: {},
        };

  /*
   * ==========================================================
   * LEGACY TECH
   * ==========================================================
   *
   * 기존 UI를 절대 깨지 않기 위해 유지.
   */
  const tech =
    technicalScore(
      quote.closes
    );

  /*
   * ==========================================================
   * NEWS
   * ==========================================================
   */
  const news =
    await analyzeNews(
      headlines,
      normalizedTicker,
      label
    );

  /*
   * ==========================================================
   * DAY QUANT
   * ==========================================================
   */
  const dayQuant =
    intraday &&
    intraday.bars
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

  /*
   * ==========================================================
   * SWING QUANT
   * ==========================================================
   *
   * 같은 Multi-Agent 엔진을
   * 일봉 데이터에 적용한다.
   */
  const swingQuant =
    quantSignal(
      quote.bars
    );

  /*
   * ==========================================================
   * STRATEGY
   * ==========================================================
   */
  const strategy =
    evaluateStrategy({
      ticker:
        normalizedTicker,

      price:
        quote.currentPrice,

      dailyBars:
        quote.bars || [],

      intradayBars:
        intraday?.bars || [],

      quantDay:
        dayQuant,

      quantSwing:
        swingQuant,

      news,

      market: context,

      sector: {
        ticker:
          sectorTicker(
            normalizedTicker
          ),

        bars:
          context.sector
            ?.bars || [],
      },
    });

  /*
   * ==========================================================
   * LEGACY SCORE
   * ==========================================================
   *
   * 기존 UI에서 사용하는
   * combinedScore도 유지한다.
   */
  const legacyCombined =
    tech.score *
      0.65 +
    news.score *
      0.35;

  const legacy =
    legacyClassification(
      legacyCombined
    );

  /*
   * ==========================================================
   * UP PROBABILITY
   * ==========================================================
   */
  const upProbability =
    computeUpProbability(
      quote.closes,
      tech.score
    );

  const quantClass =
    quantClassification(
      dayQuant
    );

  /*
   * ==========================================================
   * FINAL UI CLASSIFICATION
   * ==========================================================
   */
  let finalColor =
    'hold';

  if (
    strategy.signal === 1
  ) {
    finalColor =
      'buy';
  } else if (
    strategy.signal === -1
  ) {
    finalColor =
      'sell';
  }

  let finalLabel =
    'AI 대기';

  if (
    strategy.decision ===
    'BUY'
  ) {
    finalLabel =
      'AI 매수';
  } else if (
    strategy.decision ===
    'DAY_BUY'
  ) {
    finalLabel =
      'AI 단기 매수';
  } else if (
    strategy.decision ===
    'SWING_WAIT'
  ) {
    finalLabel =
      'AI 스윙 관심';
  } else if (
    strategy.decision ===
    'EXIT'
  ) {
    finalLabel =
      'AI 청산';
  } else if (
    strategy.decision ===
    'NO_TRADE'
  ) {
    finalLabel =
      'AI 거래 금지';
  }

  /*
   * ==========================================================
   * RETURN
   * ==========================================================
   *
   * 기존 UI 필드를 유지하면서
   * 새 AI 엔진을 추가한다.
   */
  return {
    ticker:
      normalizedTicker,

    label:
      label ||
      normalizedTicker,

    currentPrice:
      quote.currentPrice,

    previousClose:
      quote.previousClose,

    currency:
      quote.currency,

    exchange:
      quote.exchange,

    changePct:
      quote.previousClose
        ? (
            (
              (
                quote.currentPrice -
                quote.previousClose
              ) /
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
        legacyCombined
      ),

    classification:
      legacy.label,

    signalColor:
      legacy.color,

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
     * 기존 quant UI.
     */
    quant: {
      signal:
        dayQuant.signal,

      strength:
        dayQuant.strength,

      confidence:
        dayQuant.confidence,

      setup:
        dayQuant.setup,

      classification:
        quantClass.label,

      color:
        quantClass.color,

      reason:
        dayQuant.reason,

      indicators:
        dayQuant.indicators,

      timeframe:
        '30m',

      lookback:
        '60d',
    },

    /*
     * ========================================================
     * NEW AI STRATEGY
     * ========================================================
     */
    aiStrategy: {
      signal:
        strategy.signal,

      decision:
        strategy.decision,

      mode:
        strategy.mode,

      confidence:
        strategy.confidence,

      regime:
        strategy.regime,

      reason:
        strategy.reason,

      day:
        strategy.day,

      swing:
        strategy.swing,

      context:
        strategy.context,

      risk:
        strategy.risk,

      execution:
        strategy.execution,
    },

    /*
     * DAY 전용.
     */
    dayTrading: {
      signal:
        strategy.day.decision ===
        'BUY'
          ? 1
          : strategy.day.decision ===
              'EXIT'
            ? -1
            : 0,

      score:
        strategy.day.score,

      confidence:
        strategy.day.confidence,

      decision:
        strategy.day.decision,

      reason:
        strategy.reason,

      risk:
        strategy.risk.day,
    },

    /*
     * SWING 전용.
     */
    swingTrading: {
      signal:
        strategy.swing.decision ===
        'BUY'
          ? 1
          : strategy.swing.decision ===
              'EXIT'
            ? -1
            : 0,

      score:
        strategy.swing.score,

      confidence:
        strategy.swing.confidence,

      decision:
        strategy.swing.decision,

      risk:
        strategy.risk.swing,
    },

    /*
     * 실행 정보.
     */
    execution:
      strategy.execution,

    /*
     * 기존 상승확률.
     */
    upProbability,

    updatedAt:
      new Date().toISOString(),

    disclaimer:
      '이 신호는 참고용 분석 결과이며 투자 조언이 아닙니다. 실제 거래 전 수수료, 슬리피지, 유동성 및 시장 상황을 반드시 고려해야 합니다.',
  };
}

/*
 * ============================================================
 * BUILD MULTIPLE
 * ============================================================
 */

async function buildSignals(
  watchlist
) {
  const results =
    await Promise.allSettled(
      watchlist.map(
        (item) =>
          buildSignal(
            item.ticker,
            item.label
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

/*
 * ============================================================
 * UNIVERSE SCAN
 * ============================================================
 */

async function scanUniverse(
  universe
) {
  const signals =
    await buildSignals(
      universe
    );

  const valid =
    signals.filter(
      (item) =>
        !item.error
    );

  /*
   * 기존 순위.
   */
  const ranked =
    [...valid].sort(
      (a, b) =>
        b.combinedScore -
        a.combinedScore
    );

  /*
   * 새 AI 순위.
   */
  const aiRanked =
    [...valid].sort(
      (a, b) =>
        (
          b.aiStrategy
            ?.confidence || 0
        ) -
        (
          a.aiStrategy
            ?.confidence || 0
        )
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

  const aiBuyCount =
    valid.filter(
      (s) =>
        s.aiStrategy
          ?.signal === 1
    ).length;

  const aiExitCount =
    valid.filter(
      (s) =>
        s.aiStrategy
          ?.signal === -1
    ).length;

  const dayBuyCount =
    valid.filter(
      (s) =>
        s.dayTrading
          ?.signal === 1
    ).length;

  const swingBuyCount =
    valid.filter(
      (s) =>
        s.swingTrading
          ?.signal === 1
    ).length;

  const total =
    valid.length;

  return {
    ranked,

    aiRanked,

    errors:
      signals.filter(
        (s) => s.error
      ),

    breadth: {
      buyPct:
        total
          ? Math.round(
              (
                buyCount /
                total
              ) * 100
            )
          : null,

      buyCount,

      sellCount,

      holdCount:
        total -
        buyCount -
        sellCount,

      total,
    },

    aiSummary: {
      buyCount:
        aiBuyCount,

      exitCount:
        aiExitCount,

      dayBuyCount,

      swingBuyCount,

      total,
    },
  };
}

module.exports = {
  buildSignal,
  buildSignals,
  scanUniverse,
};
