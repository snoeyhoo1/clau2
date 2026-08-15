// api/kis/balance.js
const { getBalance, getOverseasBalance } = require('../../lib/kisClient');

module.exports = async (req, res) => {
  try {
    const [domesticResult, overseasResult] = await Promise.allSettled([
      getBalance(),
      getOverseasBalance(),
    ]);

    res.status(200).json({
      domestic: domesticResult.status === 'fulfilled' ? domesticResult.value : { error: domesticResult.reason?.message },
      overseas: overseasResult.status === 'fulfilled' ? overseasResult.value : { error: overseasResult.reason?.message },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
