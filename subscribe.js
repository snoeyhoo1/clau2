// api/push/subscribe.js
const { kv } = require('@vercel/kv');
const crypto = require('crypto');

function keyFor(endpoint) {
  return `push:sub:${crypto.createHash('sha256').update(endpoint).digest('hex')}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원' });
  try {
    const subscription = req.body;
    if (!subscription?.endpoint) {
      return res.status(400).json({ error: '유효하지 않은 구독 정보' });
    }
    await kv.set(keyFor(subscription.endpoint), subscription);
    // 전체 구독 목록을 순회할 수 있도록 인덱스에도 추가
    await kv.sadd('push:sub:index', keyFor(subscription.endpoint));
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
