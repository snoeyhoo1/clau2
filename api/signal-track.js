// api/signal-track.js
//
// cron/check-signals.js가 KV에 쌓아온 "신호 → 실제 결과" 로그를
// 요약해서 보여준다. AI 판단이 실제로 얼마나 맞았는지 확인하는 용도.

const {
  guard,
} = require('../lib/auth');

const {
  getSignalTrackRecord,
} = require('../lib/signalLog');

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

  try {
    const track =
      await getSignalTrackRecord();

    return res.status(200).json({
      ok: true,
      ...track,
      generatedAt:
        new Date().toISOString(),
    });

  } catch (err) {
    console.error(
      '[api/signal-track]',
      err
    );

    return res.status(500).json({
      ok: false,
      error:
        err?.message ||
        '신호 추적 데이터 조회 실패',
    });
  }
};

