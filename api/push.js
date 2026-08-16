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

function isValidEndpoint(
  endpoint
) {
  if (
    typeof endpoint !==
    'string'
  ) {
    return false;
  }

  const value =
    endpoint.trim();

  if (
    !value ||
    value.length > 2048
  ) {
    return false;
  }

  try {
    const url =
      new URL(value);

    return (
      url.protocol ===
        'https:' &&
      Boolean(
        url.hostname
      )
    );
  } catch {
    return false;
  }
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

    res.setHeader(
      'Cache-Control',
      'no-store, max-age=0'
    );

    res.setHeader(
      'X-Content-Type-Options',
      'nosniff'
    );

    const action =
      String(
        req.query?.action ||
          ''
      )
        .trim()
        .toLowerCase();

    if (
      action ===
      'subscribe'
    ) {
      if (
        req.method !==
        'POST'
      ) {
        return res.status(405).json({
          ok: false,

          error:
            'POST만 지원합니다.',
        });
      }

      try {
        const subscription =
          req.body;

        if (
          !subscription ||
          typeof subscription !==
            'object'
        ) {
          return res.status(400).json({
            ok: false,

            error:
              '유효하지 않은 구독 정보입니다.',
          });
        }

        const endpoint =
          String(
            subscription.endpoint ||
              ''
          ).trim();

        if (
          !isValidEndpoint(
            endpoint
          )
        ) {
          return res.status(400).json({
            ok: false,

            error:
              '유효하지 않은 Push endpoint입니다.',
          });
        }

        const normalized =
          {
            ...subscription,

            endpoint,
          };

        const key =
          keyFor(
            endpoint
          );

        await kv.set(
          key,
          normalized
        );

        await kv.sadd(
          'push:sub:index',
          key
        );

        return res.status(200).json({
          ok: true,

          subscribed: true,
        });

      } catch (err) {
        console.error(
          '[api/push/subscribe]',
          err
        );

        return res.status(500).json({
          ok: false,

          error:
            err?.message ||
            '구독 저장 실패',

          type:
            err?.name ||
            'Error',
        });
      }
    }

    if (
      action ===
      'unsubscribe'
    ) {
      if (
        req.method !==
        'POST'
      ) {
        return res.status(405).json({
          ok: false,

          error:
            'POST만 지원합니다.',
        });
      }

      try {
        const {
          endpoint,
        } =
          req.body || {};

        const normalizedEndpoint =
          String(
            endpoint || ''
          ).trim();

        if (
          !isValidEndpoint(
            normalizedEndpoint
          )
        ) {
          return res.status(400).json({
            ok: false,

            error:
              '유효한 endpoint가 필요합니다.',
          });
        }

        const key =
          keyFor(
            normalizedEndpoint
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

          subscribed: false,
        });

      } catch (err) {
        console.error(
          '[api/push/unsubscribe]',
          err
        );

        return res.status(500).json({
          ok: false,

          error:
            err?.message ||
            '구독 해제 실패',

          type:
            err?.name ||
            'Error',
        });
      }
    }

    if (
      action ===
      'vapid-public-key'
    ) {
      if (
        req.method !==
        'GET'
      ) {
        return res.status(405).json({
          ok: false,

          error:
            'GET만 지원합니다.',
        });
      }

      const publicKey =
        String(
          process.env
            .VAPID_PUBLIC_KEY ||
            ''
        ).trim();

      if (!publicKey) {
        return res.status(503).json({
          ok: false,

          error:
            'VAPID 키가 설정되지 않았습니다. 서버 환경변수를 확인하세요.',
        });
      }

      return res.status(200).json({
        ok: true,

        publicKey,
      });
    }

    return res.status(404).json({
      ok: false,

      error:
        '지원하지 않는 Push 경로입니다.',
    });
  };
