// api/chart/[ticker].js
const { guard } = require('../../lib/auth');
const { getQuoteAndHistory } = require('../../lib/dataSources');

module.exports = async (req, res) => {
  if (guard(req, res)) return;

  try {
    const { ticker, range } = req.query;
    const quote = await getQuoteAndHistory(ticker, range || '6mo');
    res.status(200).json({
      ticker,
      currency: quote.currency,
      dates: quote.dates,
      closes: quote.closes,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
