// lib/push.js
const webpush = require('web-push');

function isConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configure() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:example@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

async function sendToSubscription(subscription, payload) {
  configure();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    // 410/404면 구독이 만료된 것 -> 호출 측에서 KV에서 삭제 처리해야 함
    return { ok: false, statusCode: err.statusCode, message: err.message };
  }
}

module.exports = { isConfigured, sendToSubscription };
