// lib/strategyEngine.js
//
// CLAU Multi-Agent Strategy Engine
//
// DAY + SWING 통합 판단.
//
// 입력:
//   {
//     ticker,
//     price,
//     dailyBars,
//     intradayBars,
//     quantDay,
//     quantSwing,
//     news,
//     market,
//     sector,
//   }
//
// 출력:
//   {
//     signal,
//     mode,
//     confidence,
//     day,
//     swing,
//     risk,
//     context,
//     execution,
//   }
//
// 중요:
// 이 파일은 "예측기"가 아니라
// 여러 정보원을 합쳐서 거래 여부를 판단하는
// 최종 의사결정 레이어다.
//

function clamp(value, min = 0, max = 100) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return min;
  }

  return Math.max(min, Math.min(max, n));
}

function safe(value, fallback = 0) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function round(value, digits = 2) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  const factor = 10 ** digits;

  return (
    Math.round(n * factor) /
    factor
  );
}

function average(values) {
  const valid = values
    .map(Number)
    .filter(Number.isFinite);

  if (!valid.length) {
    return null;
  }

  return (
    valid.reduce(
      (a, b) => a + b,
      0
    ) /
    valid.length
  );
}

function returnOver(values, period) {
  if (
    !Array.isArray(values) ||
    values.length <= period
  ) {
    return null;
  }

  const current =
    Number(
      values[
        values.length - 1
      ]
    );

  const previous =
    Number(
      values[
        values.length -
          1 -
          period
      ]
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
    previous
  );
}

function directionalScore(value) {
  return (
    clamp(value, 0, 100) -
    50
  );
}

/*
 * ============================================================
 * EVENT AGENT
 * ============================================================
 *
 * 뉴스의 방향과 별개로
 * "지금 거래하기 위험한 이벤트인가?"를 판단한다.
 *
 * Earnings 자체가 반드시 악재라는 뜻이 아니다.
 * 다만 DAY 전략에서는 예측 불가능한 gap/volatility 때문에
 * 신규 진입의 위험을 높인다.
 */

const EVENT_RULES = [
  {
    pattern:
      /\bearnings?\b|실적|어닝|분기 실적|실적발표/i,
    risk: 35,
    name: 'EARNINGS',
  },

  {
    pattern:
      /guidance|outlook|전망|가이던스/i,
    risk: 30,
    name: 'GUIDANCE',
  },

  {
    pattern:
      /fomc|fed|federal reserve|금리 결정|연준/i,
    risk: 35,
    name: 'FED',
  },

  {
    pattern:
      /cpi|ppi|inflation|물가|소비자물가|생산자물가/i,
    risk: 35,
    name: 'INFLATION',
  },

  {
    pattern:
      /payroll|nonfarm|고용|실업률|jobs report/i,
    risk: 30,
    name: 'EMPLOYMENT',
  },

  {
    pattern:
      /fda|approval|승인|임상|clinical trial/i,
    risk: 35,
    name: 'FDA',
  },

  {
    pattern:
      /lawsuit|소송|investigation|조사|regulator|규제/i,
    risk: 30,
    name: 'REGULATORY',
  },

  {
    pattern:
      /offering|dilution|증자|유상증자|convertible/i,
    risk: 40,
    name: 'DILUTION',
  },

  {
    pattern:
      /bankruptcy|파산|default|부도/i,
    risk: 55,
    name: 'DISTRESS',
  },

  {
    pattern:
      /merger|acquisition|인수|합병/i,
    risk: 30,
    name: 'M&A',
  },

  {
    pattern:
      /ceo|cfo|resign|사임|교체/i,
    risk: 25,
    name: 'MANAGEMENT',
  },

  {
    pattern:
      /downgrade|투자의견 하향/i,
    risk: 20,
    name: 'DOWNGRADE',
  },

  {
    pattern:
      /upgrade|투자의견 상향/i,
    risk: 15,
    name: 'UPGRADE',
  },
];

