// lib/strategyEngine.js
//
// CLAU Multi-Agent Strategy Engine v2
//
// DAY + SWING 통합 판단
//
// 핵심 구조:
//
//                    ┌─ Technical Agents
//                    ├─ Market Regime
//                    ├─ Sector / Relative Strength
//                    ├─ News
//                    ├─ Earnings
//                    ├─ Event
//                    └─ Risk
//                             ↓
//                       Agent Engine
//                             ↓
//                      Ensemble Judge
//                             ↓
//                 DAY / SWING Decision
//                             ↓
//                       Final Judge
//                             ↓
//                     Execution Plan
//
// 중요:
// 이 파일에서는 기술지표를 다시 계산하여
// 별도의 점수 시스템을 만드는 대신
// lib/engine/agentEngine.js를 실제 판단 엔진으로 사용한다.
//
// 즉:
//
// signalEngine
//      ↓
// strategyEngine
//      ↓
// agentEngine
//      ↓
// agents
//      ↓
// ensembleJudge
//      ↓
// 최종 판단
//

const {
  runAgentEngine,
} = require('./engine/agentEngine');


/* ============================================================
 * BASIC HELPERS
 * ============================================================ */

function clamp(
  value,
  min = 0,
  max = 100
) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return min;
  }

  return Math.max(
    min,
    Math.min(max, n)
  );
}


function safe(
  value,
  fallback = 0
) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
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
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  if (n > 1) {
    return clamp(
      n,
      0,
      100
    ) / 100;
  }

  return clamp(
    n,
    0,
    1
  );
}


/* ============================================================
 * BAR HELPERS
 * ============================================================ */

function closesFromBars(
  bars = []
) {
  if (!Array.isArray(bars)) {
    return [];
  }

  return bars
    .map(
      bar =>
        Number(
          typeof bar === 'number'
            ? bar
            : (
                bar?.close ??
                bar?.adjClose ??
                bar?.price
              )
        )
    )
    .filter(
      Number.isFinite
    );
}


function barsFromData(
  data = {}
) {
  if (
    Array.isArray(data)
  ) {
    return data;
  }

  if (
    Array.isArray(data?.bars)
  ) {
    return data.bars;
  }

  if (
    Array.isArray(data?.data)
  ) {
    return data.data;
  }

  const closes =
    Array.isArray(
      data?.closes
    )
      ? data.closes
      : [];

  return closes.map(
    (
      close,
      index
    ) => ({
      open:
        index > 0
          ? closes[
              index - 1
            ]
          : close,

      high:
        close,

      low:
        close,

      close,

      volume:
        0,
    })
  );
}


/* ============================================================
 * MARKET NORMALIZATION
 *
 * 실제 API 데이터 형태가 조금 달라도
 * Agent Engine이 받을 수 있도록 통일한다.
 * ============================================================ */

function normalizeMarket(
  market = {}
) {
  const source =
    market || {};

  function normalizeAsset(
    asset
  ) {
    if (!asset) {
      return {};
    }

    const bars =
      barsFromData(
        asset
      );

    const closes =
      closesFromBars(
        bars
      );

    const currentPrice =
      Number(
        asset.currentPrice ??
        asset.price ??
        closes.at(-1)
      );

    return {
      ...asset,

      bars,

      closes,

      currentPrice:
        Number.isFinite(
          currentPrice
        )
          ? currentPrice
          : null,
    };
  }


  return {
    ...source,

    spy:
      normalizeAsset(
        source.spy
      ),

    qqq:
      normalizeAsset(
        source.qqq
      ),

    iwm:
      normalizeAsset(
        source.iwm
      ),

    index:
      normalizeAsset(
        source.index
      ),

    qqqIndex:
      normalizeAsset(
        source.qqqIndex
      ),

    vix:
      normalizeAsset(
        source.vix
      ),

    rates:
      normalizeAsset(
        source.rates
      ),

    sector:
      normalizeAsset(
        source.sector
      ),
  };
}


/* ============================================================
 * NEWS NORMALIZATION
 *
 * sentiment.js / sentimentClaude.js 결과와
 * contextAgents.js가 요구하는 배열 형태를 연결한다.
 * ============================================================ */

function normalizeNews(
  news = {}
) {
  if (
    Array.isArray(news)
  ) {
    return news;
  }

  if (
    Array.isArray(
      news?.headlines
    )
  ) {
    return news.headlines;
  }

  if (
    Array.isArray(
      news?.articles
    )
  ) {
    return news.articles;
  }

  return [];
}


/* ============================================================
 * NEWS SENTIMENT
 *
 * 기존 sentiment 결과를
 * Agent Engine에 전달하기 위한 보조 정보.
 * ============================================================ */

function newsSentimentScore(
  news = {}
) {
  const value =
    Number(
      news?.score
    );

  if (
    !Number.isFinite(
      value
    )
  ) {
    return 0;
  }

  return clamp(
    value,
    -100,
    100
  );
}


