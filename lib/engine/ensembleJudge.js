// lib/engine/ensembleJudge.js

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

const BASE_WEIGHTS = {
  TREND: 1.2,
  MOMENTUM: 1.15,
  VWAP: 1.0,
  BREAKOUT: 1.05,
  MEAN_REVERSION: 0.7,
  VOLUME: 0.95,
  VOLATILITY: 0.75,
  PRICE_ACTION: 0.85,

  MARKET_REGIME: 1.35,
  SECTOR: 1.0,
  NEWS: 1.1,
  EARNINGS: 1.1,
  EVENT: 1.3,

  RISK: 1.6,
};

function judgeAgents(
  agents = [],
  context = {}
) {
  if (!Array.isArray(agents) || !agents.length) {
    return {
      signal: 0,
      score: 0,
      confidence: 0,
      agreement: 0,
      bullish: 0,
      bearish: 0,
      neutral: 0,
      conflict: true,
      blocked: true,
      reason: 'Agent 데이터 부족',
      contributions: {},
      vetoes: [],
    };
  }

  const regime =
    String(
      context.regime || 'SIDEWAYS'
    ).toUpperCase();

  const weights = {
    ...BASE_WEIGHTS,
  };

  /*
   * Regime adaptive weighting.
   */
  if (
    regime.includes('BULL')
  ) {
    weights.TREND *= 1.3;
    weights.MOMENTUM *= 1.25;
    weights.BREAKOUT *= 1.2;
    weights.MEAN_REVERSION *= 0.5;
  }

  if (
    regime.includes('BEAR')
  ) {
    weights.TREND *= 1.35;
    weights.MOMENTUM *= 1.25;
    weights.BREAKOUT *= 0.8;
  }

  if (
    regime === 'SIDEWAYS'
  ) {
    weights.MEAN_REVERSION *= 1.35;
    weights.VWAP *= 1.15;
    weights.TREND *= 0.8;
    weights.BREAKOUT *= 0.75;
  }

  if (
    regime.includes('COMPRESS')
  ) {
    weights.BREAKOUT *= 1.4;
    weights.VOLUME *= 1.2;
  }

  if (
    regime.includes('HIGH_VOL')
  ) {
    weights.RISK *= 1.35;
    weights.VWAP *= 0.9;
  }

  let weightedScore = 0;
  let totalWeight = 0;

  const contributions = {};

  const directional = agents.filter(
    agent =>
      agent.name !== 'RISK' &&
      agent.name !== 'EVENT'
  );

  const bullish = directional.filter(
    agent =>
      Number(agent.score) >= 20 &&
      confidence(agent.confidence) >= 0.35
  ).length;

  const bearish = directional.filter(
    agent =>
      Number(agent.score) <= -20 &&
      confidence(agent.confidence) >= 0.35
  ).length;

  const neutral =
    directional.length -
    bullish -
    bearish;

  for (const agent of agents) {
    const score = clamp(agent.score);
    const c = confidence(agent.confidence);

    const baseWeight =
      weights[agent.name] ??
      0.75;

    const effectiveWeight =
      baseWeight *
      (0.25 + c * 0.75);

    const contribution =
      score *
      effectiveWeight;

    weightedScore += contribution;
    totalWeight += effectiveWeight;

    contributions[agent.name] = {
      score,
      confidence: Number(c.toFixed(3)),
      weight: Number(
        effectiveWeight.toFixed(3)
      ),
      contribution: Number(
        contribution.toFixed(3)
      ),
    };
  }

  let score =
    totalWeight
      ? weightedScore / totalWeight
      : 0;

  /*
   * Strong consensus.
   */
  const total =
    Math.max(
      1,
      directional.length
    );

  const strongest =
    Math.max(
      bullish,
      bearish
    );

  const agreement =
    strongest / total;

  const conflict =
    bullish >= 3 &&
    bearish >= 3;

  /*
   * Information coverage.
   */
  const usable =
    agents.filter(
      agent =>
        confidence(agent.confidence) >= 0.5
    ).length;

  const coverage =
    agents.length
      ? usable / agents.length
      : 0;

  /*
   * Confidence.
   */
  let finalConfidence =
    Math.abs(score) / 100;

  finalConfidence *=
    0.45 +
    agreement * 0.35 +
    coverage * 0.2;

  if (conflict) {
    finalConfidence *= 0.6;
  }

  /*
   * Veto.
   */
  const event =
    agents.find(
      a => a.name === 'EVENT'
    );

  const risk =
    agents.find(
      a => a.name === 'RISK'
    );

  const news =
    agents.find(
      a => a.name === 'NEWS'
    );

  const earnings =
    agents.find(
      a => a.name === 'EARNINGS'
    );

  const vetoes = [];

  if (event?.blocked) {
    vetoes.push(
      event.reason ||
      'EVENT veto'
    );
  }

  if (risk?.blocked) {
    vetoes.push(
      ...(risk.evidence?.reasons || [
        'RISK veto',
      ])
    );
  }

  /*
   * Fundamental/context contradiction.
   */
  const severeNegativeContext =
    (
      news?.score <= -60 ||
      earnings?.score <= -60 ||
      event?.score <= -60
    );

  if (
    severeNegativeContext
  ) {
    finalConfidence *= 0.5;
    vetoes.push(
      '중대한 부정적 context'
    );
  }

  finalConfidence =
    Math.max(
      0,
      Math.min(
        1,
        finalConfidence
      )
    );

  /*
   * Signal.
   */
  let signal = 0;
  let reason =
    '다중 Agent 합의 부족';

  const longConsensus =
    score >= 22 &&
    bullish >= 4 &&
    agreement >= 0.42 &&
    finalConfidence >= 0.35;

  const shortConsensus =
    score <= -22 &&
    bearish >= 4 &&
    agreement >= 0.42 &&
    finalConfidence >= 0.35;

  if (vetoes.length) {
    signal = 0;

    reason =
      'Risk / Context veto';
  } else if (longConsensus) {
    signal = 1;

    reason =
      '다중 Agent 상승 합의';
  } else if (shortConsensus) {
    signal = -1;

    reason =
      '다중 Agent 하락 합의';
  }

  /*
   * Exit is more sensitive than entry.
   */
  if (
    signal === 0 &&
    !vetoes.length &&
    (
      score <= -35 ||
      (
        bearish >= 5 &&
        agreement >= 0.55
      )
    )
  ) {
    signal = -1;

    reason =
      '하락 전환 / 기존 포지션 보호';
  }

  return {
    signal,

    score:
      Number(
        clamp(score).toFixed(2)
      ),

    confidence:
      Number(
        finalConfidence.toFixed(3)
      ),

    agreement:
      Number(
        agreement.toFixed(3)
      ),

    coverage:
      Number(
        coverage.toFixed(3)
      ),

    bullish,
    bearish,
    neutral,

    conflict,

    blocked:
      vetoes.length > 0,

    reason,

    vetoes,

    contributions,
  };
}

module.exports = {
  judgeAgents,
};
