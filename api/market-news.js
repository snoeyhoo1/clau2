// api/market-news.js

const {
  guard,
} = require('../lib/auth');

const FEEDS = [
  {
    category: 'KOREA',
    query:
      '한국 증시 코스피 코스닥 외국인 기관',
  },

  {
    category: 'US',
    query:
      '미국 증시 나스닥 S&P500 연준',
  },

  {
    category:
      'SEMICONDUCTOR',
    query:
      '반도체 삼성전자 SK하이닉스 엔비디아',
  },

  {
    category: 'MACRO',
    query:
      '금리 환율 유가 인플레이션 경제',
  },

  {
    category: 'GLOBAL',
    query:
      'global stock market economy finance',
  },
];

const FEED_TIMEOUT_MS =
  10000;

const DEFAULT_NEWS_LIMIT =
  8;

const MAX_NEWS_LIMIT =
  8;

function decodeXml(
  value
) {
  return String(
    value || ''
  )
    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/g,
      '$1'
    )
    .replace(
      /&amp;/g,
      '&'
    )
    .replace(
      /&lt;/g,
      '<'
    )
    .replace(
      /&gt;/g,
      '>'
    )
    .replace(
      /&quot;/g,
      '"'
    )
    .replace(
      /&#39;/g,
      "'"
    );
}

function stripHtml(
  value
) {
  return decodeXml(value)
    .replace(
      /<[^>]*>/g,
      ''
    )
    .trim();
}

function getTag(
  block,
  tag
) {
  const match =
    block.match(
      new RegExp(
        `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
        'i'
      )
    );

  return match
    ? stripHtml(
        match[1]
      )
    : '';
}

function getLink(
  block
) {
  const match =
    block.match(
      /<link[^>]*>([\s\S]*?)<\/link>/i
    );

  return match
    ? decodeXml(
        match[1]
      ).trim()
    : '';
}

async function fetchFeed(
  category,
  query
) {
  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(
      query
    ) +
    '&hl=ko&gl=KR&ceid=KR:ko';

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => {
        controller.abort();
      },
      FEED_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (signal-desk)',

            Accept:
              'application/rss+xml,text/xml',
          },

          signal:
            controller.signal,
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `뉴스 요청 실패 (${response.status})`
      );
    }

    const xml =
      await response.text();

    const blocks =
      [
        ...xml.matchAll(
          /<item>([\s\S]*?)<\/item>/gi
        ),
      ];

    return blocks
      .map(
        match => {
          const block =
            match[1];

          const title =
            getTag(
              block,
              'title'
            );

          const description =
            getTag(
              block,
              'description'
            );

          const pubDate =
            getTag(
              block,
              'pubDate'
            );

          const link =
            getLink(
              block
            );

          const source =
            getTag(
              block,
              'source'
            );

          if (!title) {
            return null;
          }

          return {
            title,
            description,
            pubDate,
            link,
            source,
            category,
          };
        }
      )
      .filter(Boolean);

  } catch (error) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        `${category} 뉴스 요청 시간 초과`
      );
    }

    throw error;

  } finally {
    clearTimeout(
      timer
    );
  }
}

module.exports = async (
  req,
  res
) => {
  if (
    guard(
      req,
      res
    )
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

  if (
    req.method !== 'GET'
  ) {
    return res.status(405).json({
      ok: false,

      error:
        'GET만 지원합니다.',

      articles: [],
    });
  }

  try {
    const requestedLimit =
      Number(
        req.query?.limit
      );

    const limit =
      Number.isFinite(
        requestedLimit
      )
        ? Math.max(
            1,
            Math.min(
              MAX_NEWS_LIMIT,
              Math.floor(
                requestedLimit
              )
            )
          )
        : DEFAULT_NEWS_LIMIT;

    const results =
      await Promise.allSettled(
        FEEDS.map(
          feed =>
            fetchFeed(
              feed.category,
              feed.query
            )
        )
      );

    const articles = [];

    const failedCategories =
      [];

    results.forEach(
      (
        result,
        index
      ) => {
        if (
          result.status ===
          'fulfilled'
        ) {
          articles.push(
            ...result.value
          );
        } else {
          failedCategories.push({
            category:
              FEEDS[index]
                .category,

            error:
              result.reason
                ?.message ||
              '뉴스 요청 실패',
          });

          console.warn(
            '[api/market-news]',
            FEEDS[index]
              .category,
            result.reason
          );
        }
      }
    );

    const seen =
      new Set();

    const unique =
      articles.filter(
        article => {
          const key =
            article.title
              .toLowerCase()
              .replace(
                /\s+/g,
                ' '
              )
              .trim();

          if (
            seen.has(key)
          ) {
            return false;
          }

          seen.add(key);

          return true;
        }
      );

    unique.sort(
      (a, b) => {
        const ta =
          Date.parse(
            a.pubDate
          ) || 0;

        const tb =
          Date.parse(
            b.pubDate
          ) || 0;

        return tb - ta;
      }
    );

    const successfulFeeds =
      FEEDS.length -
      failedCategories.length;

    return res.status(200).json({
      ok:
        unique.length > 0 ||
        successfulFeeds > 0,

      articles:
        unique.slice(
          0,
          limit
        ),

      generatedAt:
        new Date().toISOString(),

      source:
        'Google News RSS',

      categories:
        FEEDS.map(
          feed =>
            feed.category
        ),

      status: {
        totalFeeds:
          FEEDS.length,

        successfulFeeds,

        failedFeeds:
          failedCategories.length,

        failedCategories,
      },
    });

  } catch (error) {
    console.error(
      '[api/market-news]',
      error
    );

    return res.status(500).json({
      ok: false,

      error:
        error?.message ||
        '시장 뉴스 조회 실패',

      articles: [],

      status: {
        totalFeeds:
          FEEDS.length,

        successfulFeeds:
          0,

        failedFeeds:
          FEEDS.length,
      },
    });
  }
};