function eventAgent(headlines = []) {
  const items = Array.isArray(
    headlines
  )
    ? headlines
    : [];

  let risk = 0;

  const events = [];

  for (
    const headline of items
  ) {
    const title =
      typeof headline ===
      'string'
        ? headline
        : headline?.title || '';

    if (!title) {
      continue;
    }

    for (
      const rule of EVENT_RULES
    ) {
      if (
        rule.pattern.test(title)
      ) {
        risk += rule.risk;

        events.push({
          type: rule.name,
          title,
          risk: rule.risk,
        });

        break;
      }
    }
  }

  /*
   * 여러 뉴스가 같은 이벤트를
   * 중복 반영하지 않도록 상한.
   */
  risk = clamp(
    risk,
    0,
    100
  );

  let level =
    'LOW';

  if (risk >= 70) {
    level = 'EXTREME';
  } else if (risk >= 45) {
    level = 'HIGH';
  } else if (risk >= 20) {
    level = 'MEDIUM';
  }

  return {
    name: 'EVENT',
    risk,
    level,
    count: events.length,
    events: events.slice(0, 8),
  };
}

/*
 * ============================================================
 * MARKET CONTEXT AGENT
 * ============================================================
 */

function marketAgent(market = {}) {
  const spy =
    market.spy || {};

  const qqq =
    market.qqq || {};

  const iwm =
    market.iwm || {};

  const index =
    market.index || {};

  const vix =
    market.vix || {};

  const rates =
    market.rates || {};

  const spyReturn =
    returnOver(
      spy.closes,
      5
    );

  const spy20 =
    returnOver(
      spy.closes,
      20
    );

  const qqqReturn =
    returnOver(
      qqq.closes,
      5
    );

  const qqq20 =
    returnOver(
      qqq.closes,
      20
    );

  const iwm20 =
    returnOver(
      iwm.closes,
      20
    );

  const index20 =
    returnOver(
      index.closes,
      20
    );

  let score = 50;

  /*
   * S&P.
   */
  if (spyReturn !== null) {
    score += clamp(
      spyReturn * 500,
      -12,
      12
    );
  }

  if (spy20 !== null) {
    score += clamp(
      spy20 * 180,
      -12,
      12
    );
  }

  /*
   * Nasdaq.
   */
  if (qqqReturn !== null) {
    score += clamp(
      qqqReturn * 400,
      -10,
      10
    );
  }

  if (qqq20 !== null) {
    score += clamp(
      qqq20 * 150,
      -10,
      10
    );
  }

  /*
   * Small cap confirmation.
   */
  if (iwm20 !== null) {
    score += clamp(
      iwm20 * 100,
      -6,
      6
    );
  }

  /*
   * 한국 시장에서는 KOSPI/KOSDAQ 사용.
   */
  if (index20 !== null) {
    score += clamp(
      index20 * 150,
      -8,
      8
    );
  }

  /*
   * VIX.
   *
   * VIX가 높다고 무조건 SHORT가 아니다.
   * 신규 진입 위험을 증가시키는 방향으로만 반영한다.
   */
  const vixValue =
    safe(
      vix.currentPrice,
      0
    );

  if (vixValue > 35) {
    score -= 18;
  } else if (
    vixValue > 28
  ) {
    score -= 10;
  } else if (
    vixValue < 15 &&
    vixValue > 0
  ) {
    score += 5;
  }

  /*
   * 금리.
   */
  const tenYear =
    safe(
      rates.currentPrice,
      0
    );

  if (tenYear > 5) {
    score -= 8;
  } else if (
    tenYear > 4.5
  ) {
    score -= 4;
  }

  score = clamp(
    score,
    0,
    100
  );

  let regime =
    'NEUTRAL';

  if (
    score >= 70
  ) {
    regime =
      'RISK_ON';
  } else if (
    score <= 30
  ) {
    regime =
      'RISK_OFF';
  } else if (
    score >= 58
  ) {
    regime =
      'MILD_RISK_ON';
  } else if (
    score <= 42
  ) {
    regime =
      'MILD_RISK_OFF';
  }

  return {
    name: 'MARKET',

    score:
      round(score, 1),

    bias:
      round(
        directionalScore(
          score
        ),
        1
      ),

    regime,

    vix:
      vixValue || null,

    tenYear:
      tenYear || null,

    returns: {
      spy5: round(
        spyReturn * 100,
        2
      ),

      spy20: round(
        spy20 * 100,
        2
      ),

      qqq5: round(
        qqqReturn * 100,
        2
      ),

      qqq20: round(
        qqq20 * 100,
        2
      ),

      iwm20: round(
        iwm20 * 100,
        2
      ),

      index20: round(
        index20 * 100,
        2
      ),
    },
  };
}

/*
 * ============================================================
 * SECTOR AGENT
 * ============================================================
 */

