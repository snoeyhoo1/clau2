// api/scan.js

const {
  guard,
} = require('../lib/auth');

const {
  scanUniverse,
} = require('../lib/signalEngine');

const {
  FULL_UNIVERSE,
  US_UNIVERSE,
  KR_UNIVERSE,
} = require('../lib/universe');

module.exports = async (
  req,
  res
) => {
  if (guard(req, res)) return;

  try {
    const market =
      String(
        req.query?.market ||
        ''
      ).toLowerCase();

    let universe =
      FULL_UNIVERSE;

    if (
      market === 'us'
    ) {
      universe =
        US_UNIVERSE;
    }

    if (
      market === 'kr'
    ) {
      universe =
        KR_UNIVERSE;
    }

    const result =
      await scanUniverse(
        universe
      );

    res.status(200).json({
      ...result,

      generatedAt:
        new Date().toISOString(),

      market:
        market ||
        'all',
    });
  } catch (err) {
    console.error(
      '[api/scan]',
      err
    );

    res.status(500).json({
      error:
        err?.message ||
        '스캔 실패',
    });
  }
};
