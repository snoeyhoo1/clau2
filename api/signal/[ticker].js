// api/signal/[ticker].js

const {
  guard,
} = require('../../lib/auth');

const {
  buildSignal,
} = require('../../lib/signalEngine');

const {
  buildAIPresentation,
} = require('../../lib/aiPresentation');

function normalizeTicker(
  ticker
) {
  if (
    Array.isArray(ticker)
  ) {
    ticker = ticker[0];
  }

  return String(
    ticker || ''
  )
    .trim()
    .toUpperCase();
}

function normalizeLabel(
  label
) {
  if (
    Array.isArray(label)
  ) {
    label = label[0];
  }

  return String(
    label || ''
  ).trim();
}

function normalizePreviousSignal(
  value
) {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return null;
  }

  return {
    signal:
      value.signal,

    score:
      value.score,

    confidence:
      value.confidence,

    decision:
      value.decision,
  };
}

function getPreviousSignal(
  req
) {
  /*
   * 현재는 클라이언트가 전달한
   * 이전 신호가 있으면 비교한다.
   *
   * 이후 signalLog와 연결하면
   * 서버에서 자동으로 이전 신호를
   * 조회할 수 있다.
   */
  const previous =
    req.query?.previous;

  if (!previous) {
    return null;
  }

  try {
    const decoded =
      decodeURIComponent(
        String(previous)
      );

    const parsed =
      JSON.parse(
        decoded
      );

    return normalizePreviousSignal(
      parsed
    );
  } catch {
    return null;
  }
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

  res.setHeader(
    'X-AI-Presentation',
    '2.0'
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

  const ticker =
    normalizeTicker(
      req.query?.ticker
    );

  const label =
    normalizeLabel(
      req.query?.label
    );

  if (!ticker) {
    return res.status(400).json({
      ok: false,
      error:
        '분석할 종목 티커가 필요합니다.',
    });
  }

  try {
    /*
     * ========================================================
     * 1. 기존 Signal Engine
     * ========================================================
     *
     * 기존 분석 엔진은 그대로 사용한다.
     */
    const signal =
      await buildSignal(
        ticker,
        label || ticker
      );

    /*
     * ========================================================
     * 2. AI Presentation Layer
     * ========================================================
     *
     * 기존 Multi-Agent 결과를
     * UI / Ranking / Tracking에서
     * 바로 사용할 수 있는 형태로 변환한다.
     */
    const previousSignal =
      getPreviousSignal(
        req
      );

    const ai =
      buildAIPresentation(
        {
          ...signal,

          ticker,

          label:
            label || ticker,
        },
        {
          ticker,

          label:
            label || ticker,

          previousSignal,
        }
      );

    /*
     * ========================================================
     * 3. API Response
     * ========================================================
     *
     * 기존 응답 필드는 그대로 유지하고
     * ai 객체를 추가한다.
     *
     * 따라서 기존 프론트가
     * signal.score / signal.signal 등을
     * 사용해도 깨지지 않는다.
     */
    return res.status(200).json({
      ok: true,

      ...signal,

      ticker,

      label:
        label || ticker,

      ai,
    });

  } catch (err) {
    console.error(
      '[api/signal]',
      err
    );

    return res.status(500).json({
      ok: false,

      error:
        err?.message ||
        '종목 신호 분석에 실패했습니다.',

      ticker,

      type:
        err?.name ||
        'Error',
    });
  }
};