function sectorAgent(
  stockBars = [],
  sectorBars = [],
  marketBars = []
) {
  const stock =
    stockBars.map(
      (b) => safe(b.close)
    );

  const sector =
    sectorBars.map(
      (b) => safe(b.close)
    );

  const market =
    marketBars.map(
      (b) => safe(b.close)
    );

  const stock5 =
    returnOver(stock, 5);

  const stock20 =
    returnOver(stock, 20);

  const sector5 =
    returnOver(sector, 5);

  const sector20 =
    returnOver(sector, 20);

  const market20 =
    returnOver(market, 20);

  let score = 50;

  /*
   * 주식 자체 수익률.
   */
  if (stock5 !== null) {
    score += clamp(
      stock5 * 250,
      -10,
      10
    );
  }

  if (stock20 !== null) {
    score += clamp(
      stock20 * 120,
      -10,
      10
    );
  }

  /*
   * 섹터 대비 초과수익.
   */
  if (
    stock5 !== null &&
    sector5 !== null
  ) {
    score += clamp(
      (
        stock5 -
        sector5
      ) * 350,
      -15,
      15
    );
  }

  if (
    stock20 !== null &&
    sector20 !== null
  ) {
    score += clamp(
      (
        stock20 -
        sector20
      ) * 180,
      -12,
      12
    );
  }

  /*
   * 시장 대비.
   */
  if (
    stock20 !== null &&
    market20 !== null
  ) {
    score += clamp(
      (
        stock20 -
        market20
      ) * 100,
      -8,
      8
    );
  }

  score = clamp(
    score,
    0,
    100
  );

  return {
    name: 'SECTOR',

    score:
      round(score, 1),

    bias:
      round(
        directionalScore(
          score
        ),
        1
      ),

    relative: {
      stock5:
        round(
          stock5 * 100,
          2
        ),

      stock20:
        round(
          stock20 * 100,
          2
        ),

      sector5:
        round(
          sector5 * 100,
          2
        ),

      sector20:
        round(
          sector20 * 100,
          2
        ),
    },
  };
}

/*
 * ============================================================
 * NEWS AGENT
 * ============================================================
 */

function newsAgent(
  news = {},
  event
) {
  const score =
    clamp(
      safe(
        news.score,
        0
      ),
      -100,
      100
    );

  const normalized =
    score / 2;

  let adjusted =
    normalized;

  /*
   * 이벤트가 있는데 뉴스 방향이 애매하면
   * 신규 진입을 더 보수적으로 본다.
   */
  if (
    event.risk >= 60 &&
    Math.abs(score) < 35
  ) {
    adjusted -= 12;
  }

  adjusted = clamp(
    adjusted,
    -50,
    50
  );

  return {
    name: 'NEWS',

    rawScore:
      round(score, 1),

    bias:
      round(adjusted, 1),

    source:
      news.source ||
      'unknown',

    detail:
      news.detail ||
      null,

    headlines:
      news.headlines ||
      [],
  };
}

/*
 * ============================================================
 * RISK AGENT
 * ============================================================
 */

function riskAgent(
  price,
  atr,
  market,
  event,
  quant,
  mode
) {
  let risk = 20;

  const reasons = [];

  const atrPct =
    price > 0 && atr > 0
      ? atr / price
      : 0;

  /*
   * 변동성.
   */
  if (
    atrPct > 0.05
  ) {
    risk += 35;

    reasons.push(
      'EXTREME_ATR'
    );
  } else if (
    atrPct > 0.035
  ) {
    risk += 22;

    reasons.push(
      'HIGH_ATR'
    );
  } else if (
    atrPct > 0.025
  ) {
    risk += 10;
  }

  /*
   * 시장 위험.
   */
  if (
    market.regime ===
    'RISK_OFF'
  ) {
    risk += 22;

    reasons.push(
      'MARKET_RISK_OFF'
    );
  } else if (
    market.regime ===
    'MILD_RISK_OFF'
  ) {
    risk += 10;
  }

  /*
   * 이벤트.
   */
  if (
    event.risk >= 75
  ) {
    risk +=
      mode === 'DAY'
        ? 28
        : 18;

    reasons.push(
      'MAJOR_EVENT'
    );
  } else if (
    event.risk >= 50
  ) {
    risk +=
      mode === 'DAY'
        ? 18
        : 10;

    reasons.push(
      'EVENT_RISK'
    );
  }

  /*
   * Quant 자체가 EXIT이면
   * 위험을 높인다.
   */
  if (
    quant?.signal === -1
  ) {
    risk += 18;

    reasons.push(
      'QUANT_EXIT'
    );
  }

  /*
   * VIX 극단.
   */
  if (
    market.vix >= 35
  ) {
    risk += 15;

    reasons.push(
      'VIX_EXTREME'
    );
  }

  risk = clamp(
    risk,
    0,
    100
  );

  let level =
    'LOW';

  if (risk >= 70) {
    level =
      'EXTREME';
  } else if (
    risk >= 50
  ) {
    level =
      'HIGH';
  } else if (
    risk >= 30
  ) {
    level =
      'MEDIUM';
  }

  return {
    name: 'RISK',

    score:
      round(
        100 - risk,
        1
      ),

    risk:
      round(risk, 1),

    level,

    blocked:
      risk >= 72,

    atrPct:
      round(
        atrPct * 100,
        2
      ),

    reasons,
  };
}

