// lib/engine/ensembleJudge.js

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

  return n > 1
    ? Math.max(
        0,
        Math.min(1, n / 100)
      )
    : Math.max(
        0,
        Math.min(1, n)
      );
}

function round(
  value,
  digits = 3
) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  const factor =
    10 ** digits;

  return (
    Math.round(n * factor) /
    factor
  );
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

function normalizeRegime(
  regime
) {
  const value = String(
    regime || 'SIDEWAYS'
  )
    .trim()
    .toUpperCase();

  if (!value) {
    return 'SIDEWAYS';
  }

  return value;
}

function getRegimeFit(
  regime,
  score
) {
  const normalized =
    normalizeRegime(regime);

  const value = Number(score);

  if (!Number.isFinite(value)) {
    return {
      label: 'NEUTRAL',
      score: 0,
      reason:
        '시장 국면과 방향성 데이터 부족',
    };
  }

  if (
    normalized.includes('BULL')
  ) {
    if (value >= 20) {
      return {
        label: 'FAVORABLE',
        score: 85,
        reason:
          '상승 국면과 종목 방향성이 일치',
      };
    }

    if (value <= -20) {
      return {
        label: 'UNFAVORABLE',
        score: 25,
        reason:
          '상승 국면에서 종목 방향성이 약함',
      };
    }

    return {
      label: 'NEUTRAL',
      score: 55,
      reason:
        '상승 국면이지만 방향성 확신 부족',
    };
  }

  if (
    normalized.includes('BEAR')
  ) {
    if (value <= -20) {
      return {
        label: 'FAVORABLE',
        score: 80,
        reason:
          '하락 국면과 종목 방향성이 일치',
      };
    }

    if (value >= 20) {
      return {
        label: 'UNFAVORABLE',
        score: 20,
        reason:
          '하락 국면에서 역추세 위험',
      };
    }

    return {
      label: 'NEUTRAL',
      score: 45,
      reason:
        '하락 국면에서 방향성 확신 부족',
    };
  }

  if (
    normalized.includes('COMPRESS')
  ) {
    return {
      label:
        value > 20
          ? 'BREAKOUT_WATCH'
          : 'NEUTRAL',
      score:
        value > 20
          ? 70
          : 50,
      reason:
        '변동성 압축 국면에서는 돌파 확인이 중요',
    };
  }

  if (
    normalized.includes('HIGH_VOL')
  ) {
    return {
      label: 'CAUTION',
      score: 35,
      reason:
        '고변동성 국면으로 진입 및 손절 위험 증가',
    };
  }

  if (
    normalized === 'SIDEWAYS'
  ) {
    return {
      label:
        Math.abs(value) < 25
          ? 'FAVORABLE'
          : 'CAUTION',
      score:
        Math.abs(value) < 25
          ? 65
          : 45,
      reason:
        Math.abs(value) < 25
          ? '횡보장에서 과도한 추격 가능성이 낮음'
          : '횡보장에서 방향성 신호 충돌 가능성',
    };
  }

  return {
    label: 'NEUTRAL',
    score: 50,
    reason:
      '시장 국면에 대한 추가 해석 필요',
  };
}

function getDecision(
  signal,
  score,
  finalConfidence,
  blocked
) {
  if (blocked) {
    return 'BLOCKED';
  }

  if (signal === 1) {
    if (
      score >= 65 &&
      finalConfidence >= 0.7
    ) {
      return 'STRONG_BUY';
    }

    return 'BUY';
  }

  if (signal === -1) {
    if (
      score <= -65 &&
      finalConfidence >= 0.7
    ) {
      return 'STRONG_SELL';
    }

    return 'SELL';
  }

  return 'HOLD';
}

function getStrength(
  score,
  finalConfidence,
  agreement
) {
  const scoreStrength =
    Math.abs(
      Number(score) || 0
    );

  const confidenceStrength =
    confidence(
      finalConfidence
    ) * 100;

  const agreementStrength =
    confidence(
      agreement
    ) * 100;

  const strength =
    scoreStrength * 0.5 +
    confidenceStrength * 0.3 +
    agreementStrength * 0.2;

  return Math.round(
    Math.max(
      0,
      Math.min(100, strength)
    )
  );
}

