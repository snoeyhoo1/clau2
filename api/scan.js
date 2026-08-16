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

const inFlightScans =
  new Map();

function normalizeMarket(
  value
) {
  const market =
    String(
      value || ''
    )
      .trim()
      .toLowerCase();

  if (
    market === 'us' ||
    market === 'kr' ||
    market === 'all'
  ) {
    return market;
  }

  return 'all';
}

function selectUniverse(
  market
) {
  if (
    market === 'us'
  ) {
    return US_UNIVERSE;
  }

  if (
    market === 'kr'
  ) {
    return KR_UNIVERSE;
  }

  return FULL_UNIVERSE;
}

function createScan(
  market,
  universe
) {
  const existing =
    inFlightScans.get(
      market
    );

  if (existing) {
    return {
      promise: existing,
      deduped: true,
    };
  }

  const promise =
    Promise.resolve()
      .then(() =>
        scanUniverse(
          universe
        )
      )
      .finally(() => {
        if (
          inFlightScans.get(
            market
          ) === promise
        ) {
          inFlightScans.delete(
            market
          );
        }
      });

  inFlightScans.set(
    market,
    promise
  );

  return {
    promise,
    deduped: false,
  };
}

module.exports = async (
  req,
  res
) => {
  if (
    guard(req, res)
  ) {
    return;
  }

  res.setHeader(
    'Cache-Control',
    'no-store, max-age=0'
  );

  if (
    req.method !== 'GET'
  ) {
    return res.status(405).json({
      ok: false,

      error:
        'GET만 지원합니다.',
    });
  }

  const market =
    normalizeMarket(
      req.query?.market
    );

  const universe =
    selectUniverse(
      market
    );

  try {
    const {
      promise,
      deduped,
    } =
      createScan(
        market,
        universe
      );

    const result =
      await promise;

    return res.status(200).json({
      ok: true,

      ...result,

      generatedAt:
        new Date().toISOString(),

      market,

      scan: {
        deduped,
      },
    });

  } catch (err) {
    console.error(
      '[api/scan]',
      err
    );

    return res.status(500).json({
      ok: false,

      error:
        err?.message ||
        '스캔 실패',

      type:
        err?.name ||
        'Error',

      market,
    });
  }
};
