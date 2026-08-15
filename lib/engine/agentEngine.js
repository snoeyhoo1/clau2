// lib/engine/agentEngine.js

const {
  trendAgent,
  momentumAgent,
  vwapAgent,
  breakoutAgent,
  meanReversionAgent,
  volumeAgent,
  volatilityAgent,
  priceActionAgent,
} = require('../agents/technicalAgents');

const {
  marketRegimeAgent,
  sectorAgent,
  newsAgent,
  earningsAgent,
  eventAgent,
} = require('../agents/contextAgents');

const {
  riskAgent,
} = require('../agents/riskAgent');

const {
  judgeAgents,
} = require('./ensembleJudge');

function clamp(value, min = -100, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function confidence(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) return 0;

  return n > 1
    ? Math.max(0, Math.min(1, n / 100))
    : Math.max(0, Math.min(1, n));
}

function normalizeBars(data) {
  if (Array.isArray(data)) return data;

  if (Array.isArray(data?.bars)) {
    return data.bars;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  if (Array.isArray(data?.closes)) {
    return data.closes.map(
      (close, i) => ({
        open:
          data.closes[i - 1] ??
          close,
        high: close,
        low: close,
        close,
        volume:
          data.volumes?.[i] ?? 0,
        timestamp:
          data.timestamps?.[i],
        date:
          data.dates?.[i],
      })
    );
  }

  return [];
}

function normalizeAsset(asset = {}) {
  const bars = normalizeBars(asset);

  const closes =
    bars.map(
      b => Number(b.close)
    ).filter(
      Number.isFinite
    );

  return {
    ...asset,
    bars,
    closes,
    currentPrice:
      Number.isFinite(
        Number(
          asset.currentPrice ??
          asset.price ??
          closes.at(-1)
        )
      )
        ? Number(
            asset.currentPrice ??
            asset.price ??
            closes.at(-1)
          )
        : null,
  };
}

function normalizeMarketContext(
  market = {}
) {
  return {
    ...market,

    index:
      normalizeAsset(
        market.index
      ),

    spy:
      normalizeAsset(
        market.spy
      ),

    qqq:
      normalizeAsset(
        market.qqq
      ),

    iwm:
      normalizeAsset(
        market.iwm
      ),

    sector:
      normalizeAsset(
        market.sector
      ),

    vix:
      normalizeAsset(
        market.vix
      ),

    rates:
      normalizeAsset(
        market.rates
      ),
  };
}

function resolveRegime(
  marketResult,
  technicalAgents
) {
  const marketRegime =
    String(
      marketResult?.regime ||
      ''
    ).toUpperCase();

  if (
    marketRegime
  ) {
    if (
      marketRegime.includes('BULL')
    ) {
      return 'BULL';
    }

    if (
      marketRegime.includes('BEAR')
    ) {
      return 'BEAR';
    }

    if (
      marketRegime.includes('HIGH_VOL')
    ) {
      return 'HIGH_VOL';
    }

    if (
      marketRegime.includes('COMPRESS')
    ) {
      return 'COMPRESSION';
    }
  }

  const trend =
    technicalAgents.find(
      a => a.name === 'TREND'
    );

  const volatility =
    technicalAgents.find(
      a => a.name === 'VOLATILITY'
    );

  if (
    volatility?.evidence?.regime ===
    'EXTREME_VOL'
  ) {
    return 'HIGH_VOL';
  }

  if (
    volatility?.evidence?.regime ===
    'SQUEEZE'
  ) {
    return 'COMPRESSION';
  }

  if (trend?.score >= 45) {
    return 'BULL';
  }

  if (trend?.score <= -45) {
    return 'BEAR';
  }

  return 'SIDEWAYS';
}

function determineSetup(
  agents,
  regime
) {
  const get = name =>
    agents.find(
      a => a.name === name
    );

  const trend = get('TREND');
  const momentum = get('MOMENTUM');
  const vwap = get('VWAP');
  const breakout = get('BREAKOUT');
  const mean = get('MEAN_REVERSION');
  const volume = get('VOLUME');
  const priceAction = get('PRICE_ACTION');

  if (
    breakout?.score >= 50 &&
    momentum?.score >= 20 &&
    volume?.score >= 20 &&
    priceAction?.score >= 0
  ) {
    return 'BREAKOUT_MOMENTUM';
  }

  if (
    trend?.score >= 45 &&
    momentum?.score >= 25 &&
    vwap?.score >= 15
  ) {
    return 'TREND_MOMENTUM';
  }

  if (
    regime === 'SIDEWAYS' &&
    mean?.score >= 40
  ) {
    return 'MEAN_REVERSION';
  }

  if (
    trend?.score >= 30 &&
    vwap?.score >= 30
  ) {
    return 'VWAP_PULLBACK';
  }

  if (
    trend?.score >= 30 &&
    momentum?.score >= 15
  ) {
    return 'TREND_FOLLOW';
  }

  return 'NONE';
}

function buildAgentMap(agents) {
  const result = {};

  for (const agent of agents) {
    result[agent.name] = agent;
  }

  return result;
}

function runAgentEngine({
  bars = [],
  market = {},
  sector = {},
  news = [],
  earnings = {},
  account = {},
  position = {},
  mode = 'DAY',
  event = {},
} = {}) {
  if (
    !Array.isArray(bars) ||
    bars.length < 100
  ) {
    return {
      signal: 0,
      score: 0,
      confidence: 0,
      strength: 0,
      setup: 'NONE',
      regime: 'UNKNOWN',
      reason: '데이터 부족',
      agents: {},
      ensemble: {},
      meta: {
        mode,
        agentCount: 0,
        informationCoverage: 0,
      },
    };
  }

  const normalizedMarket =
    normalizeMarketContext(
      market
    );

  const technicalAgents = [
    trendAgent(bars),
    momentumAgent(bars),
    vwapAgent(bars),
    breakoutAgent(bars),
    meanReversionAgent(bars),
    volumeAgent(bars),
    volatilityAgent(bars),
    priceActionAgent(bars),
  ];

  const marketResult =
    marketRegimeAgent(
      normalizedMarket
    );

  const sectorResult =
    sectorAgent(
      bars,
      normalizeBars(
        sector?.bars ??
        sector
      ),
      normalizedMarket.index?.bars ||
        []
    );

  const newsResult =
    newsAgent(news);

  const earningsResult =
    earningsAgent(earnings);

  const eventResult =
    eventAgent
      ? eventAgent(
          Array.isArray(event?.articles)
            ? event.articles
            : news
        )
      : {
          name: 'EVENT',
          score: 0,
          confidence: 0.1,
        };

  const regime =
    resolveRegime(
      marketResult,
      technicalAgents
    );

  /*
   * First-pass signal is used only for
   * risk analysis.
   */
  const preliminaryAgents = [
    ...technicalAgents,
    marketResult,
    sectorResult,
    newsResult,
    earningsResult,
    eventResult,
  ];

  let preliminaryScore = 0;
  let preliminaryWeight = 0;

  for (
    const agent of preliminaryAgents
  ) {
    const c =
      confidence(
        agent.confidence
      );

    if (c < 0.1) continue;

    preliminaryScore +=
      Number(agent.score || 0) *
      c;

    preliminaryWeight += c;
  }

  const preliminary =
    preliminaryWeight
      ? preliminaryScore /
        preliminaryWeight
      : 0;

  const preliminarySignal =
    preliminary >= 10
      ? 1
      : preliminary <= -10
        ? -1
        : 0;

  const risk =
    riskAgent({
      bars,
      signal:
        preliminarySignal,
      account,
      position,
      market:
        normalizedMarket,
      regime,
      event,
    });

  const agents = [
    ...preliminaryAgents,
    risk,
  ];

  const decision =
    judgeAgents(
      agents,
      {
        regime,
        mode,
      }
    );

  const setup =
    determineSetup(
      agents,
      regime
    );

  const strength =
    Math.max(
      0,
      Math.min(
        100,
        50 +
          decision.score * 0.5 +
          (
            decision.confidence * 100 -
            50
          ) * 0.25
      )
    );

  const usable =
    agents.filter(
      a =>
        confidence(a.confidence) >= 0.5
    ).length;

  const informationCoverage =
    agents.length
      ? usable / agents.length
      : 0;

  let reason =
    decision.reason;

  if (
    decision.signal === 1
  ) {
    reason =
      `${decision.reason}: ${setup}`;
  }

  return {
    signal:
      decision.signal,

    score:
      decision.score,

    confidence:
      decision.confidence,

    strength:
      Number(
        strength.toFixed(1)
      ),

    setup,

    reason,

    regime,

    agents:
      buildAgentMap(
        agents
      ),

    ensemble: {
      ...decision,
    },

    meta: {
      mode,
      agentCount:
        agents.length,
      informationCoverage:
        Number(
          informationCoverage.toFixed(3)
        ),
      preliminaryScore:
        Number(
          preliminary.toFixed(2)
        ),
    },
  };
}

module.exports = {
  runAgentEngine,
  normalizeMarketContext,
  normalizeBars,
  determineSetup,
};
