// lib/strategyEngine.js

const {
  runAgentEngine,
} = require('./engine/agentEngine');

function safe(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const factor = 10 ** digits;

  return (
    Math.round(n * factor) /
    factor
  );
}

function normalizeConfidence(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) return 0;

  return n > 1
    ? clamp(n, 0, 100) / 100
    : clamp(n, 0, 1);
}

function barsFromData(data = {}) {
  if (Array.isArray(data)) return data;

  if (Array.isArray(data?.bars)) {
    return data.bars;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  return [];
}

function closesFromBars(bars = []) {
  return bars
    .map(
      b =>
        Number(
          typeof b === 'number'
            ? b
            : b?.close
        )
    )
    .filter(Number.isFinite);
}

function normalizeAsset(asset = {}) {
  const bars =
    barsFromData(asset);

  const closes =
    closesFromBars(bars);

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

function normalizeMarket(
  market = {}
) {
  return {
    ...market,

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

    index:
      normalizeAsset(
        market.index
      ),

    qqqIndex:
      normalizeAsset(
        market.qqqIndex
      ),

    vix:
      normalizeAsset(
        market.vix
      ),

    rates:
      normalizeAsset(
        market.rates
      ),

    sector:
      normalizeAsset(
        market.sector
      ),
  };
}

function normalizeNews(news) {
  if (Array.isArray(news)) return news;

  if (Array.isArray(news?.articles)) {
    return news.articles;
  }

  if (Array.isArray(news?.headlines)) {
    return news.headlines;
  }

  return [];
}

function eventAgent(headlines = []) {
  const list =
    normalizeNews(
      headlines
    );

  const events = [];

  const rules = [
    [/earnings|실적|어닝/i, 'EARNINGS'],
    [/guidance|outlook|전망|가이던스/i, 'GUIDANCE'],
    [/fomc|fed|federal reserve|연준/i, 'FED'],
    [/cpi|ppi|inflation|물가/i, 'INFLATION'],
    [/payroll|nonfarm|고용|실업률/i, 'EMPLOYMENT'],
    [/fda|approval|승인|clinical|임상/i, 'FDA'],
    [/lawsuit|소송|investigation|규제|regulator/i, 'REGULATORY'],
    [/offering|dilution|증자|유상증자|convertible/i, 'DILUTION'],
    [/bankruptcy|파산|default|부도/i, 'DISTRESS'],
    [/merger|acquisition|인수|합병/i, 'M&A'],
    [/upgrade|상향/i, 'UPGRADE'],
    [/downgrade|하향/i, 'DOWNGRADE'],
  ];

  for (const item of list) {
    const title =
      typeof item === 'string'
        ? item
        : item?.title ||
          item?.description ||
          '';

    if (!title) continue;

    for (const [pattern, type] of rules) {
      if (pattern.test(title)) {
        events.push({
          type,
          title,
          publishedAt:
            item?.publishedAt ||
            item?.pubDate ||
            item?.date ||
            null,
        });

        break;
      }
    }
  }

  const severeNegative =
    events.some(
      e =>
        e.type === 'DISTRESS' ||
        e.type === 'DILUTION' ||
        e.type === 'REGULATORY' ||
        e.type === 'DOWNGRADE'
    );

  const severePositive =
    events.some(
      e =>
        e.type === 'M&A' ||
        e.type === 'FDA' ||
        e.type === 'UPGRADE'
    );

  return {
    name: 'EVENT',
    score:
      severeNegative
        ? -70
        : severePositive
          ? 45
          : events.length
            ? 5
            : 0,
    confidence:
      events.length
        ? 0.75
        : 0.1,
    blocked:
      severeNegative,
    reason:
      severeNegative
        ? '중대 이벤트 리스크'
        : null,
    evidence: {
      count:
        events.length,
      events:
        events.slice(0, 10),
      severeNegative,
      severePositive,
    },
  };
}

function summarizeRisk(result) {
  const risk =
    result?.agents?.RISK || {};

  const score =
    safe(risk.score, 0);

  const blocked =
    Boolean(
      risk.blocked ||
      result?.ensemble?.blocked
    );

  let level = 'LOW';

  /*
   * score가 높을수록 안전하다.
   */
  if (blocked || score < -50) {
    level = 'EXTREME';
  } else if (score < -20) {
    level = 'HIGH';
  } else if (score < 10) {
    level = 'MEDIUM';
  }

  return {
    blocked,
    level,
    score: round(score),
    reasons:
      risk.evidence?.reasons || [],
    warnings:
      risk.evidence?.warnings || [],
    evidence:
      risk.evidence || {},
  };
}

function summarizeAgents(result) {
  const agents =
    result?.agents || {};

  const names =
    Object.keys(agents);

  const bullish =
    names.filter(
      name =>
        safe(
          agents[name]?.score
        ) >= 20
    );

  const bearish =
    names.filter(
      name =>
        safe(
          agents[name]?.score
        ) <= -20
    );

  const neutral =
    names.filter(
      name =>
        safe(
          agents[name]?.score
        ) > -20 &&
        safe(
          agents[name]?.score
        ) < 20
    );

  return {
    total:
      names.length,
    bullish:
      bullish.length,
    bearish:
      bearish.length,
    neutral:
      neutral.length,
    bullishNames:
      bullish,
    bearishNames:
      bearish,
    neutralNames:
      neutral,
  };
}

function calculateExecutionPlan({
  price,
  bars,
  result,
  mode,
}) {
  const last =
    Number(price);

  if (
    !Number.isFinite(last) ||
    last <= 0
  ) {
    return {
      entry: null,
      stop: null,
      target1: null,
      target2: null,
      riskReward: null,
      positionSizePct: 0,
    };
  }

  const atr =
    safe(
      result?.agents?.RISK?.evidence?.atr,
      0
    );

  const atrValue =
    atr > 0
      ? atr
      : (() => {
          const recent =
            bars.slice(-14);

          if (!recent.length) return 0;

          return (
            recent.reduce(
              (sum, b) =>
                sum +
                Math.abs(
                  safe(b.high) -
                  safe(b.low)
                ),
              0
            ) /
            recent.length
          );
        })();

  if (!atrValue) {
    return {
      entry: last,
      stop: null,
      target1: null,
      target2: null,
      riskReward: null,
      positionSizePct: 0,
    };
  }

  const stopMultiplier =
    mode === 'SWING'
      ? 2.0
      : 1.35;

  const targetMultiplier =
    mode === 'SWING'
      ? 3.2
      : 2.2;

  const stop =
    last -
    atrValue *
      stopMultiplier;

  const target1 =
    last +
    atrValue *
      targetMultiplier;

  const target2 =
    last +
    atrValue *
      (
        targetMultiplier +
        1.5
      );

  const risk =
    last - stop;

  const reward =
    target1 - last;

  const riskReward =
    risk > 0
      ? reward / risk
      : null;

  const positionSizePct =
    riskReward &&
    riskReward >=
      (
        mode === 'SWING'
          ? 1.7
          : 1.5
      )
      ? mode === 'SWING'
        ? 0.25
        : 0.2
      : 0;

  return {
    entry:
      round(last),
    stop:
      round(stop),
    target1:
      round(target1),
    target2:
      round(target2),
    riskReward:
      round(riskReward, 2),
    atr:
      round(atrValue),
    positionSizePct,
  };
}

function modeDecision(
  result,
  mode
) {
  if (!result) {
    return {
      mode,
      signal: 0,
      decision: 'WAIT',
      score: 0,
      confidence: 0,
      setup: 'NONE',
      regime: 'UNKNOWN',
      reason: '판단 데이터 없음',
      risk: {
        blocked: true,
        level: 'EXTREME',
      },
      agents: {},
      ensemble: {},
      summary: {},
    };
  }

  const risk =
    summarizeRisk(result);

  const signal =
    Number(result.signal) || 0;

  const confidence =
    normalizeConfidence(
      result.confidence
    );

  let decision = 'WAIT';

  if (risk.blocked) {
    decision = 'NO_TRADE';
  } else if (
    signal === 1 &&
    confidence >=
      (
        mode === 'DAY'
          ? 0.42
          : 0.48
      )
  ) {
    decision =
      mode === 'DAY'
        ? 'DAY_BUY'
        : 'SWING_BUY';
  } else if (
    signal === -1
  ) {
    decision = 'EXIT';
  }

  return {
    mode,
    signal,
    decision,
    score:
      round(
        result.score
      ),
    confidence:
      round(
        confidence * 100,
        1
      ),
    setup:
      result.setup,
    regime:
      result.regime,
    reason:
      result.reason,
    risk,
    agents:
      result.agents,
    ensemble:
      result.ensemble,
    summary:
      summarizeAgents(
        result
      ),
  };
}

function finalJudge(
  day,
  swing
) {
  if (
    day.decision === 'NO_TRADE' &&
    swing.decision === 'NO_TRADE'
  ) {
    return {
      signal: 0,
      decision: 'NO_TRADE',
      confidence:
        Math.max(
          day.confidence,
          swing.confidence
        ),
      reason:
        'DAY/SWING 모두 거래 금지',
    };
  }

  if (
    day.decision === 'EXIT' ||
    swing.decision === 'EXIT'
  ) {
    return {
      signal: -1,
      decision: 'EXIT',
      confidence:
        Math.max(
          day.confidence,
          swing.confidence
        ),
      reason:
        '하락 전환 또는 위험 증가',
    };
  }

  /*
   * DAY + SWING 동시 동의.
   */
  if (
    day.decision === 'DAY_BUY' &&
    swing.decision === 'SWING_BUY'
  ) {
    return {
      signal: 1,
      decision: 'BUY',
      confidence:
        round(
          (
            day.confidence +
            swing.confidence
          ) /
          2,
          1
        ),
      reason:
        'DAY/SWING 다중시간대 동시 합의',
    };
  }

  /*
   * DAY만 강하면 추격 매수.
   */
  if (
    day.decision === 'DAY_BUY' &&
    day.confidence >= 65
  ) {
    return {
      signal: 1,
      decision: 'DAY_BUY',
      confidence:
        day.confidence,
      reason:
        '단기 Agent 강한 합의',
    };
  }

  /*
   * SWING만 강하면 관심 상태.
   */
  if (
    swing.decision === 'SWING_BUY'
  ) {
    return {
      signal: 0,
      decision: 'SWING_WAIT',
      confidence:
        swing.confidence,
      reason:
        '스윙 구조는 양호하지만 단기 진입 타이밍 부족',
    };
  }

  return {
    signal: 0,
    decision: 'WAIT',
    confidence:
      Math.max(
        day.confidence,
        swing.confidence
      ),
    reason:
      '현재 진입 조건 부족',
  };
}

function evaluateStrategy({
  ticker,
  price,
  dailyBars = [],
  intradayBars = [],
  market = {},
  sector = {},
  news = [],
  earnings = {},
  account = {},
  position = {},
  contextSeries = {},
} = {}) {
  const normalizedMarket =
    normalizeMarket(market);

  const dayBars =
    Array.isArray(intradayBars) &&
    intradayBars.length >= 100
      ? intradayBars
      : dailyBars;

  const swingBars =
    dailyBars;

  /*
   * Live path.
   */
  const day =
    runAgentEngine({
      bars: dayBars,
      market:
        normalizedMarket,
      sector,
      news,
      earnings,
      account,
      position,
      mode: 'DAY',
    });

  const swing =
    runAgentEngine({
      bars: swingBars,
      market:
        normalizedMarket,
      sector,
      news,
      earnings,
      account,
      position,
      mode: 'SWING',
    });

  const dayDecision =
    modeDecision(
      day,
      'DAY'
    );

  const swingDecision =
    modeDecision(
      swing,
      'SWING'
    );

  const final =
    finalJudge(
      dayDecision,
      swingDecision
    );

  const execution =
    calculateExecutionPlan({
      price,
      bars:
        dayBars,
      result:
        day,
      mode:
        final.decision === 'SWING_BUY'
          ? 'SWING'
          : 'DAY',
    });

  return {
    ticker,
    price,

    signal:
      final.signal,

    decision:
      final.decision,

    mode:
      final.decision === 'SWING_WAIT'
        ? 'SWING'
        : final.decision === 'SWING_BUY'
          ? 'SWING'
          : 'DAY',

    confidence:
      final.confidence,

    reason:
      final.reason,

    regime:
      day.regime === 'SIDEWAYS'
        ? swing.regime
        : day.regime,

    day:
      dayDecision,

    swing:
      swingDecision,

    final,

    execution,

    context: {
      market:
        normalizedMarket,
      sector,
      newsCount:
        Array.isArray(news)
          ? news.length
          : 0,
      earningsAvailable:
        Boolean(
          earnings &&
          Object.keys(
            earnings
          ).length
        ),
      pointInTime:
        Boolean(
          contextSeries &&
          Object.keys(
            contextSeries
          ).length
        ),
    },
  };
}

module.exports = {
  evaluateStrategy,
  eventAgent,
  modeDecision,
  finalJudge,
  summarizeRisk,
  summarizeAgents,
};
