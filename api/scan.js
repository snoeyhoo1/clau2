// api/scan.js
const { scanUniverse } = require('../lib/signalEngine');
const { FULL_UNIVERSE } = require('../lib/universe');

module.exports = async (req, res) => {
  try {
    const market = req.query.market; // 'us' | 'kr' | undefined(전체)
    let universe = FULL_UNIVERSE;
    if (market === 'us') universe = require('../lib/universe').US_UNIVERSE;
    if (market === 'kr') universe = require('../lib/universe').KR_UNIVERSE;

    const result = await scanUniverse(universe);
    res.status(200).json({ ...result, generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
