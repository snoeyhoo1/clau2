/*
 * lib/engine/agentEngine.js
 *
 * CLAU Multi-Agent Decision Engine
 *
 * 구조
 *
 * Raw Market Data
 *       ↓
 * Technical Agents
 *       ↓
 * Context Agents
 *       ↓
 * Event / Risk Agents
 *       ↓
 * Ensemble Judge
 *       ↓
 * Final Decision
 *
 * 이 파일이 새로운 전략의 중심이다.
 */

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


function clamp(
  value,
  min = -100,
  max = 100
) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.max(
    min,
    Math.min(max, n)
  );
}


function confidence(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(1, n)
  );
}


/*
 * ------------------------------------------------------------
 * Market Context Normalizer
 * ------------------------------------------------------------
 *
 * contextAgents가 요구하는 형태로
 * 실제 market 데이터를 변환한다.
 */

function normalizeMarketContext(
  market = {}
) {
  const index =
    market.index || {};

  const spy =
    market.spy || {};

  const qqq =
    market.qqq || {};

  const iwm =
    market.iwm || {};

  const sector =
    market.sector || {};

  const vix =
    market.vix || {};

  const rates =
    market.rates || {};


  function returnPct(
    bars,
    period
  ) {
    if (
      !Array.isArray(bars) ||
      bars.length <= period
    ) {
      return null;
    }

    const current =
      Number(
        bars.at(-1)?.close
      );

    const previous =
      Number(
        bars[
          bars.length -
            1 -
            period
        ]?.close
      );

    if (
      !Number.isFinite(current) ||
      !Number.isFinite(previous) ||
      previous === 0
    ) {
      return null;
    }

    return (
      (current - previous) /
      previous *
      100
    );
  }


  const indexReturn20 =
    returnPct(
      index.bars ||
      index.closes ||
      [],
      20
    );

  const spyReturn20 =
    returnPct(
      spy.bars ||
      spy.closes ||
      [],
      20
    );

  const sectorReturn20 =
    returnPct(
      sector.bars ||
      sector.closes ||
      [],
      20
    );


  /*
   * breadth가 이미 제공되면 사용.
   * 없으면 시장 ETF들의 방향으로 추정한다.
   */
  let breadth =
    Number(
      market.breadth
    );

  if (
    !Number.isFinite(breadth)
  ) {
    const values = [
      spyReturn20,
      qqqReturn20(
        qqq
      ),
      returnPct(
        iwm.bars ||
        iwm.closes ||
        [],
        20
      ),
    ].filter(
      Number.isFinite
    );

    if (values.length) {
      const positive =
        values.filter(
          v => v > 0
        ).length;

      breadth =
        (
          positive /
          values.length *
          100
        ) -
        50;
    }
  }


  /*
   * VIX.
   */
  const vixValue =
    Number(
      vix.currentPrice
    );


  /*
   * 시장 변동성.
   */
  let volatility =
    Number(
      market.volatility
    );

  if (
    !Number.isFinite(volatility)
  ) {
    volatility =
      Number.isFinite(vixValue)
        ? vixValue
        : null;
  }


  /*
   * 종목 대비 시장.
   */
  const indexTrend =
    Number.isFinite(
      indexReturn20
    )
      ? indexReturn20 * 5
      : 0;


  return {
    ...market,

    indexTrend,

    breadth:
      Number.isFinite(breadth)
        ? breadth
        : 0,

    volatility:
      Number.isFinite(volatility)
        ? volatility
        : 0,

    sectorStrength:
      Number.isFinite(
        sectorReturn20
      )
        ? sectorReturn20 * 5
        : 0,

    spyReturn20,

    sectorReturn20,

    vix:
      vixValue,

    rates,

    normalized: true,
  };
}


/*
 * qqq helper
 */
