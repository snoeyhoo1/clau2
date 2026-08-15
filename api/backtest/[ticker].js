const {
  runQuantBacktest,
} = require('../../lib/backtest');

const {
  getIntradayHistory,
} = require('../../lib/dataSources');

/*
 * Yahoo Finance 장중 데이터 제한에 맞춰
 * 백테스트 요청을 안전한 범위로 정규화한다.
 *
 * 30m:
 *   최대 60d
 *
 * 15m:
 *   최대 60d
 *
 * 5m:
 *   최대 60d
 *
 * 1m:
 *   최대 7d
 *
 * 일봉/주봉 등:
 *   이 API에서는 데이트레이딩 용도로 사용하지 않는다.
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

function normalizeInterval(
  interval
) {
  const value =
    String(
      interval ||
        '30m'
    )
      .trim()
      .toLowerCase();

  if (
    INTRADAY_LIMITS[
      value
    ]
  ) {
    return value;
  }

  return '30m';
}

function rangeToDays(
  range
) {
  const value =
    String(
      range ||
        ''
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

function clampRange(
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
   * 알 수 없는 range면
   * 최대 허용 범위 사용.
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
   * Yahoo 장중 데이터 제한 초과.
   */
  if (
    requestedDays >
    maximumDays
  ) {
    return maximum;
  }

  /*
   * 너무 작은 범위는 그대로 사용.
   */
  return range;
}

function normalizeTicker(
  ticker
) {
  if (
    Array.isArray(
      ticker
    )
  ) {
    ticker =
      ticker[0];
  }

  return String(
    ticker ||
      ''
  )
    .trim()
    .toUpperCase();
}

module.exports =
  async (
    req,
    res
  ) => {
    try {
      /*
       * ============================
       * 요청 파라미터
       * ============================
       */

      const ticker =
        normalizeTicker(
          req.query
            ?.ticker
        );

      const requestedRange =
        req.query
          ?.range ||
        '60d';

      const requestedInterval =
        req.query
          ?.interval ||
        '30m';

      if (
        !ticker
      ) {
        return res
          .status(400)
          .json({
            error:
              '백테스트할 종목 티커가 필요합니다.',
          });
      }

      /*
       * ============================
       * interval 정규화
       * ============================
       */

      const selectedInterval =
        normalizeInterval(
          requestedInterval
        );

      /*
       * ============================
       * range 정규화
       *
       * 예:
       *
       * 2y + 30m
       *       ↓
       * 60d + 30m
       *
       * 1y + 15m
       *       ↓
       * 60d + 15m
       *
       * 30d + 30m
       *       ↓
       * 30d + 30m
       * ============================
       */

      const selectedRange =
        clampRange(
          requestedRange,
          selectedInterval
        );

      const rangeAdjusted =
        String(
          requestedRange
        )
          .toLowerCase() !==
        String(
          selectedRange
        )
          .toLowerCase();

      /*
       * ============================
       * 데이터 조회
       * ============================
       */

      const quote =
        await getIntradayHistory(
          ticker,
          selectedRange,
          selectedInterval
        );

      if (
        !quote ||
        !Array.isArray(
          quote.bars
        ) ||
        quote.bars.length <
          120
      ) {
        return res
          .status(400)
          .json({
            error:
              '데이트레이딩 백테스트에 필요한 장중 데이터가 부족합니다.',

            ticker,

            requestedRange,

            actualRange:
              selectedRange,

            interval:
              selectedInterval,

            bars:
              quote?.bars
                ?.length ||
              0,
          });
      }

      /*
       * dates가 없는 데이터 소스도
       * 안전하게 처리.
       */
      const dates =
        Array.isArray(
          quote.dates
        )
          ? quote.dates
          : [];

      /*
       * ============================
       * 백테스트 실행
       * ============================
       */

      const result =
        runQuantBacktest(
          quote.bars,
          dates
        );

      /*
       * ============================
       * 응답
       * ============================
       */

      return res
        .status(200)
        .json({
          ticker,

          /*
           * 실제 Yahoo에 요청한 값.
           */
          range:
            selectedRange,

          interval:
            selectedInterval,

          /*
           * 사용자가 원래 요청한 값.
           */
          requestedRange,

          requestedInterval,

          /*
           * 2y/30m → 60d/30m처럼
           * 자동 조정되었는지.
           */
          rangeAdjusted,

          ...result,

          dataInfo: {
            bars:
              quote.bars
                .length,

            startDate:
              dates[0] ||
              null,

            endDate:
              dates[
                dates.length -
                  1
              ] ||
              null,

            requestedRange,

            actualRange:
              selectedRange,

            interval:
              selectedInterval,

            rangeAdjusted,

            yahooIntradayLimit:
              INTRADAY_LIMITS[
                selectedInterval
              ],
          },
        });
    } catch (
      err
    ) {
      console.error(
        'Intraday backtest error:',
        err
      );

      /*
       * Yahoo 422가 그대로
       * 전달되는 경우에도
       * 프론트에서 이해하기 쉽게
       * 메시지를 정리한다.
       */
      const message =
        err?.message ||
        '';

      const isYahoo422 =
        message.includes(
          '422'
        ) ||
        message.includes(
          'Unprocessable'
        ) ||
        message.includes(
          'query1.finance.yahoo.com'
        );

      return res
        .status(
          isYahoo422
            ? 422
            : 500
        )
        .json({
          error:
            isYahoo422
              ? 'Yahoo Finance에서 해당 장중 데이터 범위를 지원하지 않습니다. 30분봉은 최대 60일 범위로 자동 조정해야 합니다.'
              : message ||
                '데이트레이딩 백테스트 실행 실패',

          ticker:
            normalizeTicker(
              req.query
                ?.ticker
            ),

          requestedRange:
            req.query
              ?.range ||
            '60d',

          requestedInterval:
            req.query
              ?.interval ||
            '30m',
        });
    }
  };
