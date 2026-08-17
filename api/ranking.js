// api/rankings.js
//
// CLAU2 MARKET RANKINGS
//
// 기존 /api/scan 결과를 재사용하여
// 증권사식 종목 순위를 제공한다.
//
// 지원:
//   popular
//   volume
//   gainers
//   losers
//   ai
//   confidence
//
// market:
//   us
//   kr
//   all
//
// limit:
//   기본 20
//   최대 100
//

const {
  guard,
} = require('../lib/auth');

const {
  scanUniverse,
} = require('../lib/signalEngine');

const {
  FULL_UNIVERSE,
  US_UNIVERSE,
  KR_UNIVERSE,
} = require('../lib/universe');

const {
  getOrCreate,
} = require('../lib/scanCache');


/* ============================================================
 * CONSTANTS
 * ============================================================ */

const MAX_LIMIT = 100;

const DEFAULT_LIMIT = 20;


/* ============================================================
 * MARKET
 * ============================================================ */

function normalizeMarket(
  value
) {
  const market =
    String(
      value || ''
    )
      .trim()
      .toLowerCase();

  if (
    market === 'us' ||
    market === 'kr' ||
    market === 'all'
  ) {
    return market;
  }

  return 'all';
}


function selectUniverse(
  market
) {
  if (
    market === 'us'
  ) {
    return US_UNIVERSE;
  }

  if (
    market === 'kr'
  ) {
    return KR_UNIVERSE;
  }

  return FULL_UNIVERSE;
}


/* ============================================================
 * TYPE
 * ============================================================ */

function normalizeType(
  value
) {
  const type =
    String(
      value || 'popular'
    )
      .trim()
      .toLowerCase();

  const allowed = [
    'popular',
    'volume',
    'gainers',
    'losers',
    'ai',
    'confidence',
  ];

  if (
    allowed.includes(
      type
    )
  ) {
    return type;
  }

  return 'popular';
}


/* ============================================================
 * LIMIT
 * ============================================================ */

function normalizeLimit(
  value
) {
  const n =
    Number(
      value
    );

  if (
    !Number.isFinite(n)
  ) {
    return DEFAULT_LIMIT;
  }

  return Math.max(
    1,
    Math.min(
      MAX_LIMIT,
      Math.floor(n)
    )
  );
}


/* ============================================================
 * NUMBER
 * ============================================================ */

function number(
  value,
  fallback = 0
) {
  const n =
    Number(
      value
    );

  return Number.isFinite(n)
    ? n
    : fallback;
}


/* ============================================================
 * PERCENT
 * ============================================================ */

function changePercent(
  item
) {
  const direct =
    Number(
      item?.changePct
    );

  if (
    Number.isFinite(
      direct
    )
  ) {
    return direct;
  }

  const current =
    Number(
      item?.currentPrice
    );

  const previous =
    Number(
      item?.previousClose
    );

  if (
    Number.isFinite(
      current
    ) &&
    Number.isFinite(
      previous
    ) &&
    previous > 0
  ) {
    return (
      (
        current -
        previous
      ) /
      previous
    ) *
    100;
  }

  return 0;
}


/* ============================================================
 * AI SCORE
 * ============================================================ */

function aiScore(
  item
) {
  return number(
    item?.aiScore,
    number(
      item?.combinedScore
    )
  );
}


function aiConfidence(
  item
) {
  return number(
    item?.aiConfidence,
    0
  );
}


/* ============================================================
 * POPULARITY
 * ============================================================ */

function popularityScore(
  item
) {
  /*
   * 현재 universe는 대형주 중심이기 때문에
   * 실제 포털의 "검색량"과 동일한 값은 아니다.
   *
   * 대신:
   *
   * AI 관심도
   * +
   * 등락폭
   * +
   * confidence
   *
   * 를 조합해서 "현재 주목할 종목"을 만든다.
   *
   * 향후 검색량/조회수 데이터가 들어오면
   * 이 값을 교체할 수 있다.
   */

  const score =
    Math.abs(
      changePercent(
        item
      )
    );

  const ai =
    Math.abs(
      aiScore(
        item
      )
    );

  const confidence =
    aiConfidence(
      item
    );

  return (
    score * 0.30 +
    ai * 0.45 +
    confidence * 0.25
  );
}


