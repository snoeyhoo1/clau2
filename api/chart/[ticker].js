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
      await getQuoteAndHistory(
        ticker,
        range
      );

    if (
      !quote ||
      !Array.isArray(
        quote.dates
      ) ||
      !Array.isArray(
        quote.closes
      )
    ) {
      return res.status(502).json({
        ok: false,
        error:
          '차트 데이터를 가져오지 못했습니다.',
        ticker,
        range,
      });
    }

    return res.status(200).json({
      ok: true,

      ticker,

      currency:
        quote.currency ||
        null,

      dates:
        quote.dates,

      closes:
        quote.closes,

      range,
    });

  } catch (err) {
    console.error(
      '[api/chart]',
      err
    );

    return res.status(500).json({
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
