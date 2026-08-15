// lib/signalEngine.js
//
// Multi-Agent AI Signal Engine
//
// 역할
// 1. 종목 데이터 수집
// 2. 시장 / 섹터 / 뉴스 context 수집
// 3. DAY / SWING 전략 실행
// 4. AI 점수를 기존 UI와 호환되는 형태로 변환
// 5. 전체 유니버스 스캔
//
// 중요:
// - 기존 market overview / breadth / news UI를 깨지 않음
// - combinedScore는 더 이상 legacy technical/news 점수만으로 결정하지 않음
// - 실제 랭킹은 Multi-Agent Strategy 결과를 우선 사용

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

const {
  evaluateStrategy,
} = require('./strategyEngine');

const {
  FULL_UNIVERSE,
} = require('./universe');

const contextCache = new Map();

const CONTEXT_TTL =
  2 * 60 * 1000;

const SIGNAL_CONCURRENCY = 4;

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

function isKoreanTicker(ticker) {
  const value =
    String(ticker || '')
      .trim()
      .toUpperCase();

  return (
    value.endsWith('.KS') ||
    value.endsWith('.KQ')
  );
}

function sectorTicker(ticker) {
  const normalized =
    String(ticker || '')
      .trim()
      .toUpperCase();

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

function normalizeBars(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (
    Array.isArray(
      data?.bars
    )
  ) {
    return data.bars;
  }

  return [];
}

function safeNumber(
  value,
  fallback = 0
) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function round(
  value,
  digits = 2
) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  const factor =
    10 ** digits;

  return (
    Math.round(
      n * factor
    ) / factor
  );
}

/*
 * ============================================================
 * Market Context
 * ============================================================
 */

