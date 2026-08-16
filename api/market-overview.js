// api/market-overview.js
const { guard } = require('../lib/auth');
const { getSimpleQuote } = require('../lib/dataSources');
const { INDICES } = require('../lib/universe');

module.exports = async (req, res) => {
  if (guard(req, res)) return;

  try {
    const results = await Promise.allSettled(INDICES.map((i) => getSimpleQuote(i.ticker)));
    const indices = results.map((r, i) => {
      if (r.status === 'fulfilled') return { ...r.value, label: INDICES[i].label };
      return { ticker: INDICES[i].ticker, label: INDICES[i].label, error: r.reason?.message };
    });

    res.status(200).json({ indices, generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
