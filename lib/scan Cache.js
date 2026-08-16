// lib/scanCache.js
//
// Vercel Serverless warm-instance cache for scan requests.
// - 같은 시장 스캔의 동시 중복 실행을 하나의 Promise로 합친다.
// - 짧은 TTL 동안 직전 결과를 재사용해 연속 새로고침/중복 클릭을 줄인다.
// - 인스턴스가 재생성되면 캐시는 자연스럽게 비워진다.

const DEFAULT_TTL =
  45 * 1000;

const cache = new Map();
const inFlight = new Map();

function normalizeKey(
  market
) {
  return String(
    market || 'all'
  )
    .trim()
    .toLowerCase() || 'all';
}

function getCached(
  market,
  ttl = DEFAULT_TTL
) {
  const key =
    normalizeKey(market);

  const entry =
    cache.get(key);

  if (!entry) {
    return null;
  }

  if (
    Date.now() -
      entry.time >=
    ttl
  ) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCached(
  market,
  value
) {
  cache.set(
    normalizeKey(market),
    {
      time: Date.now(),
      value,
    }
  );

  return value;
}

async function getOrCreate(
  market,
  factory
) {
  const key =
    normalizeKey(market);

  const cached =
    getCached(key);

  if (cached) {
    return {
      value: cached,
      cached: true,
      deduped: false,
    };
  }

  const existing =
    inFlight.get(key);

  if (existing) {
    return {
      value: await existing,
      cached: false,
      deduped: true,
    };
  }

  const promise =
    Promise.resolve()
      .then(factory)
      .then(value => {
        setCached(
          key,
          value
        );

        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });

  inFlight.set(
    key,
    promise
  );

  return {
    value: await promise,
    cached: false,
    deduped: false,
  };
}

function clear(
  market
) {
  if (market) {
    cache.delete(
      normalizeKey(market)
    );

    return;
  }

  cache.clear();
}

module.exports = {
  getCached,
  setCached,
  getOrCreate,
  clear,
};
