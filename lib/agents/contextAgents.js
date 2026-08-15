function clamp(v, min = -100, max = 100) {
  return Math.max(min, Math.min(max, Number(v) || 0));
}

function makeAgent(
  name,
  score,
  confidence,
  evidence = {},
  risks = []
) {
  return {
    name,
    direction:
      score > 20
        ? 'LONG'
        : score < -20
          ? 'SHORT'
          : 'NEUTRAL',
    score: clamp(score),
    confidence: Math.max(
      0,
      Math.min(1, confidence)
    ),
    evidence,
    risks,
  };
}

/*
 * 시장 전체 상황.
 *
 * market:
 * {
 *   indexTrend,
 *   breadth,
 *   volatility,
 *   sectorStrength
 * }
 */
function marketRegimeAgent(market = {}) {
  let score = 0;

  const indexTrend =
    Number(market.indexTrend);

  const breadth =
    Number(market.breadth);

  const volatility =
    Number(market.volatility);

  const sectorStrength =
    Number(market.sectorStrength);

  if (Number.isFinite(indexTrend)) {
    score += clamp(indexTrend, -40, 40);
  }

  if (Number.isFinite(breadth)) {
    score += clamp(breadth * 0.35, -25, 25);
  }

  if (Number.isFinite(sectorStrength)) {
    score += clamp(sectorStrength * 0.25, -20, 20);
  }

  if (Number.isFinite(volatility)) {
    if (volatility > 35) score -= 20;
    else if (volatility > 25) score -= 10;
    else if (volatility < 15) score += 5;
  }

  return makeAgent(
    'MARKET_REGIME',
    score,
    0.65,
    {
      indexTrend,
      breadth,
      volatility,
      sectorStrength,
    },
    volatility > 35
      ? ['시장 변동성 과다']
      : []
  );
}

/*
 * 섹터 상대강도.
 */
function sectorAgent(context = {}) {
  const sectorReturn =
    Number(context.sectorReturn);

  const marketReturn =
    Number(context.marketReturn);

  if (
    !Number.isFinite(sectorReturn) ||
    !Number.isFinite(marketReturn)
  ) {
    return makeAgent(
      'SECTOR',
      0,
      0.15
    );
  }

  const relative =
    sectorReturn -
    marketReturn;

  const score =
    clamp(relative * 12);

  return makeAgent(
    'SECTOR',
    score,
    Math.min(
      0.9,
      0.5 + Math.abs(relative) / 10
    ),
    {
      sectorReturn,
      marketReturn,
      relativeStrength: relative,
    }
  );
}

/*
 * 뉴스 Agent.
 *
 * 뉴스 데이터가 없으면
 * 절대 추측하지 않는다.
 */
function newsAgent(news = []) {
  if (!Array.isArray(news) || !news.length) {
    return makeAgent(
      'NEWS',
      0,
      0.05,
      {
        available: false,
      }
    );
  }

  let weighted = 0;
  let totalWeight = 0;
  let eventRisk = 0;

  const now = Date.now();

  for (const item of news) {
    const sentiment =
      Number(item.sentiment);

    if (!Number.isFinite(sentiment)) {
      continue;
    }

    const timestamp =
      item.timestamp
        ? new Date(item.timestamp).getTime()
        : now;

    const ageHours =
      Math.max(
        0,
        (now - timestamp) /
          3600000
      );

    /*
     * 최신 뉴스일수록 영향이 크다.
     */
    const freshness =
      Math.exp(
        -ageHours / 120
      );

    const relevance =
      Number.isFinite(
        Number(item.relevance)
      )
        ? Math.max(
            0,
            Math.min(
              1,
              Number(item.relevance)
            )
          )
        : 1;

    const weight =
      freshness *
      relevance;

    weighted +=
      sentiment *
      weight;

    totalWeight +=
      weight;

    if (
      item.eventRisk === 'HIGH'
    ) {
      eventRisk += weight;
    }
  }

  if (!totalWeight) {
    return makeAgent(
      'NEWS',
      0,
      0.1
    );
  }

  const score =
    clamp(
      weighted /
        totalWeight *
        100
    );

  return makeAgent(
    'NEWS',
    score,
    Math.min(
      0.9,
      0.4 +
        Math.min(
          0.5,
          totalWeight / 10
        )
    ),
    {
      articleCount: news.length,
      weightedSentiment:
        weighted /
        totalWeight,
      eventRisk,
    },
    eventRisk > 1.5
      ? ['중요 이벤트/뉴스 리스크']
      : []
  );
}

/*
 * 실적/기업 이벤트 Agent.
 *
 * 반드시 "그 시점에 이미 공개된 정보"만 넣어야 한다.
 */
function earningsAgent(event = {}) {
  if (!event.available) {
    return makeAgent(
      'EARNINGS',
      0,
      0.05,
      {
        available: false,
      }
    );
  }

  let score = 0;

  const surprise =
    Number(event.epsSurprise);

  const revenueSurprise =
    Number(event.revenueSurprise);

  const guidance =
    Number(event.guidanceScore);

  if (Number.isFinite(surprise)) {
    score += clamp(
      surprise * 12,
      -35,
      35
    );
  }

  if (
    Number.isFinite(
      revenueSurprise
    )
  ) {
    score += clamp(
      revenueSurprise * 8,
      -25,
      25
    );
  }

  if (Number.isFinite(guidance)) {
    score += clamp(
      guidance,
      -30,
      30
    );
  }

  if (event.daysToEarnings != null) {
    const days =
      Number(
        event.daysToEarnings
      );

    /*
     * 실적 직전은 방향보다
     * 불확실성을 높인다.
     */
    if (
      days >= 0 &&
      days <= 2
    ) {
      score *= 0.65;
    }
  }

  return makeAgent(
    'EARNINGS',
    score,
    0.65,
    event,
    event.daysToEarnings >= 0 &&
    event.daysToEarnings <= 2
      ? ['실적 발표 임박']
      : []
  );
}

module.exports = {
  marketRegimeAgent,
  sectorAgent,
  newsAgent,
  earningsAgent,
};