/* ============================================================
 * EVENT EXTRACTION
 *
 * Agent Engine의 EVENT Agent가 사용하는
 * 뉴스 배열을 그대로 사용한다.
 *
 * 이 함수는 별도 점수를 만들지 않는다.
 * ============================================================ */

function eventSummary(
  headlines = []
) {
  const events = [];

  const rules = [
    {
      pattern:
        /earnings|실적|어닝|실적발표/i,

      type:
        'EARNINGS',
    },

    {
      pattern:
        /guidance|outlook|전망|가이던스/i,

      type:
        'GUIDANCE',
    },

    {
      pattern:
        /fomc|fed|federal reserve|연준|금리 결정/i,

      type:
        'FED',
    },

    {
      pattern:
        /cpi|ppi|inflation|물가|소비자물가/i,

      type:
        'INFLATION',
    },

    {
      pattern:
        /payroll|nonfarm|고용|실업률/i,

      type:
        'EMPLOYMENT',
    },

    {
      pattern:
        /fda|approval|승인|임상|clinical trial/i,

      type:
        'FDA',
    },

    {
      pattern:
        /lawsuit|소송|investigation|조사|regulator|규제/i,

      type:
        'REGULATORY',
    },

    {
      pattern:
        /offering|dilution|증자|유상증자|convertible/i,

      type:
        'DILUTION',
    },

    {
      pattern:
        /bankruptcy|파산|default|부도/i,

      type:
        'DISTRESS',
    },

    {
      pattern:
        /merger|acquisition|인수|합병/i,

      type:
        'M&A',
    },

    {
      pattern:
        /upgrade|투자의견 상향/i,

      type:
        'UPGRADE',
    },

    {
      pattern:
        /downgrade|투자의견 하향/i,

      type:
        'DOWNGRADE',
    },
  ];


  for (
    const headline of headlines
  ) {
    const title =
      typeof headline ===
      'string'
        ? headline
        : (
            headline?.title ||
            ''
          );

    if (!title) {
      continue;
    }

    for (
      const rule of rules
    ) {
      if (
        rule.pattern.test(
          title
        )
      ) {
        events.push({
          type:
            rule.type,

          title,
        });

        break;
      }
    }
  }

  return {
    count:
      events.length,

    events:
      events.slice(
        0,
        10
      ),
  };
}


/* ============================================================
 * AGENT SUMMARY
 * ============================================================ */