/* ============================================================
 * VOLUME
 * ============================================================ */

function volumeScore(
  item
) {
  /*
   * 현재 scan 결과에는
   * 거래량/거래대금이 직접 노출되지 않는 경우가 있다.
   *
   * 따라서:
   *
   * 1. tradingValue
   * 2. turnover
   * 3. volume
   *
   * 중 존재하는 값을 사용한다.
   */

  return number(
    item?.tradingValue,
    number(
      item?.turnover,
      number(
        item?.volume,
        0
      )
    )
  );
}


/* ============================================================
 * SIGNAL
 * ============================================================ */

function signalRank(
  item
) {
  const decision =
    String(
      item?.aiStrategy
        ?.decision ||
      ''
    )
      .toUpperCase();

  if (
    decision === 'BUY' ||
    decision === 'DAY_BUY' ||
    decision === 'SWING_BUY'
  ) {
    return 2;
  }

  if (
    decision === 'SWING_WAIT'
  ) {
    return 1;
  }

  if (
    decision === 'WAIT'
  ) {
    return 0;
  }

  if (
    decision === 'EXIT'
  ) {
    return -1;
  }

  if (
    decision === 'NO_TRADE'
  ) {
    return -2;
  }

  return 0;
}


/* ============================================================
 * SERIALIZATION
 * ============================================================ */

function serialize(
  item,
  rank,
  type
) {
  const change =
    changePercent(
      item
    );

  return {
    rank,

    ticker:
      item?.ticker ||
      '',

    label:
      item?.label ||
      item?.ticker ||
      '',

    price:
      item?.currentPrice ??
      null,

    previousClose:
      item?.previousClose ??
      null,

    changePct:
      Number.isFinite(
        change
      )
        ? Number(
            change.toFixed(2)
          )
        : null,

    aiScore:
      Math.round(
        aiScore(
          item
        )
      ),

    aiConfidence:
      Number(
        aiConfidence(
          item
        ).toFixed(1)
      ),

    aiLabel:
      item?.aiLabel ||
      'AI 대기',

    decision:
      item?.aiStrategy
        ?.decision ||
      'WAIT',

    regime:
      item?.aiStrategy
        ?.regime ||
      'UNKNOWN',

    signalColor:
      item?.signalColor ||
      'hold',

    classification:
      item?.classification ||
      '중립',

    upProbability:
      item?.upProbability ??
      null,

    /*
     * 실제 값이 존재하는 경우에만 제공.
     */
    volume:
      item?.volume ??
      item?.currentVolume ??
      null,

    tradingValue:
      item?.tradingValue ??
      item?.turnover ??
      null,

    rankType:
      type,
  };
}


/* ============================================================
 * SORTERS
 * ============================================================ */

function sortItems(
  items,
  type
) {
  const list =
    [...items];


  if (
    type === 'gainers'
  ) {
    return list.sort(
      (
        a,
        b
      ) =>
        changePercent(
          b
        ) -
        changePercent(
          a
        )
    );
  }


  if (
    type === 'losers'
  ) {
    return list.sort(
      (
        a,
        b
      ) =>
        changePercent(
          a
        ) -
        changePercent(
          b
        )
    );
  }


  if (
    type === 'volume'
  ) {
    return list.sort(
      (
        a,
        b
      ) =>
        volumeScore(
          b
        ) -
        volumeScore(
          a
        )
    );
  }


  if (
    type === 'ai'
  ) {
    return list.sort(
      (
        a,
        b
      ) =>
        aiScore(
          b
        ) -
        aiScore(
          a
        )
    );
  }


  if (
    type === 'confidence'
  ) {
    return list.sort(
      (
        a,
        b
      ) =>
        aiConfidence(
          b
        ) -
        aiConfidence(
          a
        )
    );
  }


  /*
   * popular
   */

  return list.sort(
    (
      a,
      b
    ) =>
      popularityScore(
        b
      ) -
      popularityScore(
        a
      )
  );
}


