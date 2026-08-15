// api/market-news.js
//
// 주요 시장 뉴스 Aggregator
//
// Google News RSS를 여러 검색어로 조회하고
// 중복 기사를 제거하여 시장 전체 뉴스로 제공한다.

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
    category: 'SEMICONDUCTOR',
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

function decodeXml(value) {
  return String(value || '')
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

function stripHtml(value) {
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
    ? stripHtml(match[1])
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
    encodeURIComponent(query) +
    '&hl=ko&gl=KR&ceid=KR:ko';

  const response =
    await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (signal-desk)',
        Accept:
          'application/rss+xml,text/xml',
      },
    });

  if (!response.ok) {
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
      (match) => {
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
}

module.exports = async (
  req,
  res
) => {
  try {
    const limitRaw =
      Number(
        req.query?.limit
      );

    const limit =
      Number.isFinite(
        limitRaw
      )
        ? Math.max(
            5,
            Math.min(
              30,
              Math.floor(
                limitRaw
              )
            )
          )
        : 20;

    const results =
      await Promise.allSettled(
        FEEDS.map(
          (feed) =>
            fetchFeed(
              feed.category,
              feed.query
            )
        )
      );

    const articles = [];

    results.forEach(
      (result) => {
        if (
          result.status ===
          'fulfilled'
        ) {
          articles.push(
            ...result.value
          );
        }
      }
    );

    /*
     * 같은 제목 중복 제거.
     */
    const seen =
      new Set();

    const unique =
      articles.filter(
        (article) => {
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

    /*
     * 최신 뉴스 우선.
     */
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

    return res.status(200).json({
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
          (feed) =>
            feed.category
        ),
    });
  } catch (error) {
    console.error(
      '[api/market-news]',
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        '시장 뉴스 조회 실패',

      articles: [],
    });
  }
};
