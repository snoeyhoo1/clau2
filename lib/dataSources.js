// lib/dataSources.js
// Yahoo Finance Chart API wrapper
// OHLCV + 현재가 + 날짜를 반환한다.

const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const RSS_URL = 'https://feeds.finance.yahoo.com/rss/2.0/headline';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (signal-app)',
    },
  });

  if (!res.ok) {
    throw new Error(`요청 실패 (${res.status}): ${url}`);
  }

  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (signal-app)',
    },
  });

  if (!res.ok) {
    throw new Error(`요청 실패 (${res.status}): ${url}`);
  }

  return res.text();
}

/**
 * Yahoo Finance OHLCV 데이터
 *
 * bars:
 * [
 *   {
 *     date,
 *     timestamp,
 *     open,
 *     high,
 *     low,
 *     close,
 *     volume
 *   }
 * ]
 */
async function getQuoteAndHistory(
  ticker,
  range = '6mo',
  interval = '1d'
) {
  const url =
    `${CHART_URL}/${encodeURIComponent(ticker)}` +
    `?range=${encodeURIComponent(range)}` +
    `&interval=${encodeURIComponent(interval)}` +
    '&events=history';

  const data = await fetchJson(url);
  const result = data?.chart?.result?.[0];

  if (!result) {
    throw new Error(`데이터 없음: ${ticker}`);
  }

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};

  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closesRaw = quote.close || [];
  const volumes = quote.volume || [];

  const bars = [];

  for (let i = 0; i < timestamps.length; i++) {
    const open = opens[i];
    const high = highs[i];
    const low = lows[i];
    const close = closesRaw[i];
    const volume = volumes[i];

    if (
      open === null ||
      open === undefined ||
      high === null ||
      high === undefined ||
      low === null ||
      low === undefined ||
      close === null ||
      close === undefined
    ) {
      continue;
    }

    bars.push({
      timestamp: timestamps[i],
      date: new Date(timestamps[i] * 1000).toISOString(),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume:
        volume === null || volume === undefined
          ? 0
          : Number(volume),
    });
  }

  if (bars.length === 0) {
    throw new Error(`가격 데이터 없음: ${ticker}`);
  }

  const closes = bars.map((b) => b.close);
  const dates = bars.map((b) => b.date.slice(0, 10));

  const meta = result.meta || {};

  const actualPreviousClose =
    closes.length >= 2
      ? closes[closes.length - 2]
      : meta.chartPreviousClose;

  const currentPrice =
    meta.regularMarketPrice ??
    closes[closes.length - 1];

  return {
    ticker,
    currency: meta.currency,
    exchange: meta.exchangeName,

    currentPrice,
    previousClose: actualPreviousClose,

    opens: bars.map((b) => b.open),
    highs: bars.map((b) => b.high),
    lows: bars.map((b) => b.low),
    closes,
    volumes: bars.map((b) => b.volume),

    dates,

    bars,
  };
}

// RSS <item> 블록 단위로 title/pubDate를 정확히 짝지어 파싱
function parseRssItems(xml) {
  const items = [
    ...xml.matchAll(/<item>([\s\S]*?)<\/item>/g),
  ];

  return items
    .map((m) => {
      const block = m[1];

      const titleMatch =
        block.match(/<title>(.*?)<\/title>/);

      const dateMatch =
        block.match(/<pubDate>(.*?)<\/pubDate>/);

      const title = titleMatch
        ? titleMatch[1]
            .replace(/<!\[CDATA\[|\]\]>/g, '')
            .trim()
        : null;

      const pubDate = dateMatch
        ? new Date(dateMatch[1])
        : null;

      return {
        title,
        pubDate:
          pubDate && !isNaN(pubDate)
            ? pubDate
            : null,
      };
    })
    .filter((i) => i.title);
}

function normalizeForDedupe(title) {
  return title
    .toLowerCase()
    .replace(/[^\w가-힣\s]/g, '')
    .slice(0, 50);
}

async function getHeadlines(
  ticker,
  limit = 10,
  companyLabel
) {
  const searchTerm = companyLabel || ticker;

  const sources = [
    {
      url:
        `${RSS_URL}?s=${encodeURIComponent(ticker)}` +
        '&region=US&lang=en-US',
      name: 'Yahoo Finance',
    },
    {
      url:
        `https://news.google.com/rss/search?q=` +
        `${encodeURIComponent(searchTerm + ' stock')}` +
        '&hl=en-US&gl=US&ceid=US:en',
      name: 'Google News',
    },
  ];

  const results = await Promise.allSettled(
    sources.map((s) => fetchText(s.url))
  );

  let combined = [];

  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;

    const items = parseRssItems(r.value);

    items.forEach((item) => {
      combined.push({
        title: item.title,
        source: sources[i].name,
        publishedAt: item.pubDate,
      });
    });
  });

  const seen = new Set();

  combined = combined.filter((item) => {
    const key = normalizeForDedupe(item.title);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  const TEN_DAYS =
    10 * 24 * 60 * 60 * 1000;

  const now = Date.now();

  combined = combined.filter(
    (item) =>
      !item.publishedAt ||
      now - item.publishedAt.getTime() <= TEN_DAYS
  );

  combined.sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;

    return b.publishedAt - a.publishedAt;
  });

  return combined.slice(0, limit);
}

function toKRTicker(code, market = 'KS') {
  return `${code}.${market}`;
}

async function getSimpleQuote(ticker) {
  const url =
    `${CHART_URL}/${encodeURIComponent(ticker)}` +
    '?range=5d&interval=1d';

  const data = await fetchJson(url);

  const result = data?.chart?.result?.[0];

  if (!result) {
    throw new Error(`데이터 없음: ${ticker}`);
  }

  const meta = result.meta || {};

  const closesRaw =
    result.indicators?.quote?.[0]?.close || [];

  const closes = closesRaw.filter(
    (c) => c !== null && c !== undefined
  );

  const previousClose =
    closes.length >= 2
      ? closes[closes.length - 2]
      : meta.chartPreviousClose;

  const currentPrice =
    meta.regularMarketPrice;

  const changePct = previousClose
    ? (
        ((currentPrice - previousClose) /
          previousClose) *
        100
      ).toFixed(2)
    : null;

  return {
    ticker,
    currentPrice,
    changePct,
    currency: meta.currency,
  };
}

module.exports = {
  getQuoteAndHistory,
  getHeadlines,
  toKRTicker,
  getSimpleQuote,
};
