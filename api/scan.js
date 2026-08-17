// api/scan.js

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
 * NUMBER
 * ============================================================ */

function num(
  value,
  fallback = 0
) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


/* ============================================================
 * CHANGE
 * ============================================================ */

function changePct(
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
  return num(
    item?.aiScore,
    num(
      item?.combinedScore,
      0
    )
  );
}


function aiConfidence(
  item
) {
  return num(
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
   * 현재 데이터 구조에서
   * 검색량/조회수가 없기 때문에
   * AI 관심도 + 변동성 + confidence를 이용한다.
   *
   * 추후 실제 조회수 데이터가 생기면
   * 이 부분만 교체하면 된다.
   */

  const movement =
    Math.min(
      30,
      Math.abs(
        changePct(
          item
        )
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
    ai * 0.5 +
    confidence * 0.3 +
    movement * 0.2
  );
}


/* ============================================================
 * VOLUME
 * ============================================================ */

function tradingValue(
  item
) {
  return num(
    item?.tradingValue,
    num(
      item?.turnover,
      num(
        item?.tradeValue,
        0
      )
    )
  );
}


function volume(
  item
) {
  return num(
    item?.volume,
    num(
      item?.currentVolume,
      num(
        item?.tradeVolume,
        0
      )
    )
  );
}


/* ============================================================
 * SERIALIZE
 * ============================================================ */

function serialize(
  item,
  rank,
  type
) {
  return {

    rank,

    ticker:
      item?.ticker ||
      '',

    label:
      item?.label ||
      item?.ticker ||
      '',

    currentPrice:
      item?.currentPrice ??
      null,

    previousClose:
      item?.previousClose ??
      null,

    changePct:
      Number(
        changePct(
          item
        ).toFixed(2)
      ),

    aiScore:
      Number(
        aiScore(
          item
        ).toFixed(1)
      ),

    aiConfidence:
      Number(
        aiConfidence(
          item
        ).toFixed(1)
      ),

    aiLabel:
      item?.aiLabel ||
      '',

    decision:
      item?.aiStrategy
        ?.decision ||
      'WAIT',

    regime:
      item?.aiStrategy
        ?.regime ||
      '',

    classification:
      item?.classification ||
      '',

    upProbability:
      item?.upProbability ??
      null,

    volume:
      volume(
        item
      ),

    tradingValue:
      tradingValue(
        item
      ),

    signalColor:
      item?.signalColor ||
      'hold',

    rankType:
      type,

  };
}


/* ============================================================
 * SORT
 * ============================================================ */

function sortBy(
  items,
  type
) {
  const list =
    [...items];


  switch (
    type
  ) {

    case 'gainers':

      return list.sort(
        (
          a,
          b
        ) =>
          changePct(b) -
          changePct(a)
      );


    case 'losers':

      return list.sort(
        (
          a,
          b
        ) =>
          changePct(a) -
          changePct(b)
      );


    case 'volume':

      return list.sort(
        (
          a,
          b
        ) =>
          tradingValue(b) -
          tradingValue(a)
      );


    case 'volume-count':

      return list.sort(
        (
          a,
          b
        ) =>
          volume(b) -
          volume(a)
      );


    case 'ai':

      return list.sort(
        (
          a,
          b
        ) =>
          aiScore(b) -
          aiScore(a)
      );


    case 'confidence':

      return list.sort(
        (
          a,
          b
        ) =>
          aiConfidence(b) -
          aiConfidence(a)
      );


    case 'popular':
    default:

      return list.sort(
        (
          a,
          b
        ) =>
          popularityScore(b) -
          popularityScore(a)
      );

  }
}


/* ============================================================
 * MAKE RANKINGS
 * ============================================================ */

function makeRankings(
  ranked
) {
  const items =
    Array.isArray(
      ranked
    )
      ? ranked.filter(
          item =>
            item &&
            item.ticker
        )
      : [];


  const types = [
    'popular',
    'volume',
    'gainers',
    'losers',
    'volume-count',
    'ai',
    'confidence',
  ];


  const rankings = {};


  for (
    const type of types
  ) {

    rankings[type] =
      sortBy(
        items,
        type
      )
        .slice(
          0,
          100
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

  }


  /*
   * AI PICK
   *
   * NO_TRADE / EXIT는 우선순위에서 제외.
   */

  rankings.aiPicks =
    items
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
            aiScore(b) -
            aiScore(a);

          if (
            scoreDiff !== 0
          ) {
            return scoreDiff;
          }

          return (
            aiConfidence(b) -
            aiConfidence(a)
          );

        }
      )
      .slice(
        0,
        20
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


  return rankings;
}


/* ============================================================
 * SUMMARY
 * ============================================================ */

function makeSummary(
  ranked
) {
  const items =
    Array.isArray(
      ranked
    )
      ? ranked
      : [];


  const changes =
    items.map(
      changePct
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
      items.length -
      gainers -
      losers
    );


  const average =
    changes.length
      ? changes.reduce(
          (
            sum,
            value
          ) =>
            sum +
            value,
          0
        ) /
        changes.length
      : 0;


  return {

    total:
      items.length,

    gainers,

    losers,

    unchanged,

    averageChangePct:
      Number(
        average.toFixed(2)
      ),

  };
}


/* ============================================================
 * HANDLER
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


  const universe =
    selectUniverse(
      market
    );


  try {

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


    const rankings =
      makeRankings(
        ranked
      );


    const summary =
      makeSummary(
        ranked
      );


    /*
     * 기존 scan 결과를 모두 유지한다.
     *
     * 기존 UI가 사용하던
     * breadth / ranked / 기타 필드가
     * 사라지지 않는다.
     */

    return res
      .status(200)
      .json({

        ok: true,

        ...result,

        rankings,

        summary,

        generatedAt:
          new Date()
            .toISOString(),

        market,

        scan: {

          cached,

          deduped,

        },

      });


  } catch (
    err
  ) {

    console.error(
      '[api/scan]',
      err
    );


    return res
      .status(500)
      .json({

        ok: false,

        error:
          err?.message ||
          '스캔 실패',

        type:
          err?.name ||
          'Error',

        market,

      });

  }

};
