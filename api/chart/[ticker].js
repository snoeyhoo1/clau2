// api/chart/[ticker].js

const {
  guard,
} = require('../../lib/auth');

const {
  getQuoteAndHistory,
} = require('../../lib/dataSources');

function normalizeTicker(
  ticker
) {
  if (
    Array.isArray(ticker)
  ) {
    ticker = ticker[0];
  }

  return String(
    ticker || ''
  )
    .trim()
    .toUpperCase();
}

function normalizeRange(
  range
) {
  const value =
    String(
      range || '6mo'
    )
      .trim()
      .toLowerCase();

  const allowed =
    new Set([
      '1d',
      '5d',
      '1mo',
      '3mo',
      '6mo',
      '1y',
      '2y',
      '5y',
      '10y',
      'max',
    ]);

  return allowed.has(
    value
  )
    ? value
    : '6mo';
}

function buildTickerCandidates(
  ticker
) {
  const normalized =
    normalizeTicker(
      ticker
    );

  const candidates = [
    normalized,
  ];

  /*
   * 한국 종목코드가
   * 005930 형태로 들어오는 경우
   * Yahoo Finance에서는
   * 005930.KS 또는 005930.KQ를 사용한다.
   */
  if (
    /^\d{6}$/.test(
      normalized
    )
  ) {
    candidates.push(
      `${normalized}.KS`
    );

    candidates.push(
      `${normalized}.KQ`
    );
  }

  /*
   * 이미 .KS/.KQ가 붙어 있으면
   * 중복 후보를 만들지 않는다.
   */
  return [
    ...new Set(
      candidates
    ),
  ];
}

async function getChartWithFallback(
  ticker,
  range
) {
  const candidates =
    buildTickerCandidates(
      ticker
    );

  let lastError =
    null;

  for (
    const candidate of
      candidates
  ) {
    try {
      const result =
        await getQuoteAndHistory(
          candidate,
          range,
          '1d'
        );

      if (
        result &&
        Array.isArray(
          result.dates
        ) &&
        Array.isArray(
          result.closes
        ) &&
        result.closes.length >=
          2
      ) {
        return {
          ...result,

          requestedTicker:
            normalizeTicker(
              ticker
            ),

          resolvedTicker:
            candidate,
        };
      }

    } catch (error) {
      lastError =
        error;

      console.warn(
        '[api/chart] ticker fallback 실패:',
        candidate,
        error?.message ||
          error
      );
    }
  }

  throw (
    lastError ||
    new Error(
      '차트 데이터를 찾을 수 없습니다.'
    )
  );
}

module.exports = async (
  req,
  res
) => {
  if (
    guard(req, res)
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
    return res.status(405).json({
      ok: false,

      error:
        'GET만 지원합니다.',
    });
  }

  const ticker =
    normalizeTicker(
      req.query?.ticker
    );

  if (!ticker) {
    return res.status(400).json({
      ok: false,

      error:
        '차트 종목 티커가 필요합니다.',
    });
  }

  const range =
    normalizeRange(
      req.query?.range
    );

  try {
    const quote =
      await getChartWithFallback(
        ticker,
        range
      );

    return res.status(200).json({
      ok: true,

      ticker,

      resolvedTicker:
        quote.resolvedTicker,

      currency:
        quote.currency ||
        null,

      exchange:
        quote.exchange ||
        null,

      currentPrice:
        quote.currentPrice,

      previousClose:
        quote.previousClose,

      dates:
        quote.dates,

      closes:
        quote.closes,

      opens:
        quote.opens,

      highs:
        quote.highs,

      lows:
        quote.lows,

      volumes:
        quote.volumes,

      range,
    });

  } catch (err) {
    console.error(
      '[api/chart]',
      {
        ticker,
        range,
        error:
          err?.message ||
          err,
      }
    );

    return res.status(502).json({
      ok: false,

      error:
        err?.message ||
        '차트 데이터를 불러오지 못했습니다.',

      ticker,

      range,

      type:
        err?.name ||
        'Error',
    });
  }
};
