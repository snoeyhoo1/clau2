/*
 * lib/engine/ensembleJudge.js
 *
 * Multi-Agent Ensemble Judge
 */

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


function getConfidence(
  agent
) {
  const c =
    Number(
      agent?.confidence
    );

  if (
    !Number.isFinite(c)
  ) {
    return 0.5;
  }

  /*
   * 0~1 또는 0~100 모두 허용.
   */
  return c > 1
    ? Math.min(
        1,
        c / 100
      )
    : Math.max(
        0,
        Math.min(1, c)
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
      bullish: 0,
      bearish: 0,
      conflict: true,
      blocked: true,
      reason:
        'Agent 데이터 부족',
      contributions: {},
    };
  }


  const regime =
    context.regime ||
    'SIDEWAYS';


  /*
   * ----------------------------------------------------------
   * Base weights
   * ----------------------------------------------------------
   */

  const weights = {
    TREND: 1.15,
    MOMENTUM: 1.15,
    VWAP: 1.0,
    BREAKOUT: 1.0,
    MEAN_REVERSION: 0.75,
    VOLUME: 0.9,
    VOLATILITY: 0.7,
    PRICE_ACTION: 0.8,

    MARKET_REGIME: 1.25,
    SECTOR: 0.9,
    NEWS: 1.0,
    EARNINGS: 1.0,
    EVENT: 1.15,

    RISK: 1.4,
  };


  /*
   * ----------------------------------------------------------
   * Regime adaptation
   * ----------------------------------------------------------
   */

  if (
    regime === 'BULL' ||
    regime === 'BULL_TREND'
  ) {
    weights.TREND *= 1.25;
    weights.MOMENTUM *= 1.2;
    weights.BREAKOUT *= 1.15;

    weights.MEAN_REVERSION *=
      0.55;
  }


  if (
    regime === 'BEAR' ||
    regime === 'BEAR_TREND'
  ) {
    weights.TREND *= 1.3;
    weights.MOMENTUM *= 1.2;

    weights.BREAKOUT *=
      0.85;
  }


  if (
    regime === 'SIDEWAYS'
  ) {
    weights.MEAN_REVERSION *=
      1.4;

    weights.VWAP *=
      1.2;

    weights.BREAKOUT *=
      0.75;

    weights.TREND *=
      0.8;
  }


  if (
    regime === 'COMPRESSION'
  ) {
    weights.BREAKOUT *=
      1.4;

    weights.VOLUME *=
      1.2;
  }


  if (
    regime === 'HIGH_VOL' ||
    regime === 'BULL_HIGH_VOL'
  ) {
    weights.RISK *=
      1.3;

    weights.VWAP *=
      0.9;
  }


  /*
   * ----------------------------------------------------------
   * Veto agents
   * ----------------------------------------------------------
   */

  const event =
    agents.find(
      a =>
        a.name ===
        'EVENT'
    );

  const risk =
    agents.find(
      a =>
        a.name ===
        'RISK'
    );


  const hardBlocked =
    Boolean(
      event?.blocked ||
      risk?.blocked
    );


  /*
   * ----------------------------------------------------------
   * Weighted ensemble
   * ----------------------------------------------------------
   */

  let weightedScore = 0;
  let totalWeight = 0;

  const contributions = {};

  for (
    const agent of agents
  ) {
    const score =
      clamp(
        agent.score
      );

    const c =
      getConfidence(
        agent
      );

    const baseWeight =
      weights[
        agent.name
      ] ?? 0.8;

    /*
     * 신뢰도가 낮은 Agent는
     * 영향력을 자동으로 줄인다.
     */
    const effectiveWeight =
      baseWeight *
      (
        0.35 +
        c * 0.65
      );

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
          c.toFixed(2)
        ),
      weight:
        Number(
          effectiveWeight.toFixed(
            2
          )
        ),
      contribution:
        Number(
          contribution.toFixed(
            2
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
   * ----------------------------------------------------------
   * Direction counts
   * ----------------------------------------------------------
   */

  const directional =
    agents.filter(
      agent =>
        agent.name !== 'RISK' &&
        agent.name !== 'EVENT'
    );


  const bullish =
    directional.filter(
      agent =>
        agent.score >= 20
    ).length;


  const bearish =
    directional.filter(
      agent =>
        agent.score <= -20
    ).length;


  const neutral =
    directional.length -
    bullish -
    bearish;


  /*
   * ----------------------------------------------------------
   * Agreement
   * ----------------------------------------------------------
   */

  const total =
    directional.length ||
    1;


  const strongest =
    Math.max(
      bullish,
      bearish
    );


  const agreement =
    strongest /
    total;


  /*
   * Conflict:
   *
   * 양쪽에 강한 Agent가
   * 동시에 많이 존재하면
   * confidence를 낮춘다.
   */

  const conflict =
    bullish >= 3 &&
    bearish >= 3;


  /*
   * ----------------------------------------------------------
   * Confidence
   * ----------------------------------------------------------
   */

  let finalConfidence =
    Math.abs(score) / 100;


  /*
   * agreement가 낮으면 감소.
   */
  finalConfidence *=
    0.55 +
    agreement * 0.45;


  /*
   * conflict penalty.
   */
  if (conflict) {
    finalConfidence *=
      0.65;
  }


  /*
   * Event / Risk가 반대라면
   * LONG confidence 대폭 감소.
   */
  if (
    score > 0 &&
    (
      event?.score < -40 ||
      risk?.score < -40
    )
  ) {
    finalConfidence *=
      0.55;
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
   * ----------------------------------------------------------
   * Final signal
   * ----------------------------------------------------------
   */

  let signal = 0;

  let reason =
    '다중 에이전트 합의 부족';


  /*
   * Risk/Event veto.
   */
  if (
    hardBlocked
  ) {
    signal = 0;

    reason =
      event?.blocked
        ? '중대 이벤트 Risk 차단'
        : 'Risk Agent 진입 차단';
  } else if (
    score >= 22 &&
    bullish >= 4 &&
    agreement >= 0.45 &&
    finalConfidence >= 0.38
  ) {
    signal = 1;

    reason =
      '상승 방향 다중 Agent 합의';
  } else if (
    score <= -22 &&
    bearish >= 4 &&
    agreement >= 0.45 &&
    finalConfidence >= 0.38
  ) {
    signal = -1;

    reason =
      '하락 방향 다중 Agent 합의';
  }


  /*
   * 뉴스/실적이 기술적 방향과
   * 정면 충돌하는 경우 LONG 억제.
   */
  const news =
    agents.find(
      a =>
        a.name ===
        'NEWS'
    );

  const earnings =
    agents.find(
      a =>
        a.name ===
        'EARNINGS'
    );

  if (
    signal === 1 &&
    (
      news?.score <= -55 ||
      earnings?.score <= -55
    )
  ) {
    signal = 0;

    reason =
      '기술적 상승과 이벤트 정보 충돌';
  }


  /*
   * ----------------------------------------------------------
   * Exit
   * ----------------------------------------------------------
   *
   * EXIT는 LONG보다 조금 빠르게 감지한다.
   */

  if (
    signal !== 1 &&
    (
      bearish >= 5 ||
      score <= -35
    ) &&
    !hardBlocked
  ) {
    signal = -1;

    reason =
      '하락 방향 Agent 다수 전환';
  }


  return {
    signal,

    score:
      Number(
        clamp(score).toFixed(2)
      ),

    confidence:
      Number(
        finalConfidence.toFixed(
          3
        )
      ),

    agreement:
      Number(
        agreement.toFixed(3)
      ),

    bullish,

    bearish,

    neutral,

    conflict,

    blocked:
      hardBlocked,

    reason,

    contributions,
  };
}


module.exports = {
  judgeAgents,
};
