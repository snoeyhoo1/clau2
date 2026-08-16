// api/search.js
//
// SIGNAL DESK
//
// 종목명 / 종목코드 검색
//
// 핵심 변경:
// 1. 한국 종목 검색 시 Yahoo ticker(.KS/.KQ)를 유지
// 2. rawTicker도 함께 반환
// 3. 분석/차트에서 사용할 수 있도록 symbol / ticker / code를 모두 제공
// 4. Yahoo 검색 실패 시 fallback 유지
// 5. ETF / INDEX / FUND 등이 검색 결과를 오염시키지 않도록 EQUITY 중심 필터
// 6. 검색 결과 정규화 강화
// 7. 한국 종목 코드 입력 시 .KS / .KQ 직접 후보도 생성
//
// 예:
// /api/search?q=삼성전자
// /api/search?q=005930
// /api/search?q=NVDA

const {
  guard,
} = require('../lib/auth');


/*
 * ============================================================
 * Yahoo Finance
 * ============================================================
 */

const SEARCH_URL =
  'https://query1.finance.yahoo.com/v1/finance/search';


/*
 * ============================================================
 * Fallback Universe
 * ============================================================
 */

const FALLBACK_UNIVERSE = [
  {
    ticker: '005930.KS',
    label: '삼성전자',
    exchange: 'KOSPI',
  },

  {
    ticker: '000660.KS',
    label: 'SK하이닉스',
    exchange: 'KOSPI',
  },

  {
    ticker: '035420.KS',
    label: 'NAVER',
    exchange: 'KOSPI',
  },

  {
    ticker: '035720.KS',
    label: '카카오',
    exchange: 'KOSPI',
  },

  {
    ticker: '005380.KS',
    label: '현대차',
    exchange: 'KOSPI',
  },

  {
    ticker: '051910.KS',
    label: 'LG화학',
    exchange: 'KOSPI',
  },

  {
    ticker: '006400.KS',
    label: '삼성SDI',
    exchange: 'KOSPI',
  },

  {
    ticker: '207940.KS',
    label: '삼성바이오로직스',
    exchange: 'KOSPI',
  },

  {
    ticker: '068270.KS',
    label: '셀트리온',
    exchange: 'KOSPI',
  },

  {
    ticker: '005490.KS',
    label: 'POSCO홀딩스',
    exchange: 'KOSPI',
  },

  {
    ticker: 'AAPL',
    label: '애플',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'MSFT',
    label: '마이크로소프트',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'NVDA',
    label: '엔비디아',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'GOOGL',
    label: '알파벳',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'AMZN',
    label: '아마존',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'META',
    label: '메타',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'TSLA',
    label: '테슬라',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'AVGO',
    label: '브로드컴',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'AMD',
    label: 'AMD',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'NFLX',
    label: '넷플릭스',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'JPM',
    label: 'JP모건',
    exchange: 'NYSE',
  },

  {
    ticker: 'PLTR',
    label: '팔란티어',
    exchange: 'NASDAQ',
  },
];


/*
 * ============================================================
 * Normalization
 * ============================================================
 */

function normalize(
  value
) {
  return String(
    value || ''
  )
    .trim()
    .toLowerCase();
}


function normalizeSymbol(
  symbol
) {
  return String(
    symbol || ''
  )
    .trim()
    .toUpperCase();
}


/*
 * 한국 ticker:
 *
 * 005930.KS -> 005930
 * 005930.KQ -> 005930
 *
 * 미국:
 *
 * NVDA -> NVDA
 */

function getStockCode(
  ticker
) {
  const value =
    normalizeSymbol(
      ticker
    );

  if (
    /^\d{6}\.(KS|KQ)$/.test(
      value
    )
  ) {
    return value.slice(
      0,
      6
    );
  }

  return value;
}


function getYahooTicker(
  ticker
) {
  const value =
    normalizeSymbol(
      ticker
    );

  if (
    /^\d{6}$/.test(
      value
    )
  ) {
    return `${value}.KS`;
  }

  return value;
}


/*
 * ============================================================
 * Yahoo Search
 * ============================================================
 */

