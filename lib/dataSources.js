// lib/dataSources.js
// Yahoo Finance Chart API wrapper
// 일봉 + 장중 OHLCV 데이터를 모두 지원한다.

const CHART_URL =
  'https://query1.finance.yahoo.com/v8/finance/chart';

const RSS_URL =
  'https://feeds.finance.yahoo.com/rss/2.0/headline';

/*
 * Yahoo Finance 장중 데이터 제한.
 *
 * 중요:
 * 장중 interval은 장기간 조회가 불가능하다.
 *
 * 1m  -> 최대 7d
 * 2m  -> 최대 60d
 * 5m  -> 최대 60d
 * 15m -> 최대 60d
 * 30m -> 최대 60d
 * 60m -> 최대 60d
 * 90m -> 최대 60d
 */
const INTRADAY_LIMITS = {
  '1m': '7d',
  '2m': '60d',
  '5m': '60d',
  '15m': '60d',
  '30m': '60d',
  '60m': '60d',
  '90m': '60d',
};

/*
 * Yahoo Chart API에서 사용하는 장중 interval.
 */
const ALLOWED_INTRADAY_INTERVALS =
  Object.keys(
    INTRADAY_LIMITS
  );

/*
 * ============================
 * 공통 HTTP
 * ============================
 */

async function fetchJson(url) {
  const res = await fetch(
    url,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (signal-app)',
        Accept:
          'application/json',
      },
    }
  );

  if (!res.ok) {
    const error =
      new Error(
        `요청 실패 (${res.status}): ${url}`
      );

    error.status =
      res.status;

    error.url =
      url;

    throw error;
  }

  return res.json();
}

async function fetchText(url) {
  const res = await fetch(
    url,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (signal-app)',
        Accept:
          'application/rss+xml,text/xml,text/plain',
      },
    }
  );

  if (!res.ok) {
    const error =
      new Error(
        `요청 실패 (${res.status}): ${url}`
      );

    error.status =
      res.status;

    error.url =
      url;

    throw error;
  }

  return res.text();
}

/*
 * ============================
 * ticker / range 유틸
 * ============================
 */

function normalizeTicker(
  ticker
) {
  return String(
    ticker || ''
  )
    .trim()
    .toUpperCase();
}

function rangeToDays(
  range
) {
  const value =
    String(
      range || ''
    )
      .trim()
      .toLowerCase();

  const match =
    value.match(
      /^(\d+)(d|mo|y)$/
    );

  if (
    !match
  ) {
    return null;
  }

  const amount =
    Number(
      match[1]
    );

  if (
    !Number.isFinite(
      amount
    ) ||
    amount <= 0
  ) {
    return null;
  }

  const unit =
    match[2];

  if (
    unit === 'd'
  ) {
    return amount;
  }

  if (
    unit === 'mo'
  ) {
    return amount * 30;
  }

  if (
    unit === 'y'
  ) {
    return amount * 365;
  }

  return null;
}

function normalizeIntradayInterval(
  interval
) {
  const value =
    String(
      interval || '30m'
    )
      .trim()
      .toLowerCase();

  if (
    ALLOWED_INTRADAY_INTERVALS.includes(
      value
    )
  ) {
    return value;
  }

  return '30m';
}

function normalizeIntradayRange(
  range,
  interval
) {
  const maximum =
    INTRADAY_LIMITS[
      interval
    ] || '60d';

  const requestedDays =
    rangeToDays(
      range
    );

  const maximumDays =
    rangeToDays(
      maximum
    );

  /*
   * range가 이상하면
   * 해당 interval의 최대 허용 범위.
   */
  if (
    requestedDays ===
      null ||
    maximumDays ===
      null
  ) {
    return maximum;
  }

  /*
   * Yahoo 제한 초과.
   */
  if (
    requestedDays >
    maximumDays
  ) {
    return maximum;
  }

  return String(
    range
  )
    .trim()
    .toLowerCase();
}

/*
 * ============================
 * Chart 결과 파싱
 * ============================
 */