async function loadMarketContext(
  ticker
) {
  const normalized =
    String(ticker || '')
      .trim()
      .toUpperCase();

  const korean =
    isKoreanTicker(
      normalized
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
      normalized
    );

  const symbols = [
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
    symbols.join('|');

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
      symbols.map(
        symbol =>
          getQuoteAndHistory(
            symbol,
            '3mo',
            '1d'
          )
      )
    );

  const data = {};

  symbols.forEach(
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
        data[symbol] =
          result.value;
      }
    }
  );

  const context =
    korean
      ? {
          spy:
            data.EWY || {},

          qqq: {},
          iwm: {},

          index:
            data['^KS11'] || {},

          qqqIndex:
            data['^KQ11'] || {},

          vix:
            data['^VIX'] || {},

          rates:
            data['^TNX'] || {},

          sector:
            data[sector] || {},

          bars: data,
        }
      : {
          spy:
            data.SPY || {},

          qqq:
            data.QQQ || {},

          iwm:
            data.IWM || {},

          index:
            data['^GSPC'] || {},

          vix:
            data['^VIX'] || {},

          rates:
            data['^TNX'] || {},

          sector:
            data[sector] || {},

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
 * News
 * ============================================================
 */

async function analyzeNews(
  headlines,
  ticker,
  label
) {
  const list =
    Array.isArray(
      headlines
    )
      ? headlines
      : [];

  try {
    const claude =
      await scoreWithClaude(
        list,
        ticker,
        label
      );

    if (claude) {
      return {
        ...claude,
        headlines: list,
        source: 'claude',
      };
    }
  } catch {
    // fallback
  }

  const fallback =
    sentimentScore(
      list
    );

  return {
    ...fallback,
    headlines: list,
    source: 'rule-based',
  };
}

/*
 * ============================================================
 * Legacy compatibility
 * ============================================================
 */

function legacyClassification(
  score
) {
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
      label: '퀀트 대기',
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
 * AI Score
 * ============================================================
 *
 * Strategy engine의 다양한 결과 형식을
 * 하나의 0~100 / -100~100 score로 통일한다.
 */

function extractStrategyScore(
  strategy
) {
  if (!strategy) {
    return 0;
  }

  const candidates = [
    strategy.score,

    strategy.final?.score,

    strategy.ensemble?.score,

    strategy.day?.score,

    strategy.swing?.score,
  ];

  for (
    const value of candidates
  ) {
    const n =
      Number(value);

    if (
      Number.isFinite(n)
    ) {
      return Math.max(
        -100,
        Math.min(
          100,
          n
        )
      );
    }
  }

  if (
    strategy.signal === 1
  ) {
    const confidence =
      Number(
        strategy.confidence
      );

    if (
      Number.isFinite(
        confidence
      )
    ) {
      return Math.max(
        25,
        Math.min(
          100,
          confidence
        )
      );
    }

    return 50;
  }

  if (
    strategy.signal === -1
  ) {
    return -50;
  }

  return 0;
}

function extractStrategyConfidence(
  strategy
) {
  const candidates = [
    strategy?.confidence,
    strategy?.final?.confidence,
    strategy?.ensemble?.confidence,
    strategy?.day?.confidence,
    strategy?.swing?.confidence,
  ];

  for (
    const value of candidates
  ) {
    const n =
      Number(value);

    if (
      Number.isFinite(n)
    ) {
      return Math.max(
        0,
        Math.min(
          100,
          n <= 1
            ? n * 100
            : n
        )
      );
    }
  }

  return 0;
}

function strategyDecisionLabel(
  strategy
) {
  const decision =
    String(
      strategy?.decision ||
      strategy?.final?.decision ||
      ''
    ).toUpperCase();

  if (
    strategy?.signal === -1 ||
    decision === 'EXIT'
  ) {
    return 'AI 청산';
  }

  if (
    decision === 'BUY'
  ) {
    return 'AI 매수';
  }

  if (
    decision === 'DAY_BUY'
  ) {
    return 'AI 단기 매수';
  }

  if (
    decision === 'SWING_BUY'
  ) {
    return 'AI 스윙 매수';
  }

  if (
    decision === 'SWING_WAIT'
  ) {
    return 'AI 스윙 관심';
  }

  if (
    decision === 'NO_TRADE'
  ) {
    return 'AI 거래 금지';
  }

  return 'AI 대기';
}

function strategyColor(
  strategy
) {
  if (
    strategy?.signal === 1
  ) {
    return 'buy';
  }

  if (
    strategy?.signal === -1
  ) {
    return 'sell';
  }

  return 'hold';
}

/*
 * ============================================================
 * Single Symbol
 * ============================================================
 */

async function buildSignal(
  ticker,
  label
) {
  const normalized =
    String(ticker || '')
      .trim()
      .toUpperCase();

  if (!normalized) {
    throw new Error(
      '티커가 필요합니다.'
    );
  }

  const [
    quoteResult,
    intradayResult,
    headlinesResult,
    contextResult,
  ] =
    await Promise.allSettled([
      getQuoteAndHistory(
        normalized,
        '3y',
        '1d'
      ),

      getIntradayHistory(
        normalized,
        '60d',
        '30m'
      ),

      getHeadlines(
        normalized,
        15,
        label
      ),

      loadMarketContext(
        normalized
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

  const market =
    contextResult.status ===
    'fulfilled'
      ? contextResult.value
      : {};

  const dailyBars =
    normalizeBars(
      quote.bars
    );

  const intradayBars =
    normalizeBars(
      intraday?.bars
    );

  const closes =
    dailyBars
      .map(
        b =>
          safeNumber(
            b.close
          )
      )
      .filter(
        Number.isFinite
      );

  const tech =
    technicalScore(
      closes
    );

  const news =
    await analyzeNews(
      headlines,
      normalized,
      label
    );

  const dayQuant =
    intradayBars.length
      ? quantSignal(
          intradayBars
        )
      : {
          signal: 0,
          strength: 0,
          confidence: 0,
          setup: 'NONE',
          reason:
            '장중 데이터 없음',
          indicators: {},
        };

  const swingQuant =
    dailyBars.length
      ? quantSignal(
          dailyBars
        )
      : {
          signal: 0,
          strength: 0,
          confidence: 0,
          setup: 'NONE',
          reason:
            '일봉 데이터 없음',
          indicators: {},
        };

  let strategy;

  try {
    strategy =
      evaluateStrategy({
        ticker:
          normalized,

        price:
          quote.currentPrice,

        dailyBars,

        intradayBars,

        market,

        sector: {
          ticker:
            sectorTicker(
              normalized
            ),

          bars:
            market.sector?.bars ||
            [],
        },

        news:
          Array.isArray(
            news?.headlines
          )
            ? news.headlines
            : headlines,

        earnings: {},

        quantDay:
          dayQuant,

        quantSwing:
          swingQuant,
      });
  } catch (err) {
    strategy = {
      signal: 0,
      decision: 'WAIT',
      confidence: 0,
      score: 0,
      reason:
        `전략 엔진 오류: ${err.message}`,
      mode: 'UNKNOWN',
      regime: 'UNKNOWN',
      day: {},
      swing: {},
      final: {},
      execution: {},
      context: {},
    };
  }

  /*
   * Legacy 점수는 UI 호환용으로 유지.
   */
  const legacyCombined =
    safeNumber(
      tech.score
    ) * 0.65 +
    safeNumber(
      news.score
    ) * 0.35;

  const legacy =
    legacyClassification(
      legacyCombined
    );

  /*
   * 실제 랭킹 점수.
   *
   * 새 Multi-Agent Strategy가 우선.
   */
  const aiScore =
    extractStrategyScore(
      strategy
    );

  const confidence =
    extractStrategyConfidence(
      strategy
    );

  /*
   * AI 판단을 중심으로
   * 최종 combinedScore를 만든다.
   *
   * AI 75%
   * 기존 기술/뉴스 25%
   *
   * AI가 중립인 경우에도 기존 데이터가
   * 과도하게 랭킹을 왜곡하지 않도록
   * 영향도를 제한한다.
   */
  const combinedScore =
    Math.round(
      aiScore * 0.75 +
      Math.max(
        -100,
        Math.min(
          100,
          legacyCombined
        )
      ) * 0.25
    );

  const finalColor =
    strategyColor(
      strategy
    );

  const finalLabel =
    strategyDecisionLabel(
      strategy
    );

  const upProbability =
    computeUpProbability(
      closes,
      tech.score
    );

  const last =
    safeNumber(
      quote.currentPrice,
      closes.at(-1)
    );

  const previous =
    safeNumber(
      quote.previousClose
    );

  return {
    ticker:
      normalized,

    label:
      label ||
      normalized,

    currentPrice:
      last,

    previousClose:
      previous,

    currency:
      quote.currency,

    exchange:
      quote.exchange,

    changePct:
      previous
        ? (
            (
              last -
              previous
            ) /
            previous *
            100
          ).toFixed(2)
        : null,

    /*
     * 기존 UI compatibility
     */
    combinedScore,

    classification:
      legacy.label,

    signalColor:
      finalColor,

    /*
     * 새로운 AI 결과
     */
    aiLabel:
      finalLabel,

    aiScore:
      Math.round(
        aiScore
      ),

    aiConfidence:
      round(
        confidence,
        1
      ),

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
          safeNumber(
            news.score
          )
        ),

      detail:
        news.detail,

      headlines:
        news.headlines ||
        headlines,

      source:
        news.source,
    },

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
        quantClassification(
          dayQuant
        ).label,

      color:
        quantClassification(
          dayQuant
        ).color,

      reason:
        dayQuant.reason,

      indicators:
        dayQuant.indicators,

      timeframe:
        '30m',

      lookback:
        '60d',
    },

    swingQuant: {
      signal:
        swingQuant.signal,

      strength:
        swingQuant.strength,

      confidence:
        swingQuant.confidence,

      setup:
        swingQuant.setup,

      reason:
        swingQuant.reason,

      indicators:
        swingQuant.indicators,
    },

    aiStrategy: {
      signal:
        strategy.signal,

      decision:
        strategy.decision,

      mode:
        strategy.mode,

      score:
        aiScore,

      confidence,

      regime:
        strategy.regime,

      reason:
        strategy.reason,

      day:
        strategy.day,

      swing:
        strategy.swing,

      final:
        strategy.final,

      execution:
        strategy.execution,

      context:
        strategy.context,
    },

    marketContext:
      market,

    upProbability,

    dataInfo: {
      dailyBars:
        dailyBars.length,

      intradayBars:
        intradayBars.length,

      intradayRange:
        intraday?.actualRange ||
        '60d',

      intradayInterval:
        intraday?.actualInterval ||
        '30m',
    },
  };
}

/*
 * ============================================================
 * Universe Scanner
 * ============================================================
 *
 * 이 함수가 기존에 없어서 /api/scan이 깨지고 있었다.
 */

async function scanUniverse(
  universe = FULL_UNIVERSE
) {
  const list =
    Array.isArray(
      universe
    )
      ? universe
      : [];

  const ranked = [];

  const errors = [];

  for (
    let start = 0;
    start < list.length;
    start +=
      SIGNAL_CONCURRENCY
  ) {
    const batch =
      list.slice(
        start,
        start +
          SIGNAL_CONCURRENCY
      );

    const results =
      await Promise.allSettled(
        batch.map(
          item =>
            buildSignal(
              item.ticker,
              item.label
            )
        )
      );

    results.forEach(
      (
        result,
        index
      ) => {
        const item =
          batch[index];

        if (
          result.status ===
          'fulfilled'
        ) {
          ranked.push(
            result.value
          );
        } else {
          errors.push({
            ticker:
              item.ticker,

            label:
              item.label,

            error:
              result.reason
                ?.message ||
              '데이터 조회 실패',
          });
        }
      }
    );
  }

  /*
   * 실제 AI score 우선.
   * combinedScore는 UI compatibility까지 고려한
   * 최종 랭킹 점수.
   */
  ranked.sort(
    (a, b) =>
      safeNumber(
        b.combinedScore
      ) -
      safeNumber(
        a.combinedScore
      )
  );

  const buyCount =
    ranked.filter(
      item =>
        item.combinedScore >= 40 ||
        item.aiScore >= 50
    ).length;

  const sellCount =
    ranked.filter(
      item =>
        item.combinedScore <= -40 ||
        item.aiScore <= -50
    ).length;

  const holdCount =
    Math.max(
      0,
      ranked.length -
        buyCount -
        sellCount
    );

  const total =
    ranked.length;

  const aiBuyCount =
    ranked.filter(
      item =>
        item.aiStrategy
          ?.signal === 1
    ).length;

  const aiExitCount =
    ranked.filter(
      item =>
        item.aiStrategy
          ?.signal === -1
    ).length;

  const highConfidence =
    ranked.filter(
      item =>
        safeNumber(
          item.aiConfidence
        ) >= 65
    ).length;

  const averageScore =
    total
      ? round(
          ranked.reduce(
            (
              sum,
              item
            ) =>
              sum +
              safeNumber(
                item.combinedScore
              ),
            0
          ) / total,
          1
        )
      : 0;

  const averageConfidence =
    total
      ? round(
          ranked.reduce(
            (
              sum,
              item
            ) =>
              sum +
              safeNumber(
                item.aiConfidence
              ),
            0
          ) / total,
          1
        )
      : 0;

  /*
   * Market breadth는 기존 UI에서 사용.
   */
  const breadth = {
    total,

    buyCount,

    holdCount,

    sellCount,

    buyPct:
      total
        ? round(
            buyCount /
              total *
              100,
            1
          )
        : 0,

    holdPct:
      total
        ? round(
            holdCount /
              total *
              100,
            1
          )
        : 0,

    sellPct:
      total
        ? round(
            sellCount /
              total *
              100,
            1
          )
        : 0,

    aiBuyCount,

    aiExitCount,

    highConfidence,

    averageScore,

    averageConfidence,
  };

  return {
    ranked,

    breadth,

    errors,

    meta: {
      universeSize:
        list.length,

      successful:
        ranked.length,

      failed:
        errors.length,

      generatedAt:
        new Date().toISOString(),

      engine:
        'multi-agent-ai-v2',

      ranking:
        'AI strategy 75% + legacy context 25%',
    },
  };
}

module.exports = {
  buildSignal,
  scanUniverse,
  loadMarketContext,
  sectorTicker,
};