async function fetchYahooSearch(
  query
) {
  const url =
    `${SEARCH_URL}?q=${encodeURIComponent(
      query
    )}` +
    '&quotesCount=20' +
    '&newsCount=0' +
    '&enableFuzzyQuery=true';

  const response =
    await fetch(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (signal-desk)',
          Accept:
            'application/json',
        },
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Yahoo 검색 실패 (${response.status})`
    );
  }

  return response.json();
}


/*
 * ============================================================
 * Normalize Yahoo Result
 * ============================================================
 */

function normalizeYahooQuote(
  item
) {
  if (
    !item ||
    !item.symbol
  ) {
    return null;
  }

  const quoteType =
    String(
      item.quoteType ||
        ''
    ).toUpperCase();

  /*
   * 실제 종목만 허용.
   */
  if (
    quoteType &&
    quoteType !==
      'EQUITY'
  ) {
    return null;
  }

  const ticker =
    normalizeSymbol(
      item.symbol
    );

  if (!ticker) {
    return null;
  }

  const code =
    getStockCode(
      ticker
    );

  const label =
    item.longname ||
    item.shortname ||
    item.displayName ||
    ticker;

  const exchange =
    item.fullExchangeName ||
    item.exchange ||
    '';

  const currency =
    item.currency ||
    '';


  return {
    /*
     * 기존 프론트가 사용하는 값
     */
    ticker,
    label,
    exchange,
    type:
      quoteType ||
      'EQUITY',
    currency,
    source:
      'yahoo',

    /*
     * 새 엔진 연결용 값
     */
    symbol:
      ticker,

    yahooTicker:
      ticker,

    rawTicker:
      ticker,

    code,

    stockCode:
      code,

    /*
     * 한국 주식 여부
     */
    market:
      ticker.endsWith(
        '.KS'
      )
        ? 'KOSPI'
        : ticker.endsWith(
              '.KQ'
            )
          ? 'KOSDAQ'
          : exchange,

    isKorean:
      ticker.endsWith(
        '.KS'
      ) ||
      ticker.endsWith(
        '.KQ'
      ),
  };
}


/*
 * ============================================================
 * Fallback Search
 * ============================================================
 */

function fallbackSearch(
  query
) {
  const q =
    normalize(
      query
    );

  /*
   * 숫자 6자리면 한국 종목 코드로 간주.
   */
  const numericCode =
    /^\d{6}$/.test(
      q
    )
      ? q
      : null;

  return FALLBACK_UNIVERSE
    .filter(
      item => {
        const ticker =
          normalize(
            item.ticker
          );

        const label =
          normalize(
            item.label
          );

        const code =
          normalize(
            getStockCode(
              item.ticker
            )
          );

        return (
          ticker.includes(
            q
          ) ||
          label.includes(
            q
          ) ||
          code ===
            numericCode
        );
      }
    )
    .slice(
      0,
      10
    )
    .map(
      item => {
        const ticker =
          normalizeSymbol(
            item.ticker
          );

        const code =
          getStockCode(
            ticker
          );

        return {
          ticker,
          symbol:
            ticker,
          yahooTicker:
            ticker,
          rawTicker:
            ticker,

          code,
          stockCode:
            code,

          label:
            item.label,

          exchange:
            item.exchange ||
            '',

          market:
            item.exchange ||
            '',

          type:
            'EQUITY',

          currency:
            ticker.endsWith(
              '.KS'
            ) ||
            ticker.endsWith(
              '.KQ'
            )
              ? 'KRW'
              : 'USD',

          isKorean:
            ticker.endsWith(
              '.KS'
            ) ||
            ticker.endsWith(
              '.KQ'
            ),

          source:
            'fallback',
        };
      }
    );
}


/*
 * ============================================================
 * Direct Korean Code Search
 * ============================================================
 *
 * Yahoo 검색이 005930을 못 알아먹는 경우를 대비.
 *
 * 005930
 * ↓
 * 005930.KS
 *
 * 분석 엔진 / 차트 엔진은 yahooTicker를 사용.
 */

function directCodeCandidates(
  query
) {
  const value =
    String(
      query || ''
    )
      .trim()
      .toUpperCase();

  if (
    !/^\d{6}$/.test(
      value
    )
  ) {
    return [];
  }

  return [
    {
      ticker:
        `${value}.KS`,

      symbol:
        `${value}.KS`,

      yahooTicker:
        `${value}.KS`,

      rawTicker:
        `${value}.KS`,

      code:
        value,

      stockCode:
        value,

      label:
        `종목코드 ${value}`,

      exchange:
        'KOSPI',

      market:
        'KOSPI',

      type:
        'EQUITY',

      currency:
        'KRW',

      isKorean:
        true,

      source:
        'direct-code',
    },

    {
      ticker:
        `${value}.KQ`,

      symbol:
        `${value}.KQ`,

      yahooTicker:
        `${value}.KQ`,

      rawTicker:
        `${value}.KQ`,

      code:
        value,

      stockCode:
        value,

      label:
        `종목코드 ${value}`,

      exchange:
        'KOSDAQ',

      market:
        'KOSDAQ',

      type:
        'EQUITY',

      currency:
        'KRW',

      isKorean:
        true,

      source:
        'direct-code',
    },
  ];
}


/*
 * ============================================================
 * Dedupe
 * ============================================================
 */

function dedupeResults(
  results
) {
  const seen =
    new Set();

  return results.filter(
    item => {
      const key =
        normalizeSymbol(
          item.yahooTicker ||
            item.ticker ||
            item.symbol
        );

      if (!key) {
        return false;
      }

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}


/*
 * ============================================================
 * Handler
 * ============================================================
 */

module.exports =
  async (
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

    try {
      const query =
        String(
          req.query?.q ||
            ''
        ).trim();

      if (!query) {
        return res
          .status(400)
          .json({
            error:
              '검색어를 입력하세요.',

            results: [],
          });
      }


      let results =
        [];


      /*
       * ======================================================
       * 1. 직접 숫자 코드 후보
       * ======================================================
       */

      const direct =
        directCodeCandidates(
          query
        );


      /*
       * ======================================================
       * 2. Yahoo Search
       * ======================================================
       */

      try {
        const data =
          await fetchYahooSearch(
            query
          );

        if (
          Array.isArray(
            data?.quotes
          )
        ) {
          results =
            data.quotes
              .map(
                normalizeYahooQuote
              )
              .filter(
                Boolean
              )
              .slice(
                0,
                15
              );
        }
      } catch (
        error
      ) {
        console.warn(
          '[api/search] Yahoo 실패:',
          error?.message
        );
      }


      /*
       * ======================================================
       * 3. 숫자 코드 검색이면 직접 후보를 앞에 둔다.
       * ======================================================
       */

      if (
        direct.length
      ) {
        results = [
          ...direct,
          ...results,
        ];
      }


      /*
       * ======================================================
       * 4. Yahoo 결과가 없으면 fallback
       * ======================================================
       */

      if (
        !results.length
      ) {
        results =
          fallbackSearch(
            query
          );
      }


      /*
       * ======================================================
       * 5. 최종 정규화
       * ======================================================
       */

      results =
        results.map(
          item => {
            const ticker =
              normalizeSymbol(
                item.yahooTicker ||
                  item.ticker ||
                  item.symbol
              );

            const code =
              item.code ||
              item.stockCode ||
              getStockCode(
                ticker
              );

            return {
              ...item,

              ticker,

              symbol:
                ticker,

              yahooTicker:
                ticker,

              rawTicker:
                ticker,

              code,

              stockCode:
                code,
            };
          }
        );


      /*
       * ======================================================
       * 6. 중복 제거
       * ======================================================
       */

      results =
        dedupeResults(
          results
        ).slice(
          0,
          10
        );


      /*
       * ======================================================
       * 7. 코드 검색 결과가 이상하게 없을 경우
       * ======================================================
       */

      if (
        /^\d{6}$/.test(
          query
        ) &&
        !results.length
      ) {
        results =
          direct;
      }


      return res
        .status(200)
        .json({
          query,

          results,

          count:
            results.length,

          generatedAt:
            new Date().toISOString(),
        });
    } catch (
      error
    ) {
      console.error(
        '[api/search]',
        error
      );

      return res
        .status(500)
        .json({
          error:
            error?.message ||
            '종목 검색 실패',

          results: [],
        });
    }
  };