function buildReason(
  signal,
  score,
  agreement,
  confidenceValue,
  bullish,
  bearish,
  vetoes,
  regimeFit
) {
  if (vetoes.length) {
    return (
      vetoes[0] ||
      'Risk 또는 Context veto'
    );
  }

  if (signal === 1) {
    return (
      `상승 Agent ${bullish}개, ` +
      `하락 Agent ${bearish}개로 ` +
      `상승 방향 합의가 형성됨 ` +
      `(score ${round(score, 1)}, ` +
      `agreement ${round(
        agreement * 100,
        1
      )}%, ` +
      `confidence ${round(
        confidenceValue * 100,
        1
      )}%). ` +
      `${regimeFit.reason}`
    );
  }

  if (signal === -1) {
    return (
      `상승 Agent ${bullish}개, ` +
      `하락 Agent ${bearish}개로 ` +
      `하락 방향성이 우세함 ` +
      `(score ${round(score, 1)}, ` +
      `agreement ${round(
        agreement * 100,
        1
      )}%, ` +
      `confidence ${round(
        confidenceValue * 100,
        1
      )}%). ` +
      `${regimeFit.reason}`
    );
  }

  return (
    `Agent 방향성이 충분히 합의되지 않음 ` +
    `(score ${round(score, 1)}, ` +
    `agreement ${round(
      agreement * 100,
      1
    )}%, ` +
    `confidence ${round(
      confidenceValue * 100,
      1
    )}%).`
  );
}

