// api/signal/[ticker].js

const {
  guard,
} = require('../../lib/auth');

const {
  buildSignal,
} = require('../../lib/signalEngine');

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

function normalizeLabel(
  label
) {
  if (
    Array.isArray(label)
  ) {
    label = label[0];
  }

  return String(
    label || ''
  ).trim();
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

  const label =
    normalizeLabel(
      req.query?.label
    );

  if (!ticker) {
    return res.status(400).json({
      ok: false,
      error:
        '분석할 종목 티커가 필요합니다.',
    });
  }

  try {
    const signal =
      await buildSignal(
        ticker,
        label || ticker
      );

    return res.status(200).json({
      ok: true,

      ...signal,

      ticker,
    });

  } catch (err) {
    console.error(
      '[api/signal]',
      err
    );

    return res.status(500).json({
      ok: false,

      error:
        err?.message ||
        '종목 신호 분석에 실패했습니다.',

      ticker,

      type:
        err?.name ||
        'Error',
    });
  }
};
