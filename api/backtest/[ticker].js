// api/backtest/[ticker].js

const {
  runQuantBacktest,
} = require('../../lib/backtest');

const {
  getIntradayHistory,
} = require('../../lib/dataSources');

module.exports = async (
  req,
  res
) => {
  try {
    const {
      ticker,
      range,
      interval,
    } = req.query;

    /*
     * 데이트레이딩 백테스트는
     * Yahoo 장중 데이터 제한을 고려해
     * 기본 최근 60일 / 30분봉.
     */
    const selectedRange =
      range || '60d';

    const selectedInterval =
      interval || '30m';

    const quote =
      await getIntradayHistory(
        ticker,
        selectedRange,
        selectedInterval
      );

    if (
      !quote.bars ||
      quote.bars.length < 120
    ) {
      return res
        .status(400)
        .json({
          error:
            '데이트레이딩 백테스트에 필요한 장중 데이터가 부족합니다.',
        });
    }

    const result =
      runQuantBacktest(
        quote.bars,
        quote.dates
      );

    res.status(200).json({
      ticker,

      range:
        selectedRange,

      interval:
        selectedInterval,

      ...result,

      dataInfo: {
        bars:
          quote.bars.length,

        startDate:
          quote.dates[0],

        endDate:
          quote.dates[
            quote.dates.length - 1
          ],
      },
    });
  } catch (err) {
    console.error(
      'Intraday backtest error:',
      err
    );

    res
      .status(500)
      .json({
        error:
          err.message ||
          '데이트레이딩 백테스트 실행 실패',
      });
  }
};