/*
 * ============================================================
 * TECHNICAL CONSENSUS
 * ============================================================
 */

function technicalBias(
  quant
) {
  if (!quant) {
    return 0;
  }

  if (
    quant.signal === 1
  ) {
    return clamp(
      quant.strength,
      0,
      100
    ) - 50;
  }

  if (
    quant.signal === -1
  ) {
    return -clamp(
      quant.strength,
      0,
      100
    );
  }

  /*
   * WAIT 상태에서도 strength 자체가
   * 50보다 높은 경우 약한 상승 bias.
   */
  return (
    clamp(
      quant.strength,
      0,
      100
    ) - 50
  );
}

/*
 * ============================================================
 * MODE JUDGE
 * ============================================================
 */

function modeJudge({
  mode,
  quant,
  market,
  sector,
  news,
  event,
  risk,
}) {
  const technical =
    technicalBias(
      quant
    );

  let score = 50;

  if (
    mode === 'DAY'
  ) {
    /*
     * DAY:
     * 기술 + 시장 + 뉴스 + 이벤트 + 리스크
     */
    score +=
      technical * 0.42;

    score +=
      market.bias * 0.20;

    score +=
      sector.bias * 0.13;

    score +=
      news.bias * 0.15;

    /*
     * 이벤트는 방향보다는
     * risk penalty로 처리.
     */
    score -=
      event.risk * 0.08;

    score +=
      (
        risk.score - 50
      ) * 0.18;
  } else {
    /*
     * SWING:
     * 일봉 기술 + 시장 + 섹터 + 뉴스.
     *
     * DAY보다 뉴스/시장 구조를 조금 더 중시.
     */
    score +=
      technical * 0.38;

    score +=
      market.bias * 0.22;

    score +=
      sector.bias * 0.18;

    score +=
      news.bias * 0.16;

    score -=
      event.risk * 0.04;

    score +=
      (
        risk.score - 50
      ) * 0.12;
  }

  score = clamp(
    score,
    0,
    100
  );

  /*
   * 서로 다른 정보원들이 같은 방향인지 검사.
   */
  const opinions = [
    technical,
    market.bias,
    sector.bias,
    news.bias,
  ];

  const bullish =
    opinions.filter(
      (x) => x >= 12
    ).length;

  const bearish =
    opinions.filter(
      (x) => x <= -12
    ).length;

  const conflict =
    bullish > 0 &&
    bearish > 0;

  const agreement =
    opinions.length
      ? Math.max(
          bullish,
          bearish
        ) /
        opinions.length
      : 0;

  let confidence =
    45 +
    Math.abs(
      score - 50
    ) * 1.05;

  confidence *=
    0.75 +
    agreement * 0.35;

  if (conflict) {
    confidence *=
      0.72;
  }

  if (
    event.risk >= 70
  ) {
    confidence *=
      0.78;
  }

  confidence =
    clamp(
      confidence,
      0,
      100
    );

  let decision =
    'WAIT';

  if (
    risk.blocked
  ) {
    decision =
      'NO_TRADE';
  } else if (
    score >= 68 &&
    confidence >= 60 &&
    bullish >= 2 &&
    bearish <= 1
  ) {
    decision =
      'BUY';
  } else if (
    score <= 35 &&
    confidence >= 58 &&
    bearish >= 2
  ) {
    decision =
      'EXIT';
  } else if (
    score < 45
  ) {
    decision =
      'NO_TRADE';
  }

  return {
    mode,

    score:
      round(score, 1),

    confidence:
      round(
        confidence,
        1
      ),

    decision,

    technical:
      round(
        technical,
        1
      ),

    bullishAgents:
      bullish,

    bearishAgents:
      bearish,

    conflict,

    agreement:
      round(
        agreement * 100,
        1
      ),
  };
}