function qqqReturn20(
  qqq
) {
  const bars =
    qqq?.bars ||
    qqq?.closes ||
    [];

  if (
    !Array.isArray(bars) ||
    bars.length <= 20
  ) {
    return null;
  }

  const current =
    Number(
      bars.at(-1)?.close
    );

  const previous =
    Number(
      bars[
        bars.length - 21
      ]?.close
    );

  if (
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null;
  }

  return (
    (current - previous) /
    previous *
    100
  );
}


/*
 * ------------------------------------------------------------
 * Regime
 * ------------------------------------------------------------
 */

function resolveRegime(
  marketAgent,
  technicalAgents
) {
  if (
    marketAgent?.regime
  ) {
    return marketAgent.regime;
  }

  const trend =
    technicalAgents.find(
      a =>
        a.name ===
        'TREND'
    );

  const volatility =
    technicalAgents.find(
      a =>
        a.name ===
        'VOLATILITY'
    );

  if (
    volatility?.evidence
      ?.regime ===
    'HIGH_VOL'
  ) {
    return 'HIGH_VOL';
  }

  if (
    volatility?.evidence
      ?.regime ===
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


/*
 * ------------------------------------------------------------
 * Setup
 * ------------------------------------------------------------
 */

function determineSetup(
  agents,
  regime
) {
  const get =
    name =>
      agents.find(
        a =>
          a.name ===
          name
      );


  const breakout =
    get('BREAKOUT');

  const momentum =
    get('MOMENTUM');

  const trend =
    get('TREND');

  const vwap =
    get('VWAP');

  const mean =
    get(
      'MEAN_REVERSION'
    );

  const volume =
    get('VOLUME');


  /*
   * 가장 우선순위가 높은
   * 강한 돌파 + 거래량 + 모멘텀.
   */
  if (
    breakout?.score >= 50 &&
    momentum?.score >= 25 &&
    volume?.score >= 20
  ) {
    return 'BREAKOUT_MOMENTUM';
  }


  /*
   * 추세 + 모멘텀 + VWAP.
   */
  if (
    trend?.score >= 45 &&
    momentum?.score >= 25 &&
    vwap?.score >= 20
  ) {
    return 'TREND_MOMENTUM';
  }


  /*
   * 횡보장 평균회귀.
   */
  if (
    regime === 'SIDEWAYS' &&
    mean?.score >= 40
  ) {
    return 'MEAN_REVERSION';
  }


  /*
   * VWAP 눌림.
   */
  if (
    trend?.score >= 30 &&
    vwap?.score >= 30
  ) {
    return 'VWAP_PULLBACK';
  }


  /*
   * 단순 추세.
   */
  if (
    trend?.score >= 30 &&
    momentum?.score >= 15
  ) {
    return 'TREND_FOLLOW';
  }


  return 'NONE';
}


/*
 * ------------------------------------------------------------
 * Main
 * ------------------------------------------------------------
 */

function runAgentEngine({
  bars = [],
  market = {},
  sector = {},
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
      strength: 0,
      setup: 'NONE',
      regime: 'UNKNOWN',
      reason: '데이터 부족',
      agents: {},
      ensemble: {},
      meta: {
        agentCount: 0,
        informationCoverage: 0,
      },
    };
  }


  /*
   * ----------------------------------------------------------
   * Normalize
   * ----------------------------------------------------------
   */

  const normalizedMarket =
    normalizeMarketContext(
      market
    );


  /*
   * ----------------------------------------------------------
   * Technical Agents
   * ----------------------------------------------------------
   */

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


  /*
   * ----------------------------------------------------------
   * Context Agents
   * ----------------------------------------------------------
   */

  const marketResult =
    marketRegimeAgent(
      normalizedMarket
    );


  const sectorResult =
    sectorAgent(
      bars,
      sector.bars ||
      [],
      normalizedMarket
        .index?.bars ||
      []
    );


  const newsResult =
    newsAgent(
      news
    );


  const earningsResult =
    earningsAgent(
      earnings
    );


  const eventResult =
    eventAgent
      ? eventAgent(news)
      : {
          name: 'EVENT',
          score: 0,
          confidence: 0.1,
        };


  /*
   * ----------------------------------------------------------
   * Regime
   * ----------------------------------------------------------
   */

  const regime =
    resolveRegime(
      marketResult,
      technicalAgents
    );


  /*
   * ----------------------------------------------------------
   * Preliminary Direction
   * ----------------------------------------------------------
   */

  const preAgents = [
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
    const agent of preAgents
  ) {
    const c =
      confidence(
        agent.confidence
      );

    /*
     * 정보가 없는 Agent는
     * 사실상 투표에서 제외한다.
     */
    if (c < 0.1) {
      continue;
    }

    preliminaryScore +=
      agent.score * c;

    preliminaryWeight +=
      c;
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


  /*
   * ----------------------------------------------------------
   * Risk Agent
   * ----------------------------------------------------------
   */

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
    });


  /*
   * ----------------------------------------------------------
   * Final Agent List
   * ----------------------------------------------------------
   */

  const agents = [
    ...technicalAgents,
    marketResult,
    sectorResult,
    newsResult,
    earningsResult,
    eventResult,
    risk,
  ];


  /*
   * ----------------------------------------------------------
   * Ensemble Judge
   * ----------------------------------------------------------
   */

  const decision =
    judgeAgents(
      agents,
      {
        regime,
      }
    );


  /*
   * ----------------------------------------------------------
   * Setup
   * ----------------------------------------------------------
   */

  const setup =
    determineSetup(
      agents,
      regime
    );


  /*
   * ----------------------------------------------------------
   * Strength
   * ----------------------------------------------------------
   */

  const score =
    clamp(
      decision.score
    );


  const finalConfidence =
    confidence(
      decision.confidence
    );


  const strength =
    clamp(
      50 +
      score * 0.5 +
      (
        finalConfidence *
        100 -
        50
      ) *
      0.25,
      0,
      100
    );


  /*
   * ----------------------------------------------------------
   * Agent Map
   * ----------------------------------------------------------
   */

  const agentMap = {};

  for (
    const agent of agents
  ) {
    agentMap[
      agent.name
    ] = agent;
  }


  /*
   * ----------------------------------------------------------
   * Information Coverage
   * ----------------------------------------------------------
   */

  const usable =
    agents.filter(
      agent =>
        confidence(
          agent.confidence
        ) >= 0.5
    ).length;


  const informationCoverage =
    agents.length
      ? usable /
        agents.length
      : 0;


  /*
   * ----------------------------------------------------------
   * Reason
   * ----------------------------------------------------------
   */

  let reason =
    decision.reason;


  if (
    decision.blocked
  ) {
    reason =
      decision.reason ||
      'Risk Agent 차단';
  } else if (
    setup !== 'NONE'
  ) {
    reason =
      `${decision.reason}: ${setup}`;
  }


  return {
    signal:
      decision.signal,

    score:

      Number(
        score.toFixed(2)
      ),

    strength:

      Number(
        strength.toFixed(1)
      ),

    confidence:

      Number(
        (
          finalConfidence *
          100
        ).toFixed(1)
      ),

    setup,

    regime,

    reason,

    agents:
      agentMap,

    ensemble: {
      score:
        decision.score,

      confidence:
        Number(
          (
            decision.confidence *
            100
          ).toFixed(1)
        ),

      agreement:
        decision.agreement,

      bullishAgents:
        decision.bullish,

      bearishAgents:
        decision.bearish,

      conflict:
        decision.conflict,

      blocked:
        decision.blocked,

      contributions:
        decision.contributions,
    },

    meta: {
      agentCount:
        agents.length,

      informationCoverage:
        Number(
          (
            informationCoverage *
            100
          ).toFixed(1)
        ),

      riskBlocked:
        Boolean(
          risk.blocked
        ),

      generatedAt:
        new Date().toISOString(),
    },
  };
}


module.exports = {
  runAgentEngine,
  normalizeMarketContext,
  resolveRegime,
  determineSetup,
};
