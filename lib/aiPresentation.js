// lib/aiPresentation.js
//
// AI Signal Presentation Layer
//
// 역할
// 1. Multi-Agent 결과를 UI 친화적인 형태로 변환
// 2. AI 종합 판단 생성
// 3. Agent breakdown 생성
// 4. Market Regime / Risk 요약
// 5. Trade Plan 계산
// 6. 이전 Signal과 현재 Signal 비교
//
// 주의
// - 주문을 실행하지 않음
// - 투자 판단을 새로 생성하는 엔진이 아님
// - 기존 signalEngine / strategyEngine 결과를 기반으로 동작
// - 기존 UI와의 호환성을 우선함

'use strict';

/* ============================================================
 * Utilities
 * ============================================================ */

function number(
  value,
  fallback = 0
) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function clamp(
  value,
  min = 0,
  max = 100
) {
  return Math.max(
    min,
    Math.min(
      max,
      number(value)
    )
  );
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

function normalizeConfidence(
  value
) {
  const n = number(value);

  if (n <= 1) {
    return clamp(
      n * 100
    );
  }

  return clamp(n);
}

function normalizeScore(
  value
) {
  return Math.max(
    -100,
    Math.min(
      100,
      number(value)
    )
  );
}

function normalizeSignal(
  value
) {
  if (
    value === 1 ||
    String(value)
      .toUpperCase()
      .includes('BUY')
  ) {
    return 1;
  }

  if (
    value === -1 ||
    String(value)
      .toUpperCase()
      .includes('SELL') ||
    String(value)
      .toUpperCase()
      .includes('EXIT')
  ) {
    return -1;
  }

  return 0;
}

/* ============================================================
 * Decision
 * ============================================================ */

function decisionLabel(
  signal,
  score,
  confidence
) {
  const normalizedSignal =
    normalizeSignal(signal);

  const normalizedScore =
    normalizeScore(score);

  const normalizedConfidence =
    normalizeConfidence(
      confidence
    );

  if (
    normalizedSignal === 1
  ) {
    if (
      normalizedScore >= 65 &&
      normalizedConfidence >= 70
    ) {
      return 'STRONG_BUY';
    }

    return 'BUY';
  }

  if (
    normalizedSignal === -1
  ) {
    if (
      normalizedScore <= -65 &&
      normalizedConfidence >= 70
    ) {
      return 'STRONG_SELL';
    }

    return 'SELL';
  }

  return 'HOLD';
}

function decisionText(
  decision
) {
  switch (
    String(decision)
      .toUpperCase()
  ) {
    case 'STRONG_BUY':
      return '강한 매수';

    case 'BUY':
      return '매수';

    case 'STRONG_SELL':
      return '강한 매도';

    case 'SELL':
      return '매도';

    case 'BLOCKED':
      return '거래 제한';

    default:
      return '중립';
  }
}

function decisionColor(
  decision
) {
  switch (
    String(decision)
      .toUpperCase()
  ) {
    case 'STRONG_BUY':
    case 'BUY':
      return 'buy';

    case 'STRONG_SELL':
    case 'SELL':
      return 'sell';

    default:
      return 'hold';
  }
}

/* ============================================================
 * Agent Breakdown
 * ============================================================ */

const AGENT_LABELS = {
  TREND: '추세',
  MOMENTUM: '모멘텀',
  VWAP: 'VWAP',
  BREAKOUT: '돌파',
  MEAN_REVERSION: '평균회귀',
  VOLUME: '거래량',
  VOLATILITY: '변동성',
  PRICE_ACTION: '가격행동',

  MARKET_REGIME: '시장국면',
  SECTOR: '섹터',
  NEWS: '뉴스',
  EARNINGS: '실적',
  EVENT: '이벤트',
  RISK: '리스크',
};

const AGENT_ICONS = {
  TREND: 'TREND',
  MOMENTUM: 'MOMENTUM',
  VWAP: 'VWAP',
  BREAKOUT: 'BREAKOUT',
  MEAN_REVERSION: 'MEAN',
  VOLUME: 'VOLUME',
  VOLATILITY: 'VOL',
  PRICE_ACTION: 'PRICE',

  MARKET_REGIME: 'REGIME',
  SECTOR: 'SECTOR',
  NEWS: 'NEWS',
  EARNINGS: 'EARNINGS',
  EVENT: 'EVENT',
  RISK: 'RISK',
};

function normalizeAgent(
  agent
) {
  const name =
    String(
      agent?.name ||
      agent?.agent ||
      'UNKNOWN'
    ).toUpperCase();

  const score =
    normalizeScore(
      agent?.score
    );

  const confidence =
    normalizeConfidence(
      agent?.confidence
    );

  let direction =
    'NEUTRAL';

  if (score >= 20) {
    direction = 'BULLISH';
  } else if (
    score <= -20
  ) {
    direction = 'BEARISH';
  }

  return {
    name,

    label:
      AGENT_LABELS[name] ||
      name,

    icon:
      AGENT_ICONS[name] ||
      'AI',

    score:
      round(score, 1),

    confidence:
      round(
        confidence,
        1
      ),

    direction,

    weight:
      round(
        agent?.weight,
        3
      ),

    contribution:
      round(
        agent?.contribution,
        2
      ),

    reason:
      agent?.reason ||
      agent?.message ||
      agent?.evidence?.reason ||
      '',

    evidence:
      Array.isArray(
        agent?.evidence
      )
        ? agent.evidence
        : [],

    blocked:
      Boolean(
        agent?.blocked
      ),
  };
}

function buildAgentBreakdown(
  result
) {
  const agents =
    result?.agents;

  if (
    Array.isArray(agents)
  ) {
    return agents.map(
      normalizeAgent
    );
  }

  if (
    agents &&
    typeof agents ===
      'object'
  ) {
    return Object.entries(
      agents
    ).map(
      ([
        name,
        value,
      ]) =>
        normalizeAgent({
          ...(value || {}),
          name,
        })
    );
  }

  const contributions =
    result?.ensemble
      ?.contributions ||
    result?.contributions;

  if (
    contributions &&
    typeof contributions ===
      'object'
  ) {
    return Object.entries(
      contributions
    ).map(
      ([
        name,
        value,
      ]) =>
        normalizeAgent({
          ...(value || {}),
          name,
        })
    );
  }

  return [];
}

/* ============================================================
 * Market Regime
 * ============================================================ */

function normalizeRegime(
  result
) {
  const raw =
    result?.regime ||
    result?.marketRegime ||
    result?.ensemble?.regime ||
    result?.meta?.regime ||
    'SIDEWAYS';

  const value =
    String(raw)
      .trim()
      .toUpperCase();

  if (
    value.includes('BULL')
  ) {
    return 'BULLISH';
  }

  if (
    value.includes('BEAR')
  ) {
    return 'BEARISH';
  }

  if (
    value.includes('VOL')
  ) {
    return 'HIGH_VOLATILITY';
  }

  if (
    value.includes('COMPRESS')
  ) {
    return 'COMPRESSION';
  }

  return 'SIDEWAYS';
}

function regimeText(
  regime
) {
  switch (regime) {
    case 'BULLISH':
      return '상승장';

    case 'BEARISH':
      return '하락장';

    case 'HIGH_VOLATILITY':
      return '고변동성';

    case 'COMPRESSION':
      return '변동성 압축';

    default:
      return '횡보장';
  }
}

function buildRegimeSummary(
  result
) {
  const regime =
    normalizeRegime(
      result
    );

  const fit =
    result?.regimeFit ||
    result?.ensemble
      ?.regimeFit ||
    {};

  const score =
    number(
      fit.score,
      50
    );

  return {
    regime,

    label:
      regimeText(regime),

    fitScore:
      round(
        clamp(score),
        1
      ),

    fitLabel:
      fit.label ||
      'NEUTRAL',

    reason:
      fit.reason ||
      '',

    strategy:
      strategyForRegime(
        regime
      ),
  };
}

function strategyForRegime(
  regime
) {
  switch (regime) {
    case 'BULLISH':
      return [
        'Momentum',
        'Trend',
        'Breakout',
      ];

    case 'BEARISH':
      return [
        'Risk Control',
        'Trend',
        'Defensive',
      ];

    case 'HIGH_VOLATILITY':
      return [
        'Risk Control',
        'Breakout',
      ];

    case 'COMPRESSION':
      return [
        'Breakout Watch',
        'Volume',
      ];

    default:
      return [
        'Mean Reversion',
        'VWAP',
      ];
  }
}

/* ============================================================
 * Risk
 * ============================================================ */

function buildRiskSummary(
  result
) {
  const source =
    result?.risk ||
    result?.ensemble?.risk ||
    {};

  const score =
    number(
      source.score,
      0
    );

  const normalizedRisk =
    score < 0
      ? clamp(
          Math.abs(score)
        )
      : clamp(score);

  let level =
    'LOW';

  if (
    normalizedRisk >= 70
  ) {
    level = 'HIGH';
  } else if (
    normalizedRisk >= 40
  ) {
    level = 'MEDIUM';
  }

  const reasons =
    Array.isArray(
      source.reasons
    )
      ? source.reasons
      : Array.isArray(
          source.evidence
        )
        ? source.evidence
        : [];

  return {
    score:
      round(
        normalizedRisk,
        1
      ),

    level,

    confidence:
      round(
        normalizeConfidence(
          source.confidence
        ),
        1
      ),

    penalty:
      round(
        source.penalty,
        1
      ),

    blocked:
      Boolean(
        source.blocked
      ),

    reasons:
      reasons.slice(
        0,
        6
      ),
  };
}

/* ============================================================
 * Trade Plan
 * ============================================================ */

function getATR(
  result
) {
  const candidates = [
    result?.indicators?.atr,
    result?.technical?.atr,
    result?.quant?.indicators?.atr,
    result?.dayQuant?.indicators?.atr,
    result?.swingQuant?.indicators?.atr,
    result?.strategy?.atr,
  ];

  for (
    const value of candidates
  ) {
    const n =
      number(
        value,
        NaN
      );

    if (
      Number.isFinite(n) &&
      n > 0
    ) {
      return n;
    }
  }

  return null;
}

function getCurrentPrice(
  result
) {
  const candidates = [
    result?.currentPrice,
    result?.price,
    result?.quote?.currentPrice,
    result?.quote?.price,
  ];

  for (
    const value of candidates
  ) {
    const n =
      number(
        value,
        NaN
      );

    if (
      Number.isFinite(n) &&
      n > 0
    ) {
      return n;
    }
  }

  return null;
}

function getSupport(
  result,
  price
) {
  const candidates = [
    result?.levels?.support,
    result?.support,
    result?.technical?.support,
    result?.indicators?.support,
  ];

  for (
    const value of candidates
  ) {
    const n =
      number(
        value,
        NaN
      );

    if (
      Number.isFinite(n) &&
      n > 0 &&
      n < price
    ) {
      return n;
    }
  }

  return null;
}

function getResistance(
  result,
  price
) {
  const candidates = [
    result?.levels?.resistance,
    result?.resistance,
    result?.technical?.resistance,
    result?.indicators?.resistance,
  ];

  for (
    const value of candidates
  ) {
    const n =
      number(
        value,
        NaN
      );

    if (
      Number.isFinite(n) &&
      n > price
    ) {
      return n;
    }
  }

  return null;
}

function buildTradePlan(
  result,
  decision
) {
  const price =
    getCurrentPrice(
      result
    );

  if (
    !price ||
    decision === 'HOLD' ||
    decision === 'BLOCKED'
  ) {
    return {
      available: false,
      side:
        decision === 'SELL' ||
        decision === 'STRONG_SELL'
          ? 'SELL'
          : 'WAIT',

      reason:
        '명확한 거래 시나리오를 생성하기 위한 가격 데이터 부족',
    };
  }

  const atr =
    getATR(result);

  const support =
    getSupport(
      result,
      price
    );

  const resistance =
    getResistance(
      result,
      price
    );

  const isLong =
    decision === 'BUY' ||
    decision === 'STRONG_BUY';

  /*
   * ATR 기반의 보수적인
   * 분석용 시나리오.
   *
   * 실제 주문 가격을 의미하지 않음.
   */
  const riskDistance =
    atr
      ? atr * 1.25
      : price * 0.025;

  const rewardDistance =
    atr
      ? atr * 2.5
      : price * 0.05;

  let entryLow;
  let entryHigh;
  let stop;
  let target;

  if (isLong) {
    entryLow =
      support
        ? Math.max(
            support,
            price -
              riskDistance *
                0.25
          )
        : price -
          riskDistance *
            0.2;

    entryHigh =
      price;

    stop =
      support &&
      support < price
        ? Math.min(
            support -
              riskDistance *
                0.15,
            price -
              riskDistance
          )
        : price -
          riskDistance;

    target =
      resistance &&
      resistance > price
        ? Math.max(
            resistance,
            price +
              rewardDistance
          )
        : price +
          rewardDistance;
  } else {
    entryLow =
      price;

    entryHigh =
      support &&
      support < price
        ? Math.max(
            price +
              riskDistance *
                0.2,
            price
          )
        : price +
          riskDistance *
            0.2;

    stop =
      resistance &&
      resistance > price
        ? Math.max(
            resistance +
              riskDistance *
                0.15,
            price +
              riskDistance
          )
        : price +
          riskDistance;

    target =
      support &&
      support < price
        ? Math.min(
            support,
            price -
              rewardDistance
          )
        : price -
          rewardDistance;
  }

  const risk =
    Math.abs(
      price - stop
    );

  const reward =
    Math.abs(
      target - price
    );

  const rr =
    risk > 0
      ? reward / risk
      : null;

  return {
    available: true,

    side:
      isLong
        ? 'BUY'
        : 'SELL',

    type:
      'ANALYSIS_SCENARIO',

    entry: {
      low:
        round(
          Math.min(
            entryLow,
            entryHigh
          ),
          4
        ),

      high:
        round(
          Math.max(
            entryLow,
            entryHigh
          ),
          4
        ),
    },

    stop:
      round(
        stop,
        4
      ),

    target:
      round(
        target,
        4
      ),

    risk:
      round(
        risk,
        4
      ),

    reward:
      round(
        reward,
        4
      ),

    riskReward:
      rr === null
        ? null
        : round(
            rr,
            2
          ),

    atr:
      atr
        ? round(
            atr,
            4
          )
        : null,

    support:
      support
        ? round(
            support,
            4
          )
        : null,

    resistance:
      resistance
        ? round(
            resistance,
            4
          )
        : null,

    disclaimer:
      '분석용 시나리오이며 실제 주문 가격이나 수익을 보장하지 않습니다.',
  };
}

/* ============================================================
 * Signal Change
 * ============================================================ */

function buildSignalChange(
  current,
  previous
) {
  if (
    !previous
  ) {
    return {
      available: false,
      changed: false,
      scoreDelta: 0,
      confidenceDelta: 0,
      decisionChanged: false,
      previous: null,
    };
  }

  const currentScore =
    number(
      current?.score
    );

  const previousScore =
    number(
      previous?.score
    );

  const currentConfidence =
    normalizeConfidence(
      current?.confidence
    );

  const previousConfidence =
    normalizeConfidence(
      previous?.confidence
    );

  const currentDecision =
    current?.decision ||
    decisionLabel(
      current?.signal,
      currentScore,
      currentConfidence
    );

  const previousDecision =
    previous?.decision ||
    decisionLabel(
      previous?.signal,
      previousScore,
      previousConfidence
    );

  const scoreDelta =
    currentScore -
    previousScore;

  const confidenceDelta =
    currentConfidence -
    previousConfidence;

  let direction =
    'UNCHANGED';

  if (
    scoreDelta >= 5
  ) {
    direction = 'IMPROVING';
  } else if (
    scoreDelta <= -5
  ) {
    direction = 'WEAKENING';
  }

  return {
    available: true,

    changed:
      scoreDelta !== 0 ||
      currentDecision !==
        previousDecision,

    scoreDelta:
      round(
        scoreDelta,
        2
      ),

    confidenceDelta:
      round(
        confidenceDelta,
        2
      ),

    direction,

    decisionChanged:
      currentDecision !==
      previousDecision,

    previous: {
      score:
        round(
          previousScore,
          2
        ),

      confidence:
        round(
          previousConfidence,
          2
        ),

      decision:
        previousDecision,
    },

    current: {
      score:
        round(
          currentScore,
          2
        ),

      confidence:
        round(
          currentConfidence,
          2
        ),

      decision:
        currentDecision,
    },
  };
}

/* ============================================================
 * Reasons
 * ============================================================ */

function buildKeyReasons(
  result,
  agents,
  decision
) {
  const candidates =
    agents
      .filter(
        agent =>
          !agent.blocked
      )
      .sort(
        (a, b) =>
          Math.abs(
            number(
              b.contribution
            )
          ) -
          Math.abs(
            number(
              a.contribution
            )
          )
      );

  const reasons = [];

  for (
    const agent of candidates
  ) {
    if (
      reasons.length >= 5
    ) {
      break;
    }

    if (
      agent.reason
    ) {
      reasons.push({
        agent:
          agent.name,

        label:
          agent.label,

        direction:
          agent.direction,

        text:
          agent.reason,
      });

      continue;
    }

    if (
      agent.score >= 20
    ) {
      reasons.push({
        agent:
          agent.name,

        label:
          agent.label,

        direction:
          'BULLISH',

        text:
          `${agent.label} 신호가 긍정적입니다.`,
      });

      continue;
    }

    if (
      agent.score <= -20
    ) {
      reasons.push({
        agent:
          agent.name,

        label:
          agent.label,

        direction:
          'BEARISH',

        text:
          `${agent.label} 신호가 부정적입니다.`,
      });
    }
  }

  if (
    !reasons.length
  ) {
    reasons.push({
      agent:
        'ENSEMBLE',

      label:
        '종합',

      direction:
        'NEUTRAL',

      text:
        decision === 'HOLD'
          ? '현재 방향성에 대한 충분한 합의가 없습니다.'
          : '종합 Agent 판단을 확인하세요.',
    });
  }

  return reasons;
}

/* ============================================================
 * Main
 * ============================================================ */

function buildAIPresentation(
  result,
  options = {}
) {
  const source =
    result || {};

  const ensemble =
    source.ensemble ||
    source.judge ||
    source;

  const signal =
    normalizeSignal(
      ensemble.signal ??
      source.signal
    );

  const score =
    normalizeScore(
      ensemble.score ??
      source.score ??
      source.combinedScore
    );

  const confidence =
    normalizeConfidence(
      ensemble.confidence ??
      source.confidence
    );

  const decision =
    ensemble.decision &&
    String(
      ensemble.decision
    ).toUpperCase() !==
      'UNKNOWN'
      ? String(
          ensemble.decision
        ).toUpperCase()
      : decisionLabel(
          signal,
          score,
          confidence
        );

  const agents =
    buildAgentBreakdown(
      source
    );

  const regime =
    buildRegimeSummary(
      source
    );

  const risk =
    buildRiskSummary(
      source
    );

  const tradePlan =
    buildTradePlan(
      source,
      decision
    );

  const signalChange =
    buildSignalChange(
      {
        signal,
        score,
        confidence,
        decision,
      },
      options.previousSignal
    );

  const reasons =
    buildKeyReasons(
      source,
      agents,
      decision
    );

  const agreement =
    normalizeConfidence(
      ensemble.agreement
    );

  const coverage =
    normalizeConfidence(
      ensemble.coverage
    );

  const strength =
    number(
      ensemble.strength,
      Math.round(
        Math.abs(score) *
          0.5 +
          confidence *
            0.3 +
          agreement *
            0.2
      )
    );

  return {
    version:
      '2.0',

    ticker:
      source.ticker ||
      options.ticker ||
      null,

    label:
      source.label ||
      options.label ||
      null,

    price:
      getCurrentPrice(
        source
      ),

    signal,

    decision,

    decisionText:
      decisionText(
        decision
      ),

    color:
      decisionColor(
        decision
      ),

    score:
      round(
        score,
        2
      ),

    confidence:
      round(
        confidence,
        2
      ),

    agreement:
      round(
        agreement,
        2
      ),

    coverage:
      round(
        coverage,
        2
      ),

    strength:
      round(
        clamp(strength),
        1
      ),

    blocked:
      Boolean(
        ensemble.blocked ||
        source.blocked
      ),

    reason:
      ensemble.reason ||
      source.reason ||
      '',

    detailedReason:
      ensemble.detailedReason ||
      source.detailedReason ||
      '',

    vetoes:
      Array.isArray(
        ensemble.vetoes
      )
        ? ensemble.vetoes
        : [],

    regime,

    risk,

    agents,

    reasons,

    tradePlan,

    signalChange,

    meta: {
      generatedAt:
        new Date().toISOString(),

      informationCoverage:
        round(
          coverage,
          2
        ),

      agentCount:
        agents.length,

      bullishAgents:
        agents.filter(
          agent =>
            agent.direction ===
            'BULLISH'
        ).length,

      bearishAgents:
        agents.filter(
          agent =>
            agent.direction ===
            'BEARISH'
        ).length,

      neutralAgents:
        agents.filter(
          agent =>
            agent.direction ===
            'NEUTRAL'
        ).length,
    },
  };
}

/* ============================================================
 * Ranking
 * ============================================================ */

function rankingScore(
  presentation
) {
  if (
    !presentation
  ) {
    return -Infinity;
  }

  const score =
    Math.abs(
      number(
        presentation.score
      )
    );

  const confidence =
    number(
      presentation.confidence
    );

  const agreement =
    number(
      presentation.agreement
    );

  const risk =
    number(
      presentation.risk?.score
    );

  const blocked =
    presentation.blocked
      ? 30
      : 0;

  return (
    score * 0.45 +
    confidence * 0.3 +
    agreement * 0.15 +
    (100 - risk) *
      0.1 -
    blocked
  );
}

function rankPresentations(
  presentations = [],
  options = {}
) {
  const list =
    Array.isArray(
      presentations
    )
      ? presentations
          .map(
            item => {
              const presentation =
                item?.decision
                  ? item
                  : buildAIPresentation(
                      item,
                      options
                    );

              return {
                ...presentation,

                rankingScore:
                  round(
                    rankingScore(
                      presentation
                    ),
                    2
                  ),
              };
            }
          )
      : [];

  return list
    .sort(
      (a, b) =>
        number(
          b.rankingScore
        ) -
        number(
          a.rankingScore
        )
    )
    .map(
      (item, index) => ({
        ...item,

        rank:
          index + 1,
      })
    );
}

/* ============================================================
 * Exports
 * ============================================================ */

module.exports = {
  buildAIPresentation,
  buildAgentBreakdown,
  buildRegimeSummary,
  buildRiskSummary,
  buildTradePlan,
  buildSignalChange,
  rankPresentations,
};