/*
 * ============================================================
 * EXECUTION / POSITION SIZING
 * ============================================================
 */

function executionPlan({
  price,
  atr,
  day,
  swing,
  risk,
}) {
  const p =
    safe(price);

  const a =
    safe(atr);

  if (
    !p ||
    !a
  ) {
    return {
      available: false,
    };
  }

  /*
   * DAY와 SWING의 손절 폭을 다르게 한다.
   */
  const dayStop =
    p -
    a * 1.25;

  const dayTarget =
    p +
    a * 2.25;

  const swingStop =
    p -
    a * 2.0;

  const swingTarget =
    p +
    a * 3.5;

  const dayRR =
    dayStop < p
      ? (
          dayTarget - p
        ) /
        (p - dayStop)
      : 0;

  const swingRR =
    swingStop < p
      ? (
          swingTarget - p
        ) /
        (p - swingStop)
      : 0;

  /*
   * 실제 포지션 크기는
   * 외부 capital 값을 받아 계산할 수 있도록
   * riskFraction으로 반환.
   */
  let riskFraction =
    0.0075;

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
  } else {
    riskFraction =
      0;
  }

  /*
   * 위험도가 높으면
   * position risk를 줄인다.
   */
  if (
    risk.level ===
    'HIGH'
  ) {
    riskFraction *=
      0.5;
  }

  if (
    risk.level ===
    'EXTREME'
  ) {
    riskFraction = 0;
  }

  return {
    available: true,

    day: {
      entry: round(p, 4),
      stop: round(
        dayStop,
        4
      ),
      target: round(
        dayTarget,
        4
      ),
      riskReward:
        round(dayRR, 2),
    },

    swing: {
      entry: round(p, 4),
      stop: round(
        swingStop,
        4
      ),
      target: round(
        swingTarget,
        4
      ),
      riskReward:
        round(swingRR, 2),
    },

    riskFraction:
      round(
        riskFraction,
        4
      ),
  };
}

/*
 * ============================================================
 * FINAL META JUDGE
 * ============================================================
 */

function finalJudge(
  day,
  swing,
  market,
  event,
  risk
) {
  /*
   * 가장 중요한 것은
   * "사야 하는 이유"보다
   * "사지 말아야 할 이유"를 먼저 검사하는 것.
   */

  if (
    risk.blocked
  ) {
    return {
      signal: 0,
      mode: 'NONE',
      decision:
        'NO_TRADE',
      reason:
        'Risk Gate가 거래를 차단',
    };
  }

  /*
   * DAY + SWING 동시 동의.
   */
  if (
    day.decision ===
      'BUY' &&
    swing.decision ===
      'BUY'
  ) {
    return {
      signal: 1,
      mode: 'DAY+SWING',
      decision:
        'BUY',
      reason:
        'DAY와 SWING이 동시에 상승 합의',
    };
  }

  /*
   * DAY는 강하지만
   * SWING이 중립.
   */
  if (
    day.decision ===
      'BUY' &&
    swing.decision ===
      'WAIT'
  ) {
    return {
      signal: 1,
      mode: 'DAY',
      decision:
        'DAY_BUY',
      reason:
        '단기 상승 기회는 있으나 중기 추세 확인 부족',
    };
  }

  /*
   * SWING은 좋지만
   * 단기 진입 위치가 좋지 않다.
   */
  if (
    swing.decision ===
      'BUY' &&
    (
      day.decision ===
        'WAIT' ||
      day.decision ===
        'NO_TRADE'
    )
  ) {
    return {
      signal: 0,
      mode: 'SWING',
      decision:
        'SWING_WAIT',
      reason:
        '스윙 관점은 긍정적이나 현재 단기 진입 타이밍 부족',
    };
  }

  /*
   * 강한 하락 합의.
   */
  if (
    day.decision ===
      'EXIT' &&
    swing.decision ===
      'EXIT'
  ) {
    return {
      signal: -1,
      mode: 'DAY+SWING',
      decision:
        'EXIT',
      reason:
        'DAY와 SWING 모두 하락 방향',
    };
  }

  /*
   * 시장 자체가 위험하면
   * 애매한 BUY를 제거.
   */
  if (
    market.regime ===
      'RISK_OFF' &&
    event.risk >= 45
  ) {
    return {
      signal: 0,
      mode: 'NONE',
      decision:
        'NO_TRADE',
      reason:
        '시장 Risk-Off + 이벤트 위험',
    };
  }

  return {
    signal: 0,
    mode: 'NONE',
    decision:
      'WAIT',
    reason:
      '정보원 간 합의 부족',
  };
}