function judgeAgents(
  agents = [],
  context = {}
) {
  if (
    !Array.isArray(agents) ||
    !agents.length
  ) {
    return {
      signal: 0,
      score: 0,
      confidence: 0,
      agreement: 0,
      coverage: 0,

      strength: 0,
      decision: 'BLOCKED',

      bullish: 0,
      bearish: 0,
      neutral: 0,

      conflict: true,
      blocked: true,

      regime:
        normalizeRegime(
          context.regime
        ),

      regimeFit: {
        label: 'UNKNOWN',
        score: 0,
        reason:
          'Agent 데이터 부족',
      },

      reason:
        'Agent 데이터 부족',

      contributions: {},
      vetoes: [],

      meta: {
        directionalAgents: 0,
        totalAgents: 0,
        usableAgents: 0,
        informationCoverage: 0,
      },
    };
  }

  const regime =
    normalizeRegime(
      context.regime
    );

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

  const directional =
    agents.filter(
      agent =>
        agent.name !== 'RISK' &&
        agent.name !== 'EVENT'
    );

  const bullish =
    directional.filter(
      agent =>
        Number(agent.score) >= 20 &&
        confidence(
          agent.confidence
        ) >= 0.35
    ).length;

  const bearish =
    directional.filter(
      agent =>
        Number(agent.score) <= -20 &&
        confidence(
          agent.confidence
        ) >= 0.35
    ).length;

  const neutral =
    directional.length -
    bullish -
    bearish;

  for (
    const agent of agents
  ) {
    const score =
      clamp(agent.score);

    const c =
      confidence(
        agent.confidence
      );

    const baseWeight =
      weights[agent.name] ??
      0.75;

    const effectiveWeight =
      baseWeight *
      (0.25 + c * 0.75);

    const contribution =
      score *
      effectiveWeight;

    weightedScore +=
      contribution;

    totalWeight +=
      effectiveWeight;

    contributions[
      agent.name
    ] = {
      score,

      confidence:
        Number(
          c.toFixed(3)
        ),

      weight:
        Number(
          effectiveWeight.toFixed(
            3
          )
        ),

      contribution:
        Number(
          contribution.toFixed(
            3
          )
        ),
    };
  }

  let score =
    totalWeight
      ? weightedScore /
        totalWeight
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
        confidence(
          agent.confidence
        ) >= 0.5
    ).length;

  const coverage =
    agents.length
      ? usable /
        agents.length
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
      a =>
        a.name === 'EVENT'
    );

  const risk =
    agents.find(
      a =>
        a.name === 'RISK'
    );

  const news =
    agents.find(
      a =>
        a.name === 'NEWS'
    );

  const earnings =
    agents.find(
      a =>
        a.name === 'EARNINGS'
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
      ...(
        risk.evidence
          ?.reasons || [
          'RISK veto',
        ]
      )
    );
  }

  /*
   * Fundamental/context contradiction.
   */
  const severeNegativeContext =
    news?.score <= -60 ||
    earnings?.score <= -60 ||
    event?.score <= -60;

  if (
    severeNegativeContext
  ) {
    finalConfidence *=
      0.5;

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

  if (
    vetoes.length
  ) {
    signal = 0;

    reason =
      'Risk / Context veto';
  } else if (
    longConsensus
  ) {
    signal = 1;

    reason =
      '다중 Agent 상승 합의';
  } else if (
    shortConsensus
  ) {
    signal = -1;

    reason =
      '다중 Agent 하락 합의';
  }

  /*
   * Exit is more sensitive
   * than entry.
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

  /*
   * New V2 metadata.
   */
  const regimeFit =
    getRegimeFit(
      regime,
      score
    );

  const decision =
    getDecision(
      signal,
      score,
      finalConfidence,
      vetoes.length > 0
    );

  const strength =
    getStrength(
      score,
      finalConfidence,
      agreement
    );

  const detailedReason =
    buildReason(
      signal,
      score,
      agreement,
      finalConfidence,
      bullish,
      bearish,
      vetoes,
      regimeFit
    );

  /*
   * Risk penalty.
   *
   * This does NOT change the
   * existing signal/veto behavior.
   * It is exposed separately so
   * UI and Trade Plan can use it.
   */
  const riskScore =
    Number(
      risk?.score
    );

  const riskConfidence =
    confidence(
      risk?.confidence
    );

  const riskPenalty =
    Number.isFinite(
      riskScore
    )
      ? Math.max(
          0,
          Math.min(
            100,
            Math.abs(
              Math.min(
                0,
                riskScore
              )
            ) *
              (
                0.5 +
                riskConfidence *
                  0.5
              )
          )
        )
      : 0;

  /*
   * Directional balance.
   */
  const directionalTotal =
    Math.max(
      1,
      bullish +
        bearish +
        neutral
    );

  const bullishRatio =
    bullish /
    directionalTotal;

  const bearishRatio =
    bearish /
    directionalTotal;

  const neutralRatio =
    neutral /
    directionalTotal;

  return {
    signal,

    score:
      Number(
        clamp(score).toFixed(
          2
        )
      ),

    confidence:
      Number(
        finalConfidence.toFixed(
          3
        )
      ),

    agreement:
      Number(
        agreement.toFixed(
          3
        )
      ),

    coverage:
      Number(
        coverage.toFixed(
          3
        )
      ),

    strength,

    decision,

    bullish,
    bearish,
    neutral,

    conflict,

    blocked:
      vetoes.length > 0,

    reason,

    detailedReason,

    regime,

    regimeFit: {
      label:
        regimeFit.label,

      score:
        Number(
          regimeFit.score
        ),

      reason:
        regimeFit.reason,
    },

    risk: {
      score:
        Number.isFinite(
          riskScore
        )
          ? clamp(
              riskScore
            )
          : 0,

      confidence:
        Number(
          riskConfidence.toFixed(
            3
          )
        ),

      penalty:
        Number(
          riskPenalty.toFixed(
            2
          )
        ),

      blocked:
        Boolean(
          risk?.blocked
        ),
    },

    directional: {
      bullishRatio:
        Number(
          bullishRatio.toFixed(
            3
          )
        ),

      bearishRatio:
        Number(
          bearishRatio.toFixed(
            3
          )
        ),

      neutralRatio:
        Number(
          neutralRatio.toFixed(
            3
          )
        ),
    },

    meta: {
      directionalAgents:
        directional.length,

      totalAgents:
        agents.length,

      usableAgents:
        usable,

      informationCoverage:
        Number(
          coverage.toFixed(
            3
          )
        ),

      vetoCount:
        vetoes.length,

      conflict,

      regime,
    },

    vetoes,

    contributions,
  };
}

module.exports = {
  judgeAgents,
};
