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

  if (
    req.method !== 'GET'
  ) {
    return res.status(405).json({
      error:
        'GET만 지원합니다.',
    });
  }

  try {
    const market =
      String(
        req.query?.market ||
        ''
      ).trim().toLowerCase();

    let universe =
      FULL_UNIVERSE;

    if (
      market === 'us'
    ) {
      universe =
        US_UNIVERSE;
    } else if (
      market === 'kr'
    ) {
      universe =
        KR_UNIVERSE;
    }

    const result =
      await scanUniverse(
        universe
      );

    return res.status(200).json({
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

    return res.status(500).json({
      error:
        err?.message ||
        '스캔 실패',

      type:
        err?.name ||
        'Error',
    });
  }
};
