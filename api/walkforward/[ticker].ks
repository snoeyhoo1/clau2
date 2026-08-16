// api/walkforward/[ticker].js
//
// 전체 기간을 여러 구간(fold)으로 나눠 각각 독립적으로 백테스트해서,
// 특정 시기에만 우연히 잘 맞았던 건 아닌지 구간별 안정성을 확인한다.
// (lib/backtest.js의 runWalkForwardValidation 참고)

const { guard } = require('../../lib/auth');

const {
  runWalkForwardValidation,
} = require('../../lib/backtest');

const {
  getIntradayHistory,
} = require('../../lib/dataSources');

const INTRADAY_LIMITS = {
  '1m': '7d',
  '2m': '60d',
  '5m': '60d',
  '15m': '60d',
  '30m': '60d',
  '60m': '60d',
  '90m': '60d',
};

function normalizeInterval(interval) {
  const value = String(interval || '30m')
    .trim()
    .toLowerCase();

  return INTRADAY_LIMITS[value]
    ? value
    : '30m';
}

function normalizeTicker(ticker) {
  if (Array.isArray(ticker)) {
    ticker = ticker[0];
  }

  return String(ticker || '')
    .trim()
    .toUpperCase();
}

module.exports = async (req, res) => {
  if (guard(req, res)) return;

  try {
    const ticker = normalizeTicker(
      req.query?.ticker
    );

    if (!ticker) {
      return res.status(400).json({
        error:
          '검증할 종목 티커가 필요합니다.',
      });
    }

    const interval = normalizeInterval(
      req.query?.interval
    );

    /*
     * fold를 나누려면 raw backtest보다 더 긴 기간이 필요하다.
     * (fold마다 자체 warmup을 가져야 하므로)
     */
    const range =
      INTRADAY_LIMITS[interval] || '60d';

    const folds = Math.max(
      2,
      Math.min(
        8,
        Number(req.query?.folds) || 4
      )
    );

    const quote = await getIntradayHistory(
      ticker,
      range,
      interval
    );

    if (
      !quote ||
      !Array.isArray(quote.bars) ||
      quote.bars.length < 120 * folds
    ) {
      return res.status(400).json({
        error:
          '구간 검증에 필요한 데이터가 부족합니다. ' +
          'fold 수를 줄이거나 더 긴 interval을 선택해주세요.',
        ticker,
        interval,
        bars: quote?.bars?.length || 0,
        requiredMinBars: 120 * folds,
      });
    }

    const dates =
      Array.isArray(quote.dates)
        ? quote.dates
        : quote.bars.map(
            bar => bar.date || null
          );

    const result = runWalkForwardValidation(
      quote.bars,
      { dates, folds }
    );

    return res.status(200).json({
      ticker,
      interval:
        quote.actualInterval || interval,
      range: quote.actualRange || range,
      ...result,
      generatedAt:
        new Date().toISOString(),
    });

  } catch (err) {
    console.error(
      '[api/walkforward]',
      err
    );

    return res.status(500).json({
      ok: false,
      error:
        err?.message ||
        'walk-forward 검증 실패',
    });
  }
};

