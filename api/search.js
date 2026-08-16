// api/search.js
//
// 종목명 / 종목코드 검색
// Yahoo Finance Search API
//
// /api/search?q=삼성전자
// /api/search?q=005930
// /api/search?q=NVDA

const { guard } = require('../lib/auth');

const SEARCH_URL =
  'https://query1.finance.yahoo.com/v1/finance/search';

const FALLBACK_UNIVERSE = [
  { ticker: '005930.KS', label: '삼성전자' },
  { ticker: '000660.KS', label: 'SK하이닉스' },
  { ticker: '035420.KS', label: 'NAVER' },
  { ticker: '035720.KS', label: '카카오' },
  { ticker: '005380.KS', label: '현대차' },
  { ticker: '051910.KS', label: 'LG화학' },
  { ticker: '006400.KS', label: '삼성SDI' },
  { ticker: '207940.KS', label: '삼성바이오로직스' },
  { ticker: '068270.KS', label: '셀트리온' },
  { ticker: '005490.KS', label: 'POSCO홀딩스' },

  { ticker: 'AAPL', label: '애플' },
  { ticker: 'MSFT', label: '마이크로소프트' },
  { ticker: 'NVDA', label: '엔비디아' },
  { ticker: 'GOOGL', label: '알파벳' },
  { ticker: 'AMZN', label: '아마존' },
  { ticker: 'META', label: '메타' },
  { ticker: 'TSLA', label: '테슬라' },
  { ticker: 'AVGO', label: '브로드컴' },
  { ticker: 'AMD', label: 'AMD' },
  { ticker: 'NFLX', label: '넷플릭스' },
  { ticker: 'JPM', label: 'JP모건' },
  { ticker: 'PLTR', label: '팔란티어' },
];

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeSymbol(symbol) {
  return String(symbol || '')
    .trim()
    .toUpperCase();
}

async function fetchYahooSearch(query) {
  const url =
    `${SEARCH_URL}?q=${encodeURIComponent(query)}` +
    '&quotesCount=15' +
    '&newsCount=0' +
    '&enableFuzzyQuery=true';

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (signal-desk)',
      Accept:
        'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Yahoo 검색 실패 (${response.status})`
    );
  }

  return response.json();
}

function fallbackSearch(query) {
  const q = normalize(query);

  return FALLBACK_UNIVERSE
    .filter((item) => {
      const ticker =
        normalize(item.ticker);

      const label =
        normalize(item.label);

      return (
        ticker.includes(q) ||
        label.includes(q)
      );
    })
    .slice(0, 10)
    .map((item) => ({
      ticker: item.ticker,
      label: item.label,
      exchange: '',
      type: 'EQUITY',
      source: 'fallback',
    }));
}

module.exports = async (
  req,
  res
) => {
  if (guard(req, res)) return;

  try {
    const query =
      String(
        req.query?.q || ''
      ).trim();

    if (!query) {
      return res.status(400).json({
        error:
          '검색어를 입력하세요.',
        results: [],
      });
    }

    let results = [];

    try {
      const data =
        await fetchYahooSearch(
          query
        );

      results =
        Array.isArray(
          data?.quotes
        )
          ? data.quotes
              .filter(
                item =>
                  item.quoteType ===
                  'EQUITY'
              )
              .map(item => ({
                ticker:
                  normalizeSymbol(
                    item.symbol
                  ),

                label:
                  item.longname ||
                  item.shortname ||
                  item.symbol,

                exchange:
                  item.exchange ||
                  item.fullExchangeName ||
                  '',

                type:
                  item.quoteType ||
                  'EQUITY',

                currency:
                  item.currency ||
                  '',

                source:
                  'yahoo',
              }))
              .filter(
                item =>
                  item.ticker
              )
              .slice(0, 10)
          : [];
    } catch (error) {
      console.warn(
        '[api/search] Yahoo 실패:',
        error.message
      );
    }

    if (!results.length) {
      results =
        fallbackSearch(query);
    }

    const seen =
      new Set();

    results =
      results.filter(item => {
        if (
          seen.has(
            item.ticker
          )
        ) {
          return false;
        }

        seen.add(
          item.ticker
        );

        return true;
      });

    return res.status(200).json({
      query,
      results,
      count:
        results.length,
      generatedAt:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      '[api/search]',
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        '종목 검색 실패',
      results: [],
    });
  }
};
