/*
 * lib/agents/contextAgents.js
 *
 * 시장 / 섹터 / 뉴스 / 실적 / 이벤트 Agent
 */

function clamp(value, min = -100, max = 100) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.max(min, Math.min(max, n));
}

function confidence(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.max(0, Math.min(1, n));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pctChange(current, previous) {
  if (
    current === null ||
    previous === null ||
    previous === 0
  ) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}

function getCloses(data) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((x) => {
      if (typeof x === 'number') {
        return x;
      }

      return Number(
        x?.close ??
        x?.adjClose ??
        x?.price
      );
    })
    .filter(Number.isFinite);
}

function returnOver(closes, period) {
  if (closes.length <= period) {
    return null;
  }

  return pctChange(
    closes.at(-1),
    closes[closes.length - 1 - period]
  );
}


/*
 * ============================================================
 * MARKET REGIME AGENT
 * ============================================================
 */

function marketRegimeAgent(market = {}) {
  const indexCloses =
    getCloses(
      market.index?.bars ||
      market.index?.closes ||
      market.bars ||
      market.closes ||
      []
    );

  const spyCloses =
    getCloses(
      market.spy?.bars ||
      market.spy?.closes ||
      []
    );

  const qqqCloses =
    getCloses(
      market.qqq?.bars ||
      market.qqq?.closes ||
      []
    );

  const iwmCloses =
    getCloses(
      market.iwm?.bars ||
      market.iwm?.closes ||
      []
    );

  const index20 =
    returnOver(indexCloses, 20);

  const spy20 =
    returnOver(spyCloses, 20);

  const qqq20 =
    returnOver(qqqCloses, 20);

  const iwm20 =
    returnOver(iwmCloses, 20);

  const vix =
    num(
      market.vix?.currentPrice ??
      market.vix?.price ??
      market.vix
    );

  let score = 0;

  const signals = [];

  const returns = [
    index20,
    spy20,
    qqq20,
    iwm20,
  ].filter(Number.isFinite);

  if (returns.length) {
    const positive =
      returns.filter(
        (x) => x > 0
      ).length;

    const negative =
      returns.filter(
        (x) => x < 0
      ).length;

    if (positive > negative) {
      score += 35;
      signals.push(
        '시장 중기 상승'
      );
    }

    if (negative > positive) {
      score -= 35;
      signals.push(
        '시장 중기 하락'
      );
    }

    const avg =
      returns.reduce(
        (a, b) => a + b,
        0
      ) / returns.length;

    if (avg > 3) {
      score += 20;
    }

    if (avg < -3) {
      score -= 20;
    }
  }

  /*
   * VIX는 절대적인 매수/매도 지표가 아니라
   * risk regime으로 사용한다.
   */
  let regime = 'SIDEWAYS';

  if (score >= 35) {
    regime = 'BULL';
  } else if (score <= -35) {
    regime = 'BEAR';
  }

  if (
    Number.isFinite(vix) &&
    vix >= 30
  ) {
    regime =
      regime === 'BULL'
        ? 'BULL_HIGH_VOL'
        : 'HIGH_VOL';

    score -= 10;

    signals.push(
      '고변동성'
    );
  } else if (
    Number.isFinite(vix) &&
    vix <= 14
  ) {
    signals.push(
      '저변동성'
    );
  }

  /*
   * breadth.
   */
  const breadth =
    num(market.breadth);

  if (breadth !== null) {
    if (breadth >= 60) {
      score += 15;
      signals.push(
        '시장 breadth 양호'
      );
    }

    if (breadth <= 40) {
      score -= 15;
      signals.push(
        '시장 breadth 약화'
      );
    }
  }

  score =
    clamp(score);

  const agentConfidence =
    returns.length >= 2
      ? 0.8
      : returns.length === 1
        ? 0.55
        : 0.2;

  return {
    name: 'MARKET_REGIME',

    score,

    confidence:
      agentConfidence,

    regime,

    evidence: {
      index20,
      spy20,
      qqq20,
      iwm20,
      vix,
      breadth,
      signals,
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
    getCloses(stockBars);

  const sector =
    getCloses(sectorBars);

  const market =
    getCloses(marketBars);

  if (
    stock.length < 20 ||
    sector.length < 20
  ) {
    return {
      name: 'SECTOR',
      score: 0,
      confidence: 0.15,
      evidence: {
        reason: '섹터 데이터 부족',
      },
    };
  }

  const stock20 =
    returnOver(stock, 20);

  const sector20 =
    returnOver(sector, 20);

  const market20 =
    returnOver(market, 20);

  let score = 0;

  if (
    Number.isFinite(sector20)
  ) {
    if (sector20 > 0) {
      score += 30;
    } else {
      score -= 30;
    }
  }

  /*
   * 종목이 섹터보다 강한가?
   */
  if (
    Number.isFinite(stock20) &&
    Number.isFinite(sector20)
  ) {
    const relative =
      stock20 -
      sector20;

    if (relative > 3) {
      score += 35;
    } else if (relative > 0) {
      score += 15;
    } else if (relative < -3) {
      score -= 35;
    } else {
      score -= 10;
    }
  }

  /*
   * 섹터가 시장보다 강한가?
   */
  if (
    Number.isFinite(sector20) &&
    Number.isFinite(market20)
  ) {
    if (
      sector20 >
      market20
    ) {
      score += 20;
    } else {
      score -= 20;
    }
  }

  return {
    name: 'SECTOR',

    score:
      clamp(score),

    confidence: 0.8,

    evidence: {
      stock20,
      sector20,
      market20,

      relativeStrength:
        Number.isFinite(stock20) &&
        Number.isFinite(sector20)
          ? stock20 - sector20
          : null,
    },
  };
}


/*
 * ============================================================
 * NEWS AGENT
 * ============================================================
 */

function newsAgent(
  news = []
) {
  if (!Array.isArray(news) || !news.length) {
    return {
      name: 'NEWS',
      score: 0,
      confidence: 0.1,
      evidence: {
        articleCount: 0,
      },
    };
  }

  let weightedScore = 0;
  let totalWeight = 0;

  let positive = 0;
  let negative = 0;
  let neutral = 0;

  let severeNegative = false;
  let severePositive = false;

  const now =
    Date.now();

  for (const article of news) {
    const sentiment =
      article.sentiment ||
      article.sentimentLabel ||
      'neutral';

    let value = 0;

    if (
      sentiment === 'positive'
    ) {
      value = 1;
      positive++;
    } else if (
      sentiment === 'negative'
    ) {
      value = -1;
      negative++;
    } else {
      neutral++;
    }

    /*
     * 최신 뉴스일수록 중요.
     */
    const timestamp =
      new Date(
        article.publishedAt ||
        article.pubDate ||
        article.date ||
        0
      ).getTime();

    let ageDays = 5;

    if (
      Number.isFinite(timestamp) &&
      timestamp > 0
    ) {
      ageDays =
        Math.max(
          0,
          (now - timestamp) /
            86400000
        );
    }

    /*
     * 0일 = 1.0
     * 10일 = 약 0.3
     */
    const freshness =
      Math.max(
        0.25,
        1 -
          Math.min(
            ageDays,
            10
          ) *
            0.07
      );

    /*
     * 관련 없는 뉴스는 약하게.
     */
    const relevance =
      article.relevant === false
        ? 0.25
        : Number.isFinite(
            Number(
              article.relevance
            )
          )
          ? Math.max(
              0.2,
              Math.min(
                1,
                Number(
                  article.relevance
                )
              )
            )
          : 1;

    const weight =
      freshness *
      relevance;

    weightedScore +=
      value *
      weight;

    totalWeight +=
      weight;

    /*
     * 시장 충격이 큰 이벤트.
     */
    const text =
      `${article.title || ''} ${
        article.description || ''
      }`.toLowerCase();

    if (
      /bankruptcy|bankrupt|fraud|sec|lawsuit|investigation|offering|dilution|downgrade|recall|layoff/.test(
        text
      )
    ) {
      severeNegative = true;
    }

    if (
      /fda approval|contract win|major contract|acquisition|buyout|upgrade|record revenue|record earnings/.test(
        text
      )
    ) {
      severePositive = true;
    }
  }

  let score =
    totalWeight
      ? (
          weightedScore /
          totalWeight
        ) * 100
      : 0;

  if (severeNegative) {
    score -= 25;
  }

  if (
    severePositive &&
    !severeNegative
  ) {
    score += 15;
  }

  score =
    clamp(score);

  const confidenceValue =
    Math.min(
      1,
      0.35 +
        Math.min(
          news.length,
          10
        ) *
          0.06
    );

  return {
    name: 'NEWS',

    score,

    confidence:
      confidenceValue,

    evidence: {
      articleCount:
        news.length,

      positive,
      negative,
      neutral,

      severeNegative,
      severePositive,
    },
  };
}


/*
 * ============================================================
 * EARNINGS AGENT
 * ============================================================
 */

function earningsAgent(
  earnings = {}
) {
  if (!earnings) {
    return {
      name: 'EARNINGS',
      score: 0,
      confidence: 0.05,
    };
  }

  let score = 0;

  const epsActual =
    num(
      earnings.epsActual ??
      earnings.actualEPS
    );

  const epsEstimate =
    num(
      earnings.epsEstimate ??
      earnings.estimatedEPS
    );

  const revenueActual =
    num(
      earnings.revenueActual
    );

  const revenueEstimate =
    num(
      earnings.revenueEstimate
    );

  const epsSurprise =
    num(
      earnings.epsSurprise
    );

  const revenueSurprise =
    num(
      earnings.revenueSurprise
    );

  if (
    epsSurprise !== null
  ) {
    if (epsSurprise > 5) {
      score += 40;
    } else if (
      epsSurprise > 0
    ) {
      score += 20;
    } else if (
      epsSurprise < -5
    ) {
      score -= 40;
    } else {
      score -= 20;
    }
  } else if (
    epsActual !== null &&
    epsEstimate !== null
  ) {
    const surprise =
      pctChange(
        epsActual,
        Math.abs(
          epsEstimate
        ) || 1
      );

    if (surprise > 5) {
      score += 35;
    } else if (
      surprise > 0
    ) {
      score += 15;
    } else if (
      surprise < -5
    ) {
      score -= 35;
    } else {
      score -= 15;
    }
  }

  if (
    revenueSurprise !== null
  ) {
    if (
      revenueSurprise > 3
    ) {
      score += 25;
    } else if (
      revenueSurprise > 0
    ) {
      score += 10;
    } else if (
      revenueSurprise < -3
    ) {
      score -= 25;
    } else {
      score -= 10;
    }
  } else if (
    revenueActual !== null &&
    revenueEstimate !== null
  ) {
    const surprise =
      pctChange(
        revenueActual,
        Math.abs(
          revenueEstimate
        ) || 1
      );

    if (surprise > 3) {
      score += 25;
    } else if (
      surprise > 0
    ) {
      score += 10;
    } else if (
      surprise < -3
    ) {
      score -= 25;
    } else {
      score -= 10;
    }
  }

  /*
   * 실적 발표 직전은
   * 방향성이 좋아도 진입을 보수적으로 한다.
   */
  const daysToEarnings =
    num(
      earnings.daysToEarnings
    );

  let eventRisk = false;

  if (
    daysToEarnings !== null &&
    daysToEarnings >= 0 &&
    daysToEarnings <= 2
  ) {
    eventRisk = true;

    /*
     * 방향성 점수는 유지하되
     * confidence를 크게 낮춘다.
     */
  }

  return {
    name: 'EARNINGS',

    score:
      clamp(score),

    confidence:
      eventRisk
        ? 0.25
        : (
            epsSurprise !== null ||
            revenueSurprise !== null ||
            epsActual !== null ||
            revenueActual !== null
          )
          ? 0.75
          : 0.1,

    evidence: {
      epsActual,
      epsEstimate,
      revenueActual,
      revenueEstimate,
      epsSurprise,
      revenueSurprise,
      daysToEarnings,
      eventRisk,
    },
  };
}


/*
 * ============================================================
 * EVENT AGENT
 * ============================================================
 */

function eventAgent(
  news = []
) {
  if (
    !Array.isArray(news) ||
    !news.length
  ) {
    return {
      name: 'EVENT',
      score: 0,
      confidence: 0.1,
      blocked: false,
    };
  }

  let score = 0;

  let blocked =
    false;

  const events = [];

  for (const article of news) {
    const text =
      `${article.title || ''} ${
        article.description || ''
      }`.toLowerCase();

    if (
      /offering|dilution|secondary offering|bankruptcy|going concern/.test(
        text
      )
    ) {
      score -= 80;
      blocked = true;

      events.push(
        'capital/risk event'
      );
    }

    if (
      /fraud|sec investigation|criminal investigation|accounting investigation/.test(
        text
      )
    ) {
      score -= 90;
      blocked = true;

      events.push(
        'regulatory/legal event'
      );
    }

    if (
      /fda approval|major contract|acquisition|buyout/.test(
        text
      )
    ) {
      score += 45;

      events.push(
        'major positive event'
      );
    }
  }

  return {
    name: 'EVENT',

    score:
      clamp(score),

    confidence:
      events.length
        ? 0.9
        : 0.1,

    blocked,

    evidence: {
      events,
    },
  };
}


module.exports = {
  marketRegimeAgent,
  sectorAgent,
  newsAgent,
  earningsAgent,
  eventAgent,
};
