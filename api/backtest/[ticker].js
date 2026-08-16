const { guard } = require('../../lib/auth');

const {
  runQuantBacktest,
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
  const value =
    String(
      interval || '30m'
    )
      .trim()
      .toLowerCase();

  return INTRADAY_LIMITS[value]
    ? value
    : '30m';
}

function rangeToDays(range) {
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

  if (!match) return null;

  const amount =
    Number(
      match[1]
    );

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  if (match[2] === 'd') {
    return amount;
  }

  if (match[2] === 'mo') {
    return amount * 30;
  }

  return amount * 365;
}

function normalizeRange(
  range,
  interval
) {
  const maximum =
    INTRADAY_LIMITS[
      interval
    ] || '60d';

  const requested =
    rangeToDays(
      range
    );

  const maximumDays =
    rangeToDays(
      maximum
    );

  if (
    requested === null ||
    maximumDays === null
  ) {
    return maximum;
  }

  return requested >
    maximumDays
    ? maximum
    : String(
        range
      )
        .trim()
        .toLowerCase();
}

function normalizeTicker(ticker) {
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

module.exports =
  async (
    req,
    res
  ) => {
    if (guard(req, res)) return;

    try {
      const ticker =
        normalizeTicker(
          req.query?.ticker
        );

      const requestedRange =
        req.query?.range ||
        '60d';

      const requestedInterval =
        req.query?.interval ||
        '30m';

      if (!ticker) {
        return res
          .status(400)
          .json({
            error:
              '백테스트할 종목 티커가 필요합니다.',
          });
      }

      const interval =
        normalizeInterval(
          requestedInterval
        );

      const range =
        normalizeRange(
          requestedRange,
          interval
        );

      const quote =
        await getIntradayHistory(
          ticker,
          range,
          interval
        );

      if (
        !quote ||
        !Array.isArray(
          quote.bars
        ) ||
        quote.bars.length < 120
      ) {
        return res
          .status(400)
          .json({
            error:
              '백테스트에 필요한 장중 데이터가 부족합니다.',
            ticker,
            requestedRange,
            actualRange:
              quote?.actualRange ||
              range,
            interval,
            bars:
              quote?.bars?.length ||
              0,
          });
      }

      const dates =
        Array.isArray(
          quote.dates
        )
          ? quote.dates
          : quote.bars.map(
              bar =>
                bar.date ||
                null
            );

      /*
       * 중요:
       *
       * 이 endpoint는 현재 시점의 뉴스/시장 데이터를
       * 과거 봉에 넣지 않는다.
       *
       * point-in-time context가 필요한 경우
       * POST body 또는 별도의 historicalContextSeries를
       * 전달해서 backtest에 넣을 수 있도록 확장한다.
       */
      const contextSeries =
        req.body?.contextSeries ||
        null;

      const result =
        runQuantBacktest(
          quote.bars,
          dates,
          {
            contextSeries:
              contextSeries || {},
          }
        );

      return res
        .status(200)
        .json({
          ticker,

          range:
            quote.actualRange ||
            range,

          interval:
            quote.actualInterval ||
            interval,

          requestedRange,

          requestedInterval,

          rangeAdjusted:
            Boolean(
              quote.rangeAdjusted ||
              String(
                requestedRange
              ).toLowerCase() !==
                String(
                  quote.actualRange ||
                  range
                ).toLowerCase()
            ),

          pointInTime:
            true,

          ...result,

          dataInfo: {
            bars:
              quote.bars.length,

            startDate:
              dates[0] ||
              null,

            endDate:
              dates[
                dates.length - 1
              ] ||
              null,

            requestedRange,

            actualRange:
              quote.actualRange ||
              range,

            interval:
              quote.actualInterval ||
              interval,

            historicalContext:
              Boolean(
                contextSeries
              ),

            yahooIntradayLimit:
              INTRADAY_LIMITS[
                interval
              ],
          },
        });
    } catch (err) {
      console.error(
        'Intraday backtest error:',
        err
      );

      const status =
        Number(
          err?.status
        ) === 422
          ? 422
          : 500;

      return res
        .status(status)
        .json({
          error:
            status === 422
              ? (
                  err?.message ||
                  'Yahoo Finance 장중 데이터 범위를 지원하지 않습니다.'
                )
              : (
                  err?.message ||
                  '데이트레이딩 백테스트 실행 실패'
                ),

          ticker:
            normalizeTicker(
              req.query?.ticker
            ),

          requestedRange:
            req.query?.range ||
            '60d',

          requestedInterval:
            req.query?.interval ||
            '30m',
        });
    }
  };
