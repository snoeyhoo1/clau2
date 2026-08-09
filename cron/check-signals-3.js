// api/cron/check-signals.js
const { kv } = require('@vercel/kv');
const { scanUniverse } = require('../../lib/signalEngine');
const { FULL_UNIVERSE } = require('../../lib/universe');
const { isConfigured, sendToSubscription } = require('../../lib/push');

const STRONG_BUY_THRESHOLD = 60; // 일반 매수우세(40)보다 높은 기준으로 알림 스팸 방지
const STATE_KEY = 'signal:lastState';

module.exports = async (req, res) => {
  // GitHub Actions / 외부 스케줄러 인증 (아무나 이 URL을 호출해서 푸시를 남발하지 못하게)
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: '인증 실패' });
  }

  try {
    const { ranked } = await scanUniverse(FULL_UNIVERSE);

    const prevState = (await kv.get(STATE_KEY)) || {};
    const newState = {};
    const newStrongSignals = [];

    for (const s of ranked) {
      newState[s.ticker] = s.combinedScore;
      const prevScore = prevState[s.ticker] ?? 0;
      // 이전엔 강한 매수 기준 미만이었는데 지금 처음 넘은 경우만 "새 신호"로 간주
      if (s.combinedScore >= STRONG_BUY_THRESHOLD && prevScore < STRONG_BUY_THRESHOLD) {
        newStrongSignals.push(s);
      }
    }
    await kv.set(STATE_KEY, newState);

    if (newStrongSignals.length === 0) {
      return res.status(200).json({ checked: ranked.length, newSignals: 0 });
    }

    if (!isConfigured()) {
      return res.status(200).json({
        checked: ranked.length,
        newSignals: newStrongSignals.length,
        pushSent: false,
        note: 'VAPID 키 미설정으로 푸시는 발송되지 않음',
      });
    }

    const title = `강한 매수 신호 ${newStrongSignals.length}건`;
    const body = newStrongSignals
      .slice(0, 5)
      .map((s) => `${s.label} (${s.combinedScore})`)
      .join(', ');

    const subKeys = (await kv.smembers('push:sub:index')) || [];
    let sent = 0;
    for (const key of subKeys) {
      const sub = await kv.get(key);
      if (!sub) continue;
      const result = await sendToSubscription(sub, {
        title,
        body,
        url: '/',
      });
      if (result.ok) sent++;
      else if (result.statusCode === 404 || result.statusCode === 410) {
        // 만료된 구독 정리
        await kv.del(key);
        await kv.srem('push:sub:index', key);
      }
    }

    res.status(200).json({
      checked: ranked.length,
      newSignals: newStrongSignals.length,
      pushSent: true,
      delivered: sent,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
