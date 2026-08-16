// api/signal/[ticker].js
const { guard } = require('../../lib/auth');
const { buildSignal } = require('../../lib/signalEngine');

module.exports = async (req, res) => {
  if (guard(req, res)) return;

  try {
    const { ticker, label } = req.query;
    const signal = await buildSignal(ticker, label);
    res.status(200).json(signal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
