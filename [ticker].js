// api/backtest/[ticker].js
const { runBacktest } = require('../../lib/backtest');
const { getQuoteAndHistory } = require('../../lib/dataSources');

module.exports = async (req, res) => {
  try {
    const { ticker, range } = req.query;
    const quote = await getQuoteAndHistory(ticker, range || '2y');
    if (quote.closes.length < 40) {
      return res.status(400).json({ error: '백테스트에 필요한 데이터가 부족합니다' });
    }
    const result = runBacktest(quote.closes, quote.dates);
    res.status(200).json({ ticker, range: range || '2y', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
