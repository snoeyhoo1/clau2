// api/push.js

const {
  guard,
} = require('../lib/auth');

const {
  kv,
} = require('@vercel/kv');

const crypto =
  require('crypto');

function keyFor(
  endpoint
) {
  return (
    `push:sub:${crypto
      .createHash('sha256')
      .update(endpoint)
      .digest('hex')}`
  );
}

module.exports =
  async (
    req,
    res
  ) => {
    if (
      guard(req, res)
    ) {
      return;
    }

    const action =
      String(
        req.query?.action || ''
      ).toLowerCase();

    if (
      action === 'subscribe'
    ) {
      if (
        req.method !== 'POST'
      ) {
        return res.status(405).json({
          error:
            'POST만 지원',
        });
      }

      try {
        const subscription =
          req.body;

        if (
          !subscription?.endpoint
        ) {
          return res.status(400).json({
            error:
              '유효하지 않은 구독 정보',
          });
        }

        const key =
          keyFor(
            subscription.endpoint
          );

        await kv.set(
          key,
          subscription
        );

        await kv.sadd(
          'push:sub:index',
          key
        );

        return res.status(200).json({
          ok: true,
        });
      } catch (err) {
        return res.status(500).json({
          error:
            err?.message ||
            '구독 저장 실패',
        });
      }
    }

    if (
      action === 'unsubscribe'
    ) {
      if (
        req.method !== 'POST'
      ) {
        return res.status(405).json({
          error:
            'POST만 지원',
        });
      }

      try {
        const {
          endpoint,
        } =
          req.body || {};

        if (!endpoint) {
          return res.status(400).json({
            error:
              'endpoint 필요',
          });
        }

        const key =
          keyFor(
            endpoint
          );

        await kv.del(
          key
        );

        await kv.srem(
          'push:sub:index',
          key
        );

        return res.status(200).json({
          ok: true,
        });
      } catch (err) {
        return res.status(500).json({
          error:
            err?.message ||
            '구독 해제 실패',
        });
      }
    }

    if (
      action ===
      'vapid-public-key'
    ) {
      if (
        !process.env
          .VAPID_PUBLIC_KEY
      ) {
        return res.status(503).json({
          error:
            'VAPID 키가 설정되지 않았습니다. 서버 환경변수를 확인하세요.',
        });
      }

      return res.status(200).json({
        publicKey:
          process.env
            .VAPID_PUBLIC_KEY,
      });
    }

    return res.status(404).json({
      error:
        '지원하지 않는 Push 경로입니다.',
    });
  };
