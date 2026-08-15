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

const {
  evaluateStrategy,
} = require('./strategyEngine');

const {
  FULL_UNIVERSE,
} = require('./universe');

const contextCache =
  new Map();

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

function isKoreanTicker(ticker) {
  const value =
    String(ticker || '')
      .toUpperCase();

  return (
    value.endsWith('.KS') ||
    value.endsWith('.KQ')
  );
}

function sectorTicker(ticker) {
  const normalized =
    String(ticker || '')
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
    ] ||
    'SPY'
  );
}

function normalizeBars(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.bars)) {
    return data.bars;
  }

  return [];
}

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
        symbol =>
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

async function analyzeNews(
  headlines,
  ticker,
  label
) {
  try {
    const claude =
      await scoreWithClaude(
        headlines,
        ticker,
        label
      );

    if (claude) {
      return {
        ...claude,
        headlines,
        source:
          'claude',
      };
    }
  } catch {
    // fallback
  }

  const fallback =
    sentimentScore(
      headlines
    );

  return {
    ...fallback,
    headlines,
    source:
      'rule-based',
  };
}

function legacyClassification(score) {
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

async function buildSignal(
  ticker,
  label
) {
  const normalized =
    String(
      ticker || ''
    )
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

  const tech =
    technicalScore(
      quote.closes
    );

  const news =
    await analyzeNews(
      headlines,
      normalized,
      label
    );

  const dayQuant =
    intraday?.bars
      ? quantSignal(
          intraday.bars
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
    quantSignal(
      quote.bars
    );

  const strategy =
    evaluateStrategy({
      ticker:
        normalized,

      price:
        quote.currentPrice,

      dailyBars:
        quote.bars || [],

      intradayBars:
        intraday?.bars || [],

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

      earnings:
        {},

      quantDay:
        dayQuant,

      quantSwing:
        swingQuant,
    });

  const legacyCombined =
    tech.score * 0.65 +
    news.score * 0.35;

  const legacy =
    legacyClassification(
      legacyCombined
    );

  const upProbability =
    computeUpProbability(
      quote.closes,
      tech.score
    );

  const quantClass =
    quantClassification(
      dayQuant
    );

  let finalColor =
    'hold';

  if (
    strategy.signal === 1
  ) {
    finalColor = 'buy';
  } else if (
    strategy.signal === -1
  ) {
    finalColor = 'sell';
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

  return {
    ticker:
      normalized,

    label:
      label ||
      normalized,

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
              quote.currentPrice -
              quote.previousClose
            ) /
            quote.previousClose *
            100
          ).toFixed(2)
        : null,

    combinedScore:
      Math.round(
        legacyCombined
      ),

    classification:
      legacy.label,

    signalColor:
      finalColor,

    aiLabel:
      finalLabel,

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
        quote.bars?.length ||
        0,

      intradayBars:
        intraday?.bars?.length ||
        0,

      intradayRange:
        intraday?.actualRange ||
        '60d',

      intradayInterval:
        intraday?.actualInterval ||
        '30m',
    },

    universe:
      Array.isArray(
        FULL_UNIVERSE
      )
        ? FULL_UNIVERSE
        : [],
  };
}

module.exports = {
  buildSignal,
  loadMarketContext,
  sectorTicker,
};
