// api/backtest/[ticker].js

const {
  runQuantBacktest,
} = require('../../lib/backtest');

const {
  getQuoteAndHistory,
} = require('../../lib/dataSources');

module.exports = async (
  req,
  res
) => {
  try {
    const {
      ticker,
      range,
    } = req.query;

    const selectedRange =
      range || '2y';

    const quote =
      await getQuoteAndHistory(
        ticker,
        selectedRange
      );

    if (
      !quote.bars ||
      quote.bars.length < 220
    ) {
      return res
        .status(400)
        .json({
          error:
            '퀀트 백테스트에 필요한 데이터가 부족합니다. 최소 220거래일 이상의 데이터가 필요합니다.',
        });
    }

    const result =
      runQuantBacktest(
        quote.bars,
        quote.dates
      );

    res.status(200).json({
      ticker,
      range: selectedRange,

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
      'Backtest error:',
      err
    );

    res
      .status(500)
      .json({
        error:
          err.message ||
          '백테스트 실행 실패',
      });
  }
};
