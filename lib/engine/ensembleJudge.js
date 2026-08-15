const BASE_WEIGHTS = {
  TREND: 1.15,
  MOMENTUM: 1.10,
  VWAP: 0.95,
  BREAKOUT: 1.00,
  MEAN_REVERSION: 0.70,
  VOLUME: 0.80,
  VOLATILITY: 0.65,
  PRICE_ACTION: 0.80,

  MARKET_REGIME: 1.15,
  SECTOR: 0.90,
  NEWS: 0.90,
  EARNINGS: 0.75,

  RISK: 1.50,
};

function clamp(v, min = -100, max = 100) {
  return Math.max(min, Math.min(max, Number(v) || 0));
}

function dynamicWeights(regime) {
  const w = {
    ...BASE_WEIGHTS,
  };

  if (
    regime === 'TREND' ||
    regime === 'BULL'
  ) {
    w.TREND *= 1.25;
    w.MOMENTUM *= 1.20;
    w.BREAKOUT *= 1.15;
    w.MEAN_REVERSION *= 0.60;
  }

  if (
    regime === 'SIDEWAYS'
  ) {
    w.MEAN_REVERSION *= 1.35;
    w.VWAP *= 1.20;
    w.BREAKOUT *= 0.75;
    w.TREND *= 0.80;
  }

  if (
    regime === 'HIGH_VOL'
  ) {
    w.RISK *= 1.35;
    w.VOLATILITY *= 1.20;
    w.BREAKOUT *= 0.85;
  }

  if (
    regime === 'COMPRESSION'
  ) {
    w.BREAKOUT *= 1.35;
    w.VOLUME *= 1.15;
  }

  return w;
}

function judgeAgents(
  agents,
  {
    regime = 'SIDEWAYS',
    minScore = 24,
    minConfidence = 0.48,
    minBullish = 5,
    maxConflict = 0.45,
  } = {}
) {
  const weights =
    dynamicWeights(
      regime
    );

  let weighted = 0;
  let totalWeight = 0;

  let bullish = 0;
  let bearish = 0;

  const contributions = {};

  for (const a of agents) {
    const weight =
      weights[a.name] ?? 0.5;

    /*
     * Agent confidence도 가중치에 반영.
     */
    const effectiveWeight =
      weight *
      Math.max(
        0.15,
        a.confidence
      );

    const contribution =
      a.score *
      effectiveWeight;

    weighted +=
      contribution;

    totalWeight +=
      effectiveWeight;

    if (a.score >= 20)
      bullish++;

    if (a.score <= -20)
      bearish++;

    contributions[
      a.name
    ] = {
      score: a.score,
      confidence:
        a.confidence,
      weight:
        Number(
          effectiveWeight.toFixed(
            3
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

  const score =
    totalWeight
      ? weighted /
        totalWeight
      : 0;

  const total =
    agents.length || 1;

  const conflict =
    Math.min(
      bullish,
      bearish
    ) / total;

  const agreement =
    1 -
    conflict;

  let confidence =
    Math.abs(score) /
    100;

  confidence *=
    0.65 +
    agreement *
      0.35;

  /*
   * 강한 합의.
   */
  if (
    bullish >= 7 &&
    bearish <= 2
  ) {
    confidence *= 1.15;
  }

  if (
    bearish >= 7 &&
    bullish <= 2
  ) {
    confidence *= 1.15;
  }

  confidence =
    Math.min(
      1,
      confidence
    );

  const risk =
    agents.find(
      a => a.name === 'RISK'
    );

  if (
    risk?.blocked
  ) {
    return {
      signal: 0,
      score,
      confidence,
      agreement,
      bullish,
      bearish,
      blocked: true,
      reason:
        risk.reasons?.join(
          ', '
        ) ||
        'Risk Agent 차단',
      contributions,
    };
  }

  /*
   * 뉴스/이벤트가 강하게 반대하면
   * 기술적 신호를 바로 무시하지 않고
   * 확신도를 크게 낮춘다.
   */
  const news =
    agents.find(
      a => a.name === 'NEWS'
    );

  const earnings =
    agents.find(
      a => a.name === 'EARNINGS'
    );

  let adjustedScore =
    score;

  if (
    news &&
    Math.sign(news.score) !==
      Math.sign(score) &&
    Math.abs(news.score) >= 55
  ) {
    adjustedScore *= 0.70;
    confidence *= 0.80;
  }

  if (
    earnings &&
    Math.sign(earnings.score) !==
      Math.sign(score) &&
    Math.abs(earnings.score) >= 50
  ) {
    adjustedScore *= 0.75;
    confidence *= 0.82;
  }

  let signal = 0;
  let reason =
    '에이전트 합의 부족';

  if (
    adjustedScore >= minScore &&
    confidence >= minConfidence &&
    bullish >= minBullish &&
    conflict <= maxConflict
  ) {
    signal = 1;
    reason =
      '다중 에이전트 강한 상승 합의';
  } else if (
    adjustedScore <= -minScore &&
    confidence >= minConfidence &&
    bearish >= minBullish &&
    conflict <= maxConflict
  ) {
    signal = -1;
    reason =
      '다중 에이전트 강한 하락 합의';
  } else if (
    adjustedScore > 0
  ) {
    reason =
      '상승 의견은 있으나 합의 부족';
  } else {
    reason =
      '하락 의견은 있으나 합의 부족';
  }

  return {
    signal,
    score:
      clamp(
        adjustedScore
      ),
    confidence:
      Number(
        confidence.toFixed(
          3
        )
      ),
    agreement:
      Number(
        agreement.toFixed(
          3
        )
      ),
    bullish,
    bearish,
    conflict,
    blocked: false,
    reason,
    contributions,
  };
}

module.exports = {
  judgeAgents,
};