function parseChartResult(
  ticker,
  result
) {
  if (!result) {
    throw new Error(
      `데이터 없음: ${ticker}`
    );
  }

  const timestamps =
    result.timestamp ||
    [];

  const quote =
    result
      .indicators
      ?.quote?.[0] ||
    {};

  const opens =
    quote.open || [];

  const highs =
    quote.high || [];

  const lows =
    quote.low || [];

  const closesRaw =
    quote.close || [];

  const volumes =
    quote.volume || [];

  const bars = [];

  for (
    let i = 0;
    i <
    timestamps.length;
    i++
  ) {
    const timestamp =
      Number(
        timestamps[i]
      );

    const open =
      opens[i];

    const high =
      highs[i];

    const low =
      lows[i];

    const close =
      closesRaw[i];

    const volume =
      volumes[i];

    /*
     * 필수 OHLC가 하나라도 없으면
     * 해당 봉은 제외.
     */
    if (
      !Number.isFinite(
        timestamp
      ) ||
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

    const numericOpen =
      Number(open);

    const numericHigh =
      Number(high);

    const numericLow =
      Number(low);

    const numericClose =
      Number(close);

    if (
      !Number.isFinite(
        numericOpen
      ) ||
      !Number.isFinite(
        numericHigh
      ) ||
      !Number.isFinite(
        numericLow
      ) ||
      !Number.isFinite(
        numericClose
      ) ||
      numericClose <= 0
    ) {
      continue;
    }

    bars.push({
      timestamp,

      date:
        new Date(
          timestamp *
            1000
        ).toISOString(),

      open:
        numericOpen,

      high:
        numericHigh,

      low:
        numericLow,

      close:
        numericClose,

      volume:
        volume === null ||
        volume === undefined
          ? 0
          : Number(volume),
    });
  }

  if (
    !bars.length
  ) {
    throw new Error(
      `가격 데이터 없음: ${ticker}`
    );
  }

  const closes =
    bars.map(
      (bar) =>
        bar.close
    );

  const dates =
    bars.map(
      (bar) =>
        bar.date.slice(
          0,
          10
        )
    );

  const meta =
    result.meta || {};

  const previousClose =
    closes.length >= 2
      ? closes[
          closes.length - 2
        ]
      : meta.chartPreviousClose;

  const currentPrice =
    meta.regularMarketPrice ??
    closes[
      closes.length - 1
    ];

  return {
    ticker,

    currency:
      meta.currency,

    exchange:
      meta.exchangeName,

    currentPrice,

    previousClose,

    opens:
      bars.map(
        (bar) =>
          bar.open
      ),

    highs:
      bars.map(
        (bar) =>
          bar.high
      ),

    lows:
      bars.map(
        (bar) =>
          bar.low
      ),

    closes,

    volumes:
      bars.map(
        (bar) =>
          bar.volume
      ),

    dates,

    bars,
  };
}

/*
 * ============================
 * 기본 OHLCV 조회
 * ============================
 *
 * 기존 API 호환용.
 *
 * 이 함수는 일봉 등을 위한 함수이므로
 * 2y, 5y 같은 장기 range를 그대로 허용한다.
 */

async function getQuoteAndHistory(
  ticker,
  range = '6mo',
  interval = '1d'
) {
  const normalizedTicker =
    normalizeTicker(
      ticker
    );

  if (
    !normalizedTicker
  ) {
    throw new Error(
      '티커가 필요합니다.'
    );
  }

  const url =
    `${CHART_URL}/${encodeURIComponent(
      normalizedTicker
    )}` +
    `?range=${encodeURIComponent(
      range
    )}` +
    `&interval=${encodeURIComponent(
      interval
    )}` +
    '&events=history';

  const data =
    await fetchJson(
      url
    );

  const result =
    data
      ?.chart
      ?.result?.[0];

  return parseChartResult(
    normalizedTicker,
    result
  );
}

/*
 * ============================
 * 데이트레이딩 장중 데이터
 * ============================
 */

async function getIntradayHistory(
  ticker,
  range = '60d',
  interval = '30m'
) {
  const normalizedTicker =
    normalizeTicker(
      ticker
    );

  if (
    !normalizedTicker
  ) {
    throw new Error(
      '장중 데이터를 조회할 티커가 필요합니다.'
    );
  }

  /*
   * interval 정규화.
   */
  const selectedInterval =
    normalizeIntradayInterval(
      interval
    );

  /*
   * range 정규화.
   *
   * 예:
   *
   * 2y + 30m
   * → 60d + 30m
   *
   * 1y + 15m
   * → 60d + 15m
   *
   * 10d + 1m
   * → 7d + 1m
   */
  let selectedRange =
    normalizeIntradayRange(
      range,
      selectedInterval
    );

  /*
   * 실제 Yahoo 요청.
   */
  const buildUrl =
    (
      requestRange
    ) =>
      `${CHART_URL}/${encodeURIComponent(
        normalizedTicker
      )}` +
      `?range=${encodeURIComponent(
        requestRange
      )}` +
      `&interval=${encodeURIComponent(
        selectedInterval
      )}` +
      '&events=history' +
      '&includePrePost=false';

  let url =
    buildUrl(
      selectedRange
    );

  try {
    const data =
      await fetchJson(
        url
      );

    const result =
      data
        ?.chart
        ?.result?.[0];

    return {
      ...parseChartResult(
        normalizedTicker,
        result
      ),

      requestedRange:
        range,

      actualRange:
        selectedRange,

      requestedInterval:
        interval,

      actualInterval:
        selectedInterval,

      rangeAdjusted:
        String(
          range || ''
        ).toLowerCase() !==
        String(
          selectedRange
        ).toLowerCase(),
    };
  } catch (
    error
  ) {
    /*
     * ============================
     * Yahoo 422 자동 복구
     * ============================
     *
     * 일부 Yahoo 응답에서는
     * 제한 범위로 조정했음에도
     * 422가 발생할 수 있다.
     *
     * 이 경우 해당 interval의
     * 최대 허용 범위로 한 번 더 요청.
     */
    const is422 =
      Number(
        error?.status
      ) === 422 ||
      String(
        error?.message || ''
      ).includes(
        '422'
      );

    const fallbackRange =
      INTRADAY_LIMITS[
        selectedInterval
      ] || '60d';

    if (
      is422 &&
      selectedRange !==
        fallbackRange
    ) {
      selectedRange =
        fallbackRange;

      url =
        buildUrl(
          selectedRange
        );

      const retryData =
        await fetchJson(
          url
        );

      const retryResult =
        retryData
          ?.chart
          ?.result?.[0];

      return {
        ...parseChartResult(
          normalizedTicker,
          retryResult
        ),

        requestedRange:
          range,

        actualRange:
          selectedRange,

        requestedInterval:
          interval,

        actualInterval:
          selectedInterval,

        rangeAdjusted:
          true,

        retried:
          true,
      };
    }

    /*
     * Yahoo의 422라면
     * 사용자에게 원인을 명확하게 전달.
     */
    if (
      is422
    ) {
      const friendlyError =
        new Error(
          `Yahoo Finance 장중 데이터 요청이 거부되었습니다. ${selectedInterval} 데이터는 최대 ${fallbackRange} 범위까지 조회할 수 있습니다. 요청 범위: ${range}`
        );

      friendlyError.status =
        422;

      friendlyError.url =
        url;

      friendlyError.requestedRange =
        range;

      friendlyError.actualRange =
        selectedRange;

      friendlyError.interval =
        selectedInterval;

      throw friendlyError;
    }

    throw error;
  }
}

/*
 * ============================
 * RSS
 * ============================
 */

// RSS <item> 블록 단위 파싱
function parseRssItems(
  xml
) {
  const items = [
    ...xml.matchAll(
      /<item>([\s\S]*?)<\/item>/g
    ),
  ];

  return items
    .map(
      (m) => {
        const block =
          m[1];

        const titleMatch =
          block.match(
            /<title>(.*?)<\/title>/
          );

        const dateMatch =
          block.match(
            /<pubDate>(.*?)<\/pubDate>/
          );

        const title =
          titleMatch
            ? titleMatch[1]
                .replace(
                  /<!\[CDATA\[|\]\]>/g,
                  ''
                )
                .trim()
            : null;

        const pubDate =
          dateMatch
            ? new Date(
                dateMatch[1]
              )
            : null;

        return {
          title,

          pubDate:
            pubDate &&
            !isNaN(
              pubDate
            )
              ? pubDate
              : null,
        };
      }
    )
    .filter(
      (item) =>
        item.title
    );
}

function normalizeForDedupe(
  title
) {
  return String(
    title || ''
  )
    .toLowerCase()
    .replace(
      /[^\w가-힣\s]/g,
      ''
    )
    .slice(
      0,
      50
    );
}

async function getHeadlines(
  ticker,
  limit = 10,
  companyLabel
) {
  const searchTerm =
    companyLabel ||
    ticker;

  const sources = [
    {
      url:
        `${RSS_URL}?s=${encodeURIComponent(
          ticker
        )}` +
        '&region=US&lang=en-US',

      name:
        'Yahoo Finance',
    },

    {
      url:
        `https://news.google.com/rss/search?q=` +
        `${encodeURIComponent(
          searchTerm +
            ' stock'
        )}` +
        '&hl=en-US&gl=US&ceid=US:en',

      name:
        'Google News',
    },
  ];

  const results =
    await Promise.allSettled(
      sources.map(
        (source) =>
          fetchText(
            source.url
          )
      )
    );

  let combined = [];

  results.forEach(
    (
      result,
      index
    ) => {
      if (
        result.status !==
        'fulfilled'
      ) {
        return;
      }

      const items =
        parseRssItems(
          result.value
        );

      items.forEach(
        (item) => {
          combined.push({
            title:
              item.title,

            source:
              sources[
                index
              ].name,

            publishedAt:
              item.pubDate,
          });
        }
      );
    }
  );

  const seen =
    new Set();

  combined =
    combined.filter(
      (item) => {
        const key =
          normalizeForDedupe(
            item.title
          );

        if (
          seen.has(
            key
          )
        ) {
          return false;
        }

        seen.add(
          key
        );

        return true;
      }
    );

  const TEN_DAYS =
    10 *
    24 *
    60 *
    60 *
    1000;

  const now =
    Date.now();

  combined =
    combined.filter(
      (item) =>
        !item.publishedAt ||
        now -
          item
            .publishedAt
            .getTime() <=
          TEN_DAYS
    );

  combined.sort(
    (
      a,
      b
    ) => {
      if (
        !a.publishedAt
      ) {
        return 1;
      }

      if (
        !b.publishedAt
      ) {
        return -1;
      }

      return (
        b.publishedAt -
        a.publishedAt
      );
    }
  );

  return combined.slice(
    0,
    limit
  );
}

/*
 * ============================
 * 한국 티커
 * ============================
 */

function toKRTicker(
  code,
  market = 'KS'
) {
  return `${code}.${market}`;
}

/*
 * ============================
 * 단순 시세
 * ============================
 */

async function getSimpleQuote(
  ticker
) {
  const normalizedTicker =
    normalizeTicker(
      ticker
    );

  if (
    !normalizedTicker
  ) {
    throw new Error(
      '티커가 필요합니다.'
    );
  }

  const url =
    `${CHART_URL}/${encodeURIComponent(
      normalizedTicker
    )}` +
    '?range=5d&interval=1d';

  const data =
    await fetchJson(
      url
    );

  const result =
    data
      ?.chart
      ?.result?.[0];

  if (
    !result
  ) {
    throw new Error(
      `데이터 없음: ${normalizedTicker}`
    );
  }

  const meta =
    result.meta || {};

  const closesRaw =
    result
      .indicators
      ?.quote?.[0]
      ?.close || [];

  const closes =
    closesRaw.filter(
      (c) =>
        c !== null &&
        c !== undefined
    );

  const previousClose =
    closes.length >= 2
      ? closes[
          closes.length - 2
        ]
      : meta.chartPreviousClose;

  const currentPrice =
    meta.regularMarketPrice ??
    closes[
      closes.length - 1
    ];

  const changePct =
    previousClose &&
    currentPrice
      ? (
          (
            (currentPrice -
              previousClose) /
            previousClose
          ) *
          100
        ).toFixed(2)
      : null;

  return {
    ticker:
      normalizedTicker,

    currentPrice,

    changePct,

    currency:
      meta.currency,
  };
}

module.exports = {
  getQuoteAndHistory,

  getIntradayHistory,

  getHeadlines,

  toKRTicker,

  getSimpleQuote,
};