function summarizeAgents(
  result
) {
  const agents =
    result?.agents || {};

  const names =
    Object.keys(
      agents
    );

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


/* ============================================================
 * REGIME NORMALIZATION
 *
 * agentEngine에서 반환되는 여러 regime 이름을
 * strategy layer의 공통 이름으로 통일한다.
 * ============================================================ */

function normalizeRegime(
  regime
) {
  const value =
    String(
      regime || ''
    ).toUpperCase();

  if (
    value.includes(
      'BULL'
    ) ||
    value ===
      'RISK_ON'
  ) {
    return 'BULL';
  }

  if (
    value.includes(
      'BEAR'
    ) ||
    value ===
      'RISK_OFF'
  ) {
    return 'BEAR';
  }

  if (
    value.includes(
      'HIGH_VOL'
    )
  ) {
    return 'HIGH_VOL';
  }

  if (
    value.includes(
      'COMPRESS'
    ) ||
    value.includes(
      'SQUEEZE'
    )
  ) {
    return 'COMPRESSION';
  }

  if (
    value ===
      'UNKNOWN'
  ) {
    return 'UNKNOWN';
  }

  return 'SIDEWAYS';
}


/* ============================================================
 * RISK NORMALIZATION
 * ============================================================ */

function summarizeRisk(
  result
) {
  const riskAgent =
    result?.agents?.RISK ||
    {};

  const blocked =
    Boolean(
      result?.ensemble
        ?.blocked ||
      riskAgent.blocked
    );

  const riskEvidence =
    riskAgent.evidence ||
    {};

  const reasons =
    Array.isArray(
      riskEvidence.reasons
    )
      ? riskEvidence.reasons
      : [];


  let level =
    'LOW';

  const riskScore =
    safe(
      riskAgent.score,
      0
    );

  if (
    blocked ||
    riskScore <= 20
  ) {
    level =
      'EXTREME';
  } else if (
    riskScore <= 40
  ) {
    level =
      'HIGH';
  } else if (
    riskScore <= 65
  ) {
    level =
      'MEDIUM';
  }


  return {
    blocked,

    level,

    score:
      round(
        riskScore,
        2
      ),

    reasons,

    evidence:
      riskEvidence,
  };
}


/* ============================================================
 * MODE DECISION
 *
 * Agent Engine을 단순히 DAY/SWING 각각 돌린 뒤
 * 그 결과를 다시 독립적으로 판단한다.
 *
 * 중요한 점:
 *
 * DAY BUY와 SWING BUY가 동시에 발생해야
 * 가장 강한 BUY가 된다.
 *
 * DAY만 좋으면 단기 매수.
 *
 * SWING만 좋으면 즉시 추격하지 않고
 * 관심 상태로 둔다.
 * ============================================================ */

function modeDecision(
  result,
  mode
) {
  if (!result) {
    return {
      mode,

      signal: 0,

      decision:
        'WAIT',

      score: 0,

      confidence: 0,

      setup:
        'NONE',

      regime:
        'UNKNOWN',

      reason:
        'Agent 결과 없음',

      risk:
        {
          blocked: true,
          level: 'EXTREME',
        },

      agents:
        {},

      ensemble:
        {},

      summary:
        {
          total: 0,
          bullish: 0,
          bearish: 0,
          neutral: 0,
        },
    };
  }


  const score =
    safe(
      result.score
    );

  const confidence =
    clamp(
      safe(
        result.confidence
      ),
      0,
      100
    );

  const signal =
    Number(
      result.signal
    ) || 0;

  const risk =
    summarizeRisk(
      result
    );

  const summary =
    summarizeAgents(
      result
    );


  let decision =
    'WAIT';


  /*
   * Risk veto.
   */
  if (
    risk.blocked
  ) {
    decision =
      'NO_TRADE';
  }

  /*
   * Agent Engine이 LONG을 판단.
   */
  else if (
    signal === 1 &&
    confidence >= 45
  ) {
    decision =
      'BUY';
  }

  /*
   * Agent Engine이 EXIT.
   */
  else if (
    signal === -1 &&
    confidence >= 35
  ) {
    decision =
      'EXIT';
  }

  /*
   * 강한 하락 score.
   */
  else if (
    score <= -35 &&
    summary.bearish >= 4
  ) {
    decision =
      'EXIT';
  }

  /*
   * 애매한 상황.
   */
  else {
    decision =
      'WAIT';
  }


  return {
    mode,

    signal:
      decision === 'BUY'
        ? 1
        : decision === 'EXIT'
          ? -1
          : 0,

    decision,

    score:
      round(
        score,
        2
      ),

    confidence:
      round(
        confidence,
        1
      ),

    setup:
      result.setup ||
      'NONE',

    regime:
      normalizeRegime(
        result.regime
      ),

    rawRegime:
      result.regime ||
      'UNKNOWN',

    reason:
      result.reason ||
      'Agent 판단',

    risk,

    agents:
      result.agents ||
      {},

    ensemble:
      result.ensemble ||
      {},

    summary,
  };
}


/* ============================================================
 * FINAL JUDGE
 * ============================================================ */

function finalJudge(
  day,
  swing,
  market,
  event,
  news
) {
  /*
   * 가장 먼저 위험을 검사한다.
   *
   * "살 이유"보다
   * "사지 말아야 할 이유"가 우선.
   */

  if (
    day.risk.blocked ||
    swing.risk.blocked
  ) {
    return {
      signal: 0,

      mode:
        'NONE',

      decision:
        'NO_TRADE',

      reason:
        'Risk Agent가 거래를 차단했습니다.',
    };
  }


  /*
   * 극단적인 이벤트 위험.
   */
  const eventCount =
    safe(
      event?.count
    );

  const eventTypes =
    Array.isArray(
      event?.events
    )
      ? event.events.map(
          e => e.type
        )
      : [];

  const severeEvent =
    eventTypes.some(
      type =>
        type ===
          'DISTRESS' ||
        type ===
          'DILUTION' ||
        type ===
          'REGULATORY'
    );


  if (
    severeEvent
  ) {
    return {
      signal: 0,

      mode:
        'NONE',

      decision:
        'NO_TRADE',

      reason:
        '중대한 이벤트 위험으로 신규 진입을 차단했습니다.',
    };
  }


  /*
   * DAY + SWING 동시 상승.
   *
   * 가장 강한 신호.
   */
  if (
    day.decision ===
      'BUY' &&
    swing.decision ===
      'BUY'
  ) {
    return {
      signal: 1,

      mode:
        'DAY+SWING',

      decision:
        'BUY',

      reason:
        'DAY와 SWING Multi-Agent가 동시에 상승 방향에 합의했습니다.',
    };
  }


  /*
   * DAY만 강한 경우.
   */
  if (
    day.decision ===
      'BUY' &&
    swing.decision !==
      'BUY'
  ) {
    /*
     * 시장이 약세면
     * 단기 신호라도 추격을 막는다.
     */
    if (
      market?.regime ===
        'BEAR' &&
      day.confidence <
        65
    ) {
      return {
        signal: 0,

        mode:
          'NONE',

        decision:
          'NO_TRADE',

        reason:
          '단기 상승 신호가 있으나 시장 국면이 약세라 신규 진입을 보류합니다.',
      };
    }

    return {
      signal: 1,

      mode:
        'DAY',

      decision:
        'DAY_BUY',

      reason:
        '단기 Multi-Agent가 상승을 확인했지만 SWING 확인은 부족합니다.',
    };
  }


  /*
   * SWING만 좋은 경우.
   *
   * 바로 사지 않는다.
   * 단기 timing이 좋아질 때까지 대기.
   */
  if (
    swing.decision ===
      'BUY' &&
    day.decision !==
      'BUY'
  ) {
    return {
      signal: 0,

      mode:
        'SWING',

      decision:
        'SWING_WAIT',

      reason:
        '중기 Multi-Agent는 긍정적이지만 현재 단기 진입 조건이 부족합니다.',
    };
  }


  /*
   * 양쪽 모두 EXIT.
   */
  if (
    day.decision ===
      'EXIT' &&
    swing.decision ===
      'EXIT'
  ) {
    return {
      signal: -1,

      mode:
        'DAY+SWING',

      decision:
        'EXIT',

      reason:
        'DAY와 SWING Multi-Agent가 모두 하락 방향으로 전환했습니다.',
    };
  }


  /*
   * 강한 단기 하락.
   */
  if (
    day.decision ===
      'EXIT'
  ) {
    return {
      signal: -1,

      mode:
        'DAY',

      decision:
        'EXIT',

      reason:
        '단기 Multi-Agent에서 추세 및 위험 신호가 악화되었습니다.',
    };
  }


  /*
   * 뉴스가 매우 나쁜데
   * 기술적으로만 상승하는 경우.
   */
  if (
    newsSentimentScore(
      news
    ) <= -60
  ) {
    return {
      signal: 0,

      mode:
        'NONE',

      decision:
        'NO_TRADE',

      reason:
        '기술적 신호와 뉴스 방향이 크게 충돌합니다.',
    };
  }


  /*
   * 시장 Risk-Off + 이벤트.
   */
  if (
    market?.regime ===
      'BEAR' &&
    eventCount >= 2
  ) {
    return {
      signal: 0,

      mode:
        'NONE',

      decision:
        'NO_TRADE',

      reason:
        '시장 약세와 이벤트 위험이 동시에 존재합니다.',
    };
  }


  return {
    signal: 0,

    mode:
      'NONE',

    decision:
      'WAIT',

    reason:
      'Multi-Agent 사이에 충분한 합의가 없습니다.',
  };
}


/* ============================================================
 * EXECUTION PLAN
 *
 * Agent가 BUY라고 했더라도
 * 실제 진입가격에서 위험/보상 구조가 나쁘면
 * 거래하지 않는다.
 * ============================================================ */

function executionPlan({
  price,
  day,
  swing,
  risk,
}) {
  const p =
    safe(
      price
    );

  const dayAtr =
    safe(
      day
        ?.agents
        ?.VOLATILITY
        ?.evidence
        ?.atr
    );

  const swingAtr =
    safe(
      swing
        ?.agents
        ?.VOLATILITY
        ?.evidence
        ?.atr
    );


  /*
   * Agent 결과에 ATR이 없는 경우
   * risk evidence에서 보조.
   */
  const riskAtr =
    safe(
      day
        ?.risk
        ?.evidence
        ?.atrPct
    );


  let atr =
    dayAtr ||
    swingAtr;


  /*
   * agentEngine의 indicators가
   * 직접 전달되지 않는 경우
   * RISK evidence를 사용할 수 있도록 한다.
   */
  if (
    !atr &&
    riskAtr &&
    p
  ) {
    atr =
      p *
      (
        riskAtr /
        100
      );
  }


  if (
    !p ||
    !atr
  ) {
    return {
      available:
        false,

      reason:
        'ATR 기반 실행계획 계산에 필요한 데이터가 부족합니다.',
    };
  }


  /*
   * DAY:
   *
   * 1.25 ATR stop
   * 2.25 ATR target
   */
  const dayStop =
    p -
    atr * 1.25;

  const dayTarget =
    p +
    atr * 2.25;


  /*
   * SWING:
   *
   * 2 ATR stop
   * 3.5 ATR target
   */
  const swingStop =
    p -
    atr * 2;

  const swingTarget =
    p +
    atr * 3.5;


  const dayRisk =
    p -
    dayStop;

  const dayReward =
    dayTarget -
    p;

  const swingRisk =
    p -
    swingStop;

  const swingReward =
    swingTarget -
    p;


  const dayRR =
    dayRisk > 0
      ? dayReward /
        dayRisk
      : 0;

  const swingRR =
    swingRisk > 0
      ? swingReward /
        swingRisk
      : 0;


  let riskFraction =
    0;


  if (
    day.decision ===
      'BUY' &&
    swing.decision ===
      'BUY'
  ) {
    riskFraction =
      0.01;
  } else if (
    day.decision ===
      'BUY'
  ) {
    riskFraction =
      0.0075;
  } else if (
    swing.decision ===
      'BUY'
  ) {
    riskFraction =
      0.006;
  }


  if (
    risk.level ===
    'HIGH'
  ) {
    riskFraction *=
      0.5;
  }


  if (
    risk.level ===
      'EXTREME' ||
    risk.blocked
  ) {
    riskFraction =
      0;
  }


  return {
    available:
      true,

    entry:
      round(
        p,
        4
      ),

    atr:
      round(
        atr,
        4
      ),

    day: {
      entry:
        round(
          p,
          4
        ),

      stop:
        round(
          dayStop,
          4
        ),

      target:
        round(
          dayTarget,
          4
        ),

      riskReward:
        round(
          dayRR,
          2
        ),
    },

    swing: {
      entry:
        round(
          p,
          4
        ),

      stop:
        round(
          swingStop,
          4
        ),

      target:
        round(
          swingTarget,
          4
        ),

      riskReward:
        round(
          swingRR,
          2
        ),
    },

    riskFraction:
      round(
        riskFraction,
        4
      ),
  };
}


/* ============================================================
 * FINAL CONFIDENCE
 * ============================================================ */

function calculateFinalConfidence({
  day,
  swing,
  final,
  market,
  news,
  event,
}) {
  const dayConfidence =
    safe(
      day.confidence
    );

  const swingConfidence =
    safe(
      swing.confidence
    );


  let confidence =
    Math.max(
      dayConfidence,
      swingConfidence
    );


  /*
   * DAY + SWING agreement.
   */
  if (
    day.decision ===
      'BUY' &&
    swing.decision ===
      'BUY'
  ) {
    confidence +=
      12;
  }


  /*
   * 두 시간축이 완전히 충돌하면
   * confidence를 낮춘다.
   */
  if (
    day.decision ===
      'BUY' &&
    swing.decision ===
      'EXIT'
  ) {
    confidence *=
      0.55;
  }


  if (
    day.decision ===
      'EXIT' &&
    swing.decision ===
      'BUY'
  ) {
    confidence *=
      0.65;
  }


  /*
   * 시장이 반대 방향이면
   * 신규 BUY confidence를 낮춘다.
   */
  if (
    final.signal === 1 &&
    market?.regime ===
      'BEAR'
  ) {
    confidence *=
      0.75;
  }


  /*
   * 매우 강한 뉴스 악재.
   */
  if (
    final.signal === 1 &&
    newsSentimentScore(
      news
    ) <= -50
  ) {
    confidence *=
      0.65;
  }


  /*
   * 이벤트.
   */
  const eventRisk =
    safe(
      event?.count
    );

  if (
    final.signal === 1 &&
    eventRisk >= 3
  ) {
    confidence *=
      0.75;
  }


  return round(
    clamp(
      confidence,
      0,
      100
    ),
    1
  );
}


/* ============================================================
 * MAIN
 * ============================================================ */

function evaluateStrategy(
  input = {}
) {
  const {
    ticker,
    price,

    dailyBars =
      [],

    intradayBars =
      [],

    quantDay =
      null,

    quantSwing =
      null,

    news =
      {},

    market =
      {},

    sector =
      {},
  } = input;


  /*
   * ----------------------------------------------------------
   * Normalize input
   * ----------------------------------------------------------
   */

  const normalizedDaily =
    Array.isArray(
      dailyBars
    )
      ? dailyBars
      : barsFromData(
          dailyBars
        );


  const normalizedIntraday =
    Array.isArray(
      intradayBars
    )
      ? intradayBars
      : barsFromData(
          intradayBars
        );


  const normalizedMarket =
    normalizeMarket(
      market
    );


  const headlines =
    normalizeNews(
      news
    );


  /*
   * ----------------------------------------------------------
   * Event summary
   * ----------------------------------------------------------
   */

  const event =
    eventSummary(
      headlines
    );


  /*
   * ----------------------------------------------------------
   * DAY AGENT ENGINE
   *
   * 장중 데이터가 충분하면
   * intraday를 우선 사용.
   * ----------------------------------------------------------
   */

  const dayBars =
    normalizedIntraday.length >=
      100
      ? normalizedIntraday
      : normalizedDaily;


  const dayResult =
    runAgentEngine({
      bars:
        dayBars,

      market:
        normalizedMarket,

      sector:
        {
          ...sector,

          bars:
            barsFromData(
              sector
            ),
        },

      news:
        headlines,

      earnings:
        input.earnings ||
        {},

      account:
        input.account ||
        {},

      position:
        input.position ||
        {},
    });


  /*
   * ----------------------------------------------------------
   * SWING AGENT ENGINE
   *
   * 일봉은 별도의 판단.
   * ----------------------------------------------------------
   */

  const swingResult =
    runAgentEngine({
      bars:
        normalizedDaily,

      market:
        normalizedMarket,

      sector:
        {
          ...sector,

          bars:
            barsFromData(
              sector
            ),
        },

      news:
        headlines,

      earnings:
        input.earnings ||
        {},

      account:
        input.account ||
        {},

      position:
        input.position ||
        {},
    });


  /*
   * ----------------------------------------------------------
   * Mode decisions
   * ----------------------------------------------------------
   */

  const day =
    modeDecision(
      dayResult,
      'DAY'
    );


  const swing =
    modeDecision(
      swingResult,
      'SWING'
    );


  /*
   * ----------------------------------------------------------
   * Market
   * ----------------------------------------------------------
   */

  const marketAgent =
    dayResult
      ?.agents
      ?.MARKET_REGIME ||
    swingResult
      ?.agents
      ?.MARKET_REGIME ||
    {};


  const marketRegime =
    normalizeRegime(
      dayResult?.regime ||
      swingResult?.regime
    );


  const marketSummary =
    {
      regime:
        marketRegime,

      rawRegime:
        dayResult?.regime ||
        swingResult?.regime ||
        'UNKNOWN',

      score:
        round(
          safe(
            marketAgent.score
          ),
          2
        ),

      confidence:
        round(
          normalizeConfidence(
            marketAgent.confidence
          ) * 100,
          1
        ),

      evidence:
        marketAgent.evidence ||
        {},
    };


  /*
   * ----------------------------------------------------------
   * News summary
   * ----------------------------------------------------------
   */

  const newsScore =
    newsSentimentScore(
      news
    );


  const newsSummary =
    {
      score:
        round(
          newsScore,
          1
        ),

      confidence:
        round(
          normalizeConfidence(
            news?.confidence
          ) * 100,
          1
        ),

      source:
        news?.source ||
        'unknown',

      detail:
        news?.detail ||
        null,

      headlines:
        headlines,

      event,
    };


  /*
   * ----------------------------------------------------------
   * Sector
   * ----------------------------------------------------------
   */

  const sectorAgentResult =
    dayResult
      ?.agents
      ?.SECTOR ||
    swingResult
      ?.agents
      ?.SECTOR ||
    {};


  const sectorSummary =
    {
      score:
        round(
          safe(
            sectorAgentResult.score
          ),
          1
        ),

      confidence:
        round(
          normalizeConfidence(
            sectorAgentResult
              .confidence
          ) * 100,
          1
        ),

      evidence:
        sectorAgentResult
          .evidence ||
        {},
    };


  /*
   * ----------------------------------------------------------
   * Risk
   * ----------------------------------------------------------
   */

  const dayRisk =
    day.risk;

  const swingRisk =
    swing.risk;


  let finalRiskLevel =
    'LOW';


  if (
    dayRisk.level ===
      'EXTREME' ||
    swingRisk.level ===
      'EXTREME'
  ) {
    finalRiskLevel =
      'EXTREME';
  } else if (
    dayRisk.level ===
      'HIGH' ||
    swingRisk.level ===
      'HIGH'
  ) {
    finalRiskLevel =
      'HIGH';
  } else if (
    dayRisk.level ===
      'MEDIUM' ||
    swingRisk.level ===
      'MEDIUM'
  ) {
    finalRiskLevel =
      'MEDIUM';
  }


  const finalRisk =
    {
      level:
        finalRiskLevel,

      blocked:
        dayRisk.blocked ||
        swingRisk.blocked,

      day:
        dayRisk,

      swing:
        swingRisk,

      event,
    };


  /*
   * ----------------------------------------------------------
   * Final Judge
   * ----------------------------------------------------------
   */

  const final =
    finalJudge(
      day,
      swing,
      {
        regime:
          marketRegime,

        score:
          marketSummary.score,
      },
      event,
      news
    );


  /*
   * ----------------------------------------------------------
   * Execution
   * ----------------------------------------------------------
   */

  const execution =
    executionPlan({
      price,

      day,

      swing,

      risk:
        finalRisk,
    });


  /*
   * ----------------------------------------------------------
   * Confidence
   * ----------------------------------------------------------
   */

  const finalConfidence =
    calculateFinalConfidence({
      day,

      swing,

      final,

      market:
        {
          regime:
            marketRegime,
        },

      news,

      event,
    });


  /*
   * ----------------------------------------------------------
   * Agent counts
   * ----------------------------------------------------------
   */

  const daySummary =
    summarizeAgents(
      dayResult
    );


  const swingSummary =
    summarizeAgents(
      swingResult
    );


  /*
   * ----------------------------------------------------------
   * Final reason
   * ----------------------------------------------------------
   */

  let reason =
    final.reason;


  if (
    final.decision ===
    'BUY'
  ) {
    reason =
      `DAY + SWING Multi-Agent 합의: ${
        day.setup !== 'NONE'
          ? day.setup
          : swing.setup
      }`;
  }


  if (
    final.decision ===
    'DAY_BUY'
  ) {
    reason =
      `단기 Multi-Agent 상승 합의: ${
        day.setup
      }`;
  }


  if (
    final.decision ===
    'SWING_WAIT'
  ) {
    reason =
      `스윙 구조는 긍정적이지만 단기 진입 타이밍 부족: ${
        swing.setup
      }`;
  }


  if (
    final.decision ===
    'EXIT'
  ) {
    reason =
      'Multi-Agent가 기존 상승 thesis의 훼손을 확인했습니다.';
  }


  if (
    final.decision ===
    'NO_TRADE'
  ) {
    reason =
      final.reason;
  }


  /*
   * ----------------------------------------------------------
   * Return
   * ----------------------------------------------------------
   */

  return {
    ticker,

    signal:
      final.signal,

    mode:
      final.mode,

    decision:
      final.decision,

    reason,

    confidence:
      finalConfidence,

    regime:
      marketRegime,

    /*
     * DAY.
     */
    day: {
      ...day,

      agentCount:
        daySummary.total,

      bullishAgents:
        daySummary.bullish,

      bearishAgents:
        daySummary.bearish,
    },

    /*
     * SWING.
     */
    swing: {
      ...swing,

      agentCount:
        swingSummary.total,

      bullishAgents:
        swingSummary.bullish,

      bearishAgents:
        swingSummary.bearish,
    },

    /*
     * Context.
     */
    context: {
      market:
        marketSummary,

      sector:
        sectorSummary,

      news:
        newsSummary,

      event,
    },

    /*
     * Risk.
     */
    risk:
      finalRisk,

    /*
     * Execution.
     */
    execution,

    /*
     * Raw engine output.
     *
     * UI나 디버깅에서
     * 각각의 Agent 판단을 확인할 수 있다.
     */
    engines: {
      day:
        dayResult,

      swing:
        swingResult,
    },

    /*
     * Backward-compatible
     * quant information.
     */
    quant: {
      day:
        quantDay
          ? {
              signal:
                quantDay.signal,

              strength:
                quantDay.strength,

              confidence:
                quantDay.confidence,

              setup:
                quantDay.setup,

              reason:
                quantDay.reason,
            }
          : null,

      swing:
        quantSwing
          ? {
              signal:
                quantSwing.signal,

              strength:
                quantSwing.strength,

              confidence:
                quantSwing.confidence,

              setup:
                quantSwing.setup,

              reason:
                quantSwing.reason,
            }
          : null,
    },

    generatedAt:
      new Date().toISOString(),
  };
}


/* ============================================================
 * LEGACY-COMPATIBLE HELPERS
 *
 * 외부 코드가 기존 strategyEngine의
 * export를 사용하더라도 깨지지 않게 유지.
 * ============================================================ */

function eventAgent(
  headlines = []
) {
  return eventSummary(
    headlines
  );
}


function marketAgent(
  market = {}
) {
  const normalized =
    normalizeMarket(
      market
    );

  const index =
    normalized.index;

  const spy =
    normalized.spy;

  const qqq =
    normalized.qqq;

  const iwm =
    normalized.iwm;

  function ret(
    asset,
    period
  ) {
    const closes =
      closesFromBars(
        asset?.bars ||
        asset?.closes ||
        []
      );

    if (
      closes.length <=
      period
    ) {
      return null;
    }

    const current =
      closes.at(-1);

    const previous =
      closes[
        closes.length -
          1 -
          period
      ];

    if (
      !Number.isFinite(
        current
      ) ||
      !Number.isFinite(
        previous
      ) ||
      previous === 0
    ) {
      return null;
    }

    return (
      (
        current -
        previous
      ) /
      previous
    ) * 100;
  }


  const spy20 =
    ret(
      spy,
      20
    );

  const qqq20 =
    ret(
      qqq,
      20
    );

  const iwm20 =
    ret(
      iwm,
      20
    );

  const index20 =
    ret(
      index,
      20
    );


  const values = [
    spy20,
    qqq20,
    iwm20,
    index20,
  ].filter(
    Number.isFinite
  );


  const avg =
    values.length
      ? values.reduce(
          (
            a,
            b
          ) =>
            a + b,
          0
        ) /
        values.length
      : 0;


  let score =
    50 +
    avg * 5;


  const vix =
    safe(
      normalized
        .vix
        ?.currentPrice
    );


  if (
    vix >= 35
  ) {
    score -=
      20;
  } else if (
    vix >= 28
  ) {
    score -=
      10;
  }


  score =
    clamp(
      score,
      0,
      100
    );


  let regime =
    'NEUTRAL';


  if (
    score >= 68
  ) {
    regime =
      'RISK_ON';
  } else if (
    score <= 32
  ) {
    regime =
      'RISK_OFF';
  }


  return {
    name:
      'MARKET',

    score:
      round(
        score,
        1
      ),

    bias:
      round(
        score - 50,
        1
      ),

    regime,

    vix:
      vix ||
      null,

    returns: {
      spy20:
        round(
          spy20,
          2
        ),

      qqq20:
        round(
          qqq20,
          2
        ),

      iwm20:
        round(
          iwm20,
          2
        ),

      index20:
        round(
          index20,
          2
        ),
    },
  };
}


function sectorAgent(
  stockBars = [],
  sectorBars = [],
  marketBars = []
) {
  const stock =
    closesFromBars(
      stockBars
    );

  const sector =
    closesFromBars(
      sectorBars
    );

  const market =
    closesFromBars(
      marketBars
    );


  function ret(
    values,
    period
  ) {
    if (
      values.length <=
      period
    ) {
      return null;
    }

    const current =
      values.at(-1);

    const previous =
      values[
        values.length -
          1 -
          period
      ];

    if (
      previous === 0
    ) {
      return null;
    }

    return (
      (
        current -
        previous
      ) /
      previous
    ) * 100;
  }


  const stock20 =
    ret(
      stock,
      20
    );

  const sector20 =
    ret(
      sector,
      20
    );

  const market20 =
    ret(
      market,
      20
    );


  let score =
    50;


  if (
    Number.isFinite(
      sector20
    )
  ) {
    score +=
      sector20 * 3;
  }


  if (
    Number.isFinite(
      stock20
    ) &&
    Number.isFinite(
      sector20
    )
  ) {
    score +=
      (
        stock20 -
        sector20
      ) * 5;
  }


  if (
    Number.isFinite(
      sector20
    ) &&
    Number.isFinite(
      market20
    )
  ) {
    score +=
      (
        sector20 -
        market20
      ) * 2;
  }


  score =
    clamp(
      score,
      0,
      100
    );


  return {
    name:
      'SECTOR',

    score:
      round(
        score,
        1
      ),

    bias:
      round(
        score - 50,
        1
      ),

    relative: {
      stock20:
        round(
          stock20,
          2
        ),

      sector20:
        round(
          sector20,
          2
        ),

      market20:
        round(
          market20,
          2
        ),
    },
  };
}


function newsAgent(
  news = {},
  event = {}
) {
  const score =
    newsSentimentScore(
      news
    );


  let bias =
    score / 2;


  if (
    event.count >= 3 &&
    Math.abs(score) <
      30
  ) {
    bias -=
      10;
  }


  return {
    name:
      'NEWS',

    rawScore:
      round(
        score,
        1
      ),

    bias:
      round(
        bias,
        1
      ),

    source:
      news.source ||
      'unknown',

    detail:
      news.detail ||
      null,

    headlines:
      normalizeNews(
        news
      ),
  };
}


function riskAgent(
  price,
  atr,
  market,
  event,
  quant,
  mode
) {
  const p =
    safe(
      price
    );

  const a =
    safe(
      atr
    );


  let risk =
    20;

  const reasons =
    [];


  if (
    p > 0 &&
    a > 0
  ) {
    const atrPct =
      a / p;


    if (
      atrPct > 0.05
    ) {
      risk +=
        40;

      reasons.push(
        'EXTREME_ATR'
      );
    } else if (
      atrPct > 0.035
    ) {
      risk +=
        25;

      reasons.push(
        'HIGH_ATR'
      );
    }
  }


  if (
    market?.regime ===
      'RISK_OFF'
  ) {
    risk +=
      20;

    reasons.push(
      'MARKET_RISK_OFF'
    );
  }


  if (
    event?.count >= 3
  ) {
    risk +=
      mode === 'DAY'
        ? 25
        : 15;

    reasons.push(
      'EVENT_RISK'
    );
  }


  if (
    quant?.signal ===
      -1
  ) {
    risk +=
      15;

    reasons.push(
      'QUANT_EXIT'
    );
  }


  risk =
    clamp(
      risk,
      0,
      100
    );


  return {
    name:
      'RISK',

    score:
      round(
        100 - risk,
        1
      ),

    risk:
      round(
        risk,
        1
      ),

    level:
      risk >= 70
        ? 'EXTREME'
        : risk >= 50
          ? 'HIGH'
          : risk >= 30
            ? 'MEDIUM'
            : 'LOW',

    blocked:
      risk >= 75,

    reasons,
  };
}


/* ============================================================
 * EXPORTS
 * ============================================================ */

module.exports = {
  evaluateStrategy,

  eventAgent,

  marketAgent,

  sectorAgent,

  newsAgent,

  riskAgent,
};
