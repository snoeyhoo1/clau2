// api/push/unsubscribe.js
const { kv } = require('@vercel/kv');
const crypto = require('crypto');

function keyFor(endpoint) {
  return `push:sub:${crypto.createHash('sha256').update(endpoint).digest('hex')}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원' });
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint 필요' });
    const key = keyFor(endpoint);
    await kv.del(key);
    await kv.srem('push:sub:index', key);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