/*
 * ============================================================
 * MAIN
 * ============================================================
 */

function evaluateStrategy(input = {}) {
  const {
    ticker,
    price,
    dailyBars = [],
    intradayBars = [],
    quantDay,
    quantSwing,
    news = {},
    market = {},
    sector = {},
  } = input;

  const p =
    safe(price);

  /*
   * 이벤트.
   */
  const event =
    eventAgent(
      news.headlines ||
      []
    );

  /*
   * 시장.
   */
  const marketResult =
    marketAgent(
      market
    );

  /*
   * 섹터.
   */
  const sectorResult =
    sectorAgent(
      dailyBars,
      sector.bars || [],
      market.index?.bars ||
        []
    );

  /*
   * 뉴스.
   */
  const newsResult =
    newsAgent(
      news,
      event
    );

  /*
   * ATR.
   */
  const atrValue =
    safe(
      quantDay?.indicators
        ?.atr,
      quantSwing
        ?.indicators?.atr
    );

  /*
   * DAY risk.
   */
  const dayRisk =
    riskAgent(
      p,
      safe(
        quantDay?.indicators
          ?.atr,
        atrValue
      ),
      marketResult,
      event,
      quantDay,
      'DAY'
    );

  /*
   * SWING risk.
   */
  const swingRisk =
    riskAgent(
      p,
      safe(
        quantSwing?.indicators
          ?.atr,
        atrValue
      ),
      marketResult,
      event,
      quantSwing,
      'SWING'
    );

  /*
   * 각 모드 판단.
   */
  const day =
    modeJudge({
      mode: 'DAY',
      quant:
        quantDay,
      market:
        marketResult,
      sector:
        sectorResult,
      news:
        newsResult,
      event,
      risk:
        dayRisk,
    });

  const swing =
    modeJudge({
      mode: 'SWING',
      quant:
        quantSwing,
      market:
        marketResult,
      sector:
        sectorResult,
      news:
        newsResult,
      event,
      risk:
        swingRisk,
    });

  /*
   * 최종 risk.
   */
  const risk = {
    level:
      dayRisk.level ===
        'EXTREME' ||
      swingRisk.level ===
        'EXTREME'
        ? 'EXTREME'
        : dayRisk.level ===
            'HIGH' ||
          swingRisk.level ===
            'HIGH'
          ? 'HIGH'
          : dayRisk.level ===
              'MEDIUM' ||
            swingRisk.level ===
              'MEDIUM'
            ? 'MEDIUM'
            : 'LOW',

    blocked:
      dayRisk.blocked &&
      swingRisk.blocked,

    day:
      dayRisk,

    swing:
      swingRisk,

    event,
  };

  /*
   * 최종 Judge.
   */
  const final =
    finalJudge(
      day,
      swing,
      marketResult,
      event,
      risk
    );

  /*
   * 실행계획.
   */
  const execution =
    executionPlan({
      price: p,
      atr: atrValue,
      day,
      swing,
      risk,
    });

  /*
   * 최종 confidence.
   */
  let confidence =
    Math.max(
      day.confidence,
      swing.confidence
    );

  if (
    day.decision ===
      'BUY' &&
    swing.decision ===
      'BUY'
  ) {
    confidence += 10;
  }

  if (
    final.signal === 0
  ) {
    confidence *=
      0.8;
  }

  confidence =
    clamp(
      confidence,
      0,
      100
    );

  return {
    ticker,

    signal:
      final.signal,

    mode:
      final.mode,

    decision:
      final.decision,

    reason:
      final.reason,

    confidence:
      round(
        confidence,
        1
      ),

    regime:
      marketResult.regime,

    day,

    swing,

    context: {
      market:
        marketResult,

      sector:
        sectorResult,

      news:
        newsResult,

      event,
    },

    risk,

    execution,

    generatedAt:
      new Date().toISOString(),
  };
}

module.exports = {
  evaluateStrategy,
  eventAgent,
  marketAgent,
  sectorAgent,
  newsAgent,
  riskAgent,
};