/* ============================================================
 * MAIN
 * ============================================================ */

module.exports = async (
  req,
  res
) => {

  if (
    guard(
      req,
      res
    )
  ) {
    return;
  }


  res.setHeader(
    'Cache-Control',
    'no-store, max-age=0'
  );


  res.setHeader(
    'X-Content-Type-Options',
    'nosniff'
  );


  if (
    req.method !== 'GET'
  ) {
    return res
      .status(405)
      .json({
        ok: false,

        error:
          'GET만 지원합니다.',
      });
  }


  const market =
    normalizeMarket(
      req.query?.market
    );


  const type =
    normalizeType(
      req.query?.type
    );


  const limit =
    normalizeLimit(
      req.query?.limit
    );


  const universe =
    selectUniverse(
      market
    );


  try {

    /*
     * 기존 scan과 동일한 캐시를 사용.
     *
     * 따라서:
     *
     * /api/scan
     * /api/rankings
     *
     * 가 같은 분석 결과를 공유한다.
     */

    const {
      value: result,
      cached,
      deduped,
    } =
      await getOrCreate(
        market,
        () =>
          scanUniverse(
            universe
          )
      );


    const ranked =
      Array.isArray(
        result?.ranked
      )
        ? result.ranked
        : [];


    /*
     * 정상 결과만 사용.
     */

    const valid =
      ranked.filter(
        item =>
          item &&
          item.ticker
      );


    /*
     * 실제 순위.
     */

    const sorted =
      sortItems(
        valid,
        type
      );


    const rows =
      sorted
        .slice(
          0,
          limit
        )
        .map(
          (
            item,
            index
          ) =>
            serialize(
              item,
              index + 1,
              type
            )
        );


    /*
     * AI PICK은
     * AI score가 높은 종목 중
     * 위험한 신호를 우선 제외한다.
     */

    const aiCandidates =
      valid
        .filter(
          item => {

            const decision =
              String(
                item?.aiStrategy
                  ?.decision ||
                ''
              )
                .toUpperCase();

            return (
              decision !==
                'NO_TRADE' &&
              decision !==
                'EXIT'
            );
          }
        )
        .sort(
          (
            a,
            b
          ) => {

            const scoreDiff =
              aiScore(
                b
              ) -
              aiScore(
                a
              );

            if (
              scoreDiff !== 0
            ) {
              return scoreDiff;
            }

            return (
              aiConfidence(
                b
              ) -
              aiConfidence(
                a
              )
            );
          }
        )
        .slice(
          0,
          10
        )
        .map(
          (
            item,
            index
          ) =>
            serialize(
              item,
              index + 1,
              'ai'
            )
        );


    /*
     * 시장 요약.
     */

    const changes =
      valid.map(
        changePercent
      );


    const gainers =
      changes.filter(
        value =>
          value > 0
      ).length;


    const losers =
      changes.filter(
        value =>
          value < 0
      ).length;


    const unchanged =
      Math.max(
        0,
        valid.length -
        gainers -
        losers
      );


    const avgChange =
      changes.length
        ? changes.reduce(
            (
              sum,
              value
            ) =>
              sum +
              number(
                value
              ),
            0
          ) /
          changes.length
        : 0;


    return res
      .status(200)
      .json({

        ok: true,

        market,

        type,

        limit,

        rows,

        aiPicks:
          aiCandidates,

        summary: {

          total:
            valid.length,

          gainers,

          losers,

          unchanged,

          averageChangePct:
            Number(
              avgChange.toFixed(
                2
              )
            ),

          breadth:
            result?.breadth ||
            null,

        },

        generatedAt:
          new Date()
            .toISOString(),

        scan: {
          cached,
          deduped,
        },

      });

  } catch (
    err
  ) {

    console.error(
      '[api/rankings]',
      err
    );


    return res
      .status(500)
      .json({

        ok: false,

        error:
          err?.message ||
          '랭킹 조회 실패',

        type:
          err?.name ||
          'Error',

        market,

        type,

      });

  }

};
