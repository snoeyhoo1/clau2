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
} = require('../agents/contextAgents');

const {
  riskAgent,
} = require('../agents/riskAgent');

const {
  judgeAgents,
} = require('./ensembleJudge');

function detectRegime(
  technicalAgents,
  market
) {
  const trend =
    technicalAgents.find(
      a => a.name === 'TREND'
    );

  const volatility =
    technicalAgents.find(
      a => a.name === 'VOLATILITY'
    );

  const marketRegime =
    market?.regime;

  if (
    marketRegime
  ) {
    return marketRegime;
  }

  if (
    volatility?.evidence?.regime ===
    'HIGH_VOL'
  ) {
    return 'HIGH_VOL';
  }

  if (
    volatility?.evidence?.regime ===
    'SQUEEZE'
  ) {
    return 'COMPRESSION';
  }

  if (
    trend?.score >= 45
  ) {
    return 'BULL';
  }

  if (
    trend?.score <= -45
  ) {
    return 'BEAR';
  }

  return 'SIDEWAYS';
}

function runAgentEngine({
  bars,
  market = {},
  news = [],
  earnings = {},
  account = {},
  position = {},
} = {}) {
  if (
    !Array.isArray(bars) ||
    bars.length < 100
  ) {
    return {
      signal: 0,
      score: 0,
      confidence: 0,
      setup: 'NONE',
      reason: '데이터 부족',
      agents: {},
    };
  }

  const technical = [
    trendAgent(bars),
    momentumAgent(bars),
    vwapAgent(bars),
    breakoutAgent(bars),
    meanReversionAgent(bars),
    volumeAgent(bars),
    volatilityAgent(bars),
    priceActionAgent(bars),
  ];

  const context = [
    marketRegimeAgent(market),
    sectorAgent(market),
    newsAgent(news),
    earningsAgent(earnings),
  ];

  const allBeforeRisk = [
    ...technical,
    ...context,
  ];

  const regime =
    detectRegime(
      technical,
      market
    );

  /*
   * Risk는 최종 방향이 아니라
   * 전체 상황을 보고 판단한다.
   */
  const preliminary =
    allBeforeRisk.reduce(
      (sum, a) =>
        sum +
        a.score *
          a.confidence,
      0
    );

  const preliminarySignal =
    preliminary > 0
      ? 1
      : preliminary < 0
        ? -1
        : 0;

  const risk =
    riskAgent({
      bars,
      signal:
        preliminarySignal,
      account,
      position,
    });

  const agents = [
    ...allBeforeRisk,
    risk,
  ];

  const decision =
    judgeAgents(
      agents,
      {
        regime,
      }
    );

  /*
   * Setup 자동 분류.
   */
  const get =
    name =>
      agents.find(
        a => a.name === name
      );

  let setup = 'NONE';

  if (
    get('BREAKOUT')?.score >= 50 &&
    get('MOMENTUM')?.score >= 25
  ) {
    setup =
      'BREAKOUT_MOMENTUM';
  } else if (
    get('TREND')?.score >= 45 &&
    get('MOMENTUM')?.score >= 25 &&
    get('VWAP')?.score >= 20
  ) {
    setup =
      'TREND_MOMENTUM';
  } else if (
    get('MEAN_REVERSION')?.score >= 40 &&
    regime === 'SIDEWAYS'
  ) {
    setup =
      'MEAN_REVERSION';
  } else if (
    get('VWAP')?.score >= 30
  ) {
    setup =
      'VWAP_PULLBACK';
  }

  const agentMap = {};

  for (const a of agents) {
    agentMap[a.name] = a;
  }

  return {
    signal:
      decision.signal,

    score:
      decision.score,

    strength:
      Number(
        (
          50 +
          decision.score * 0.5
        ).toFixed(1)
      ),

    confidence:
      decision.confidence,

    agreement:
      decision.agreement,

    setup,

    regime,

    reason:
      `${decision.reason}${setup !== 'NONE' ? `: ${setup}` : ''}`,

    agents:
      agentMap,

    ensemble: {
      bullishAgents:
        decision.bullish,

      bearishAgents:
        decision.bearish,

      conflict:
        decision.conflict,

      contributions:
        decision.contributions,
    },

    meta: {
      agentCount:
        agents.length,

      informationCoverage:
        agents.filter(
          a =>
            a.confidence >=
            0.5
        ).length /
        agents.length,

      riskBlocked:
        risk.blocked,

      generatedAt:
        new Date().toISOString(),
    },
  };
}

module.exports = {
  runAgentEngine,
};
