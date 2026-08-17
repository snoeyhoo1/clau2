/*
 * ============================================================
 * CLAU2 MARKET RANKING
 * ============================================================
 *
 * 증권사 HTS 스타일 종목 랭킹 UI
 *
 * API:
 *   /api/rankings
 *
 * 지원:
 *   popular
 *   volume
 *   gainers
 *   losers
 *   volume-count
 *   ai
 *   confidence
 *
 * 기존 SIGNAL DESK 기능은 건드리지 않는다.
 * ============================================================
 */

(() => {
  'use strict';


  /* ============================================================
   * DOM
   * ============================================================ */

  const rankingList =
    document.getElementById(
      'rankingList'
    );

  const aiRankingList =
    document.getElementById(
      'aiRankingList'
    );

  const rankingTabs =
    Array.from(
      document.querySelectorAll(
        '.ranking-tab'
      )
    );

  const navButtons =
    Array.from(
      document.querySelectorAll(
        '[data-nav-target]'
      )
    );


  if (
    !rankingList &&
    !aiRankingList
  ) {
    return;
  }


  /* ============================================================
   * STATE
   * ============================================================ */

  let currentRanking =
    'popular';

  let loading = false;

  let lastRequest = 0;

  const CACHE_MS =
    30 * 1000;


  const cache =
    new Map();


  /* ============================================================
   * UTILS
   * ============================================================ */

  function number(
    value,
    fallback = null
  ) {
    const n =
      Number(value);

    return Number.isFinite(n)
      ? n
      : fallback;
  }


  function escapeHtml(
    value
  ) {
    return String(
      value ?? ''
    )
      .replaceAll(
        '&',
        '&amp;'
      )
      .replaceAll(
        '<',
        '&lt;'
      )
      .replaceAll(
        '>',
        '&gt;'
      )
      .replaceAll(
        '"',
        '&quot;'
      )
      .replaceAll(
        "'",
        '&#039;'
      );
  }


  function formatPrice(
    value,
    ticker
  ) {
    const n =
      number(value);


    if (
      n === null
    ) {
      return '—';
    }


    const isKorea =
      String(
        ticker || ''
      )
        .toUpperCase()
        .endsWith(
          '.KS'
        ) ||
      String(
        ticker || ''
      )
        .toUpperCase()
        .endsWith(
          '.KQ'
        );


    if (
      isKorea
    ) {
      return Math.round(n)
        .toLocaleString(
          'ko-KR'
        );
    }


    return n.toLocaleString(
      'en-US',
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }
    );
  }


  function formatPercent(
    value
  ) {
    const n =
      number(value);


    if (
      n === null
    ) {
      return '—';
    }


    return (
      n >= 0
        ? '+'
        : ''
    ) +
      n.toFixed(2) +
      '%';
  }


  function formatAmount(
    value
  ) {
    const n =
      number(value);


    if (
      n === null
    ) {
      return '—';
    }


    const abs =
      Math.abs(n);


    if (
      abs >=
      1_000_000_000_000
    ) {
      return (
        (
          n /
          1_000_000_000_000
        ).toFixed(2) +
        '조'
      );
    }


    if (
      abs >=
      100_000_000
    ) {
      return (
        (
          n /
          100_000_000
        ).toFixed(1) +
        '억'
      );
    }


    if (
      abs >=
      10_000
    ) {
      return (
        (
          n /
          10_000
        ).toFixed(1) +
        '만'
      );
    }


    return n.toLocaleString(
      'ko-KR'
    );
  }


  function marketName(
    ticker
  ) {
    const value =
      String(
        ticker || ''
      )
        .toUpperCase();


    if (
      value.endsWith('.KS')
    ) {
      return 'KOSPI';
    }


    if (
      value.endsWith('.KQ')
    ) {
      return 'KOSDAQ';
    }


    return 'US';
  }


  function changeClass(
    value
  ) {
    const n =
      number(value, 0);


    if (
      n > 0
    ) {
      return 'up';
    }


    if (
      n < 0
    ) {
      return 'down';
    }


    return 'flat';
  }


  function signalType(
    value
  ) {
    const text =
      String(
        value || ''
      )
        .toUpperCase();


    if (
      text.includes('BUY') ||
      text.includes('LONG')
    ) {
      return 'buy';
    }


    if (
      text.includes('SELL') ||
      text.includes('SHORT') ||
      text.includes('EXIT')
    ) {
      return 'sell';
    }


    return 'wait';
  }


  /* ============================================================
   * API
   * ============================================================ */

  async function fetchRanking(
    type,
    market = 'all',
    limit = 10
  ) {

    const key =
      `${market}:${type}:${limit}`;


    const cached =
      cache.get(key);


    if (
      cached &&
      Date.now() -
        cached.time <
        CACHE_MS
    ) {
      return cached.data;
    }


    const params =
      new URLSearchParams({

        market,

        type,

        limit:
          String(
            limit
          ),

      });


    const response =
      await fetch(
        `/api/rankings?${params.toString()}`,
        {
          method: 'GET',

          cache:
            'no-store',

          headers: {
            Accept:
              'application/json',
          },
        }
      );


    const text =
      await response.text();


    let data;


    try {
      data =
        text
          ? JSON.parse(text)
          : {};
    } catch {
      throw new Error(
        '랭킹 API 응답을 읽을 수 없습니다.'
      );
    }


    if (
      !response.ok ||
      data?.ok === false
    ) {
      throw new Error(
        data?.error ||
        data?.message ||
        `랭킹 조회 실패 (${response.status})`
      );
    }


    cache.set(
      key,
      {
        time:
          Date.now(),

        data,
      }
    );


    return data;
  }


  /* ============================================================
   * NORMALIZE
   * ============================================================ */

  function normalizeRow(
    row
  ) {
    return {

      rank:
        number(
          row?.rank,
          0
        ),

      ticker:
        String(
          row?.ticker ||
          ''
        ),

      name:
        String(
          row?.label ||
          row?.name ||
          row?.ticker ||
          ''
        ),

      price:
        number(
          row?.price
        ),

      changePct:
        number(
          row?.changePct
        ),

      aiScore:
        number(
          row?.aiScore
        ),

      aiConfidence:
        number(
          row?.aiConfidence
        ),

      aiLabel:
        String(
          row?.aiLabel ||
          ''
        ),

      decision:
        String(
          row?.decision ||
          'WAIT'
        ),

      regime:
        String(
          row?.regime ||
          ''
        ),

      volume:
        number(
          row?.volume
        ),

      tradingValue:
        number(
          row?.tradingValue
        ),

    };
  }


  /* ============================================================
   * RENDER: NORMAL RANKING
   * ============================================================ */

  function renderRanking(
    rows,
    type
  ) {

    if (
      !rankingList
    ) {
      return;
    }


    if (
      !Array.isArray(rows) ||
      rows.length === 0
    ) {

      rankingList.innerHTML = `
        <div class="ranking-empty">
          <div>
            현재 표시할 종목 데이터가 없습니다.
          </div>
        </div>
      `;

      return;
    }


    rankingList.innerHTML =
      rows
        .map(
          raw => {

            const row =
              normalizeRow(
                raw
              );


            const change =
              changeClass(
                row.changePct
              );


            const market =
              marketName(
                row.ticker
              );


            let rightValue =
              formatPercent(
                row.changePct
              );


            /*
             * 거래대금 순위에서는
             * 거래대금이 실제 존재할 때만 표시.
             */

            if (
              type === 'volume'
            ) {
              rightValue =
                formatAmount(
                  row.tradingValue
                );
            }


            /*
             * 거래량 순위.
             */

            if (
              type === 'volume-count'
            ) {
              rightValue =
                formatAmount(
                  row.volume
                );
            }


            return `
              <div
                class="ranking-row"
                data-ticker="${escapeHtml(
                  row.ticker
                )}"
              >

                <span
                  class="ranking-rank"
                >
                  ${escapeHtml(
                    row.rank
                  )}
                </span>


                <div
                  class="ranking-stock"
                >

                  <strong>
                    ${escapeHtml(
                      row.name
                    )}
                  </strong>

                  <span>
                    ${escapeHtml(
                      row.ticker
                    )}
                    ·
                    ${escapeHtml(
                      market
                    )}
                  </span>

                </div>


                <div
                  class="ranking-price"
                >
                  ${formatPrice(
                    row.price,
                    row.ticker
                  )}
                </div>


                <div
                  class="
                    ranking-change
                    ${change}
                  "
                >
                  ${rightValue}
                </div>

              </div>
            `;
          }
        )
        .join('');


    bindRows();
  }


  /* ============================================================
   * RENDER: AI
   * ============================================================ */

  function renderAiRanking(
    rows
  ) {

    if (
      !aiRankingList
    ) {
      return;
    }


    if (
      !Array.isArray(rows) ||
      rows.length === 0
    ) {

      aiRankingList.innerHTML = `
        <div class="ranking-empty">
          <div>
            AI PICK 데이터가 없습니다.
          </div>
        </div>
      `;

      return;
    }


    aiRankingList.innerHTML =
      rows
        .map(
          raw => {

            const row =
              normalizeRow(
                raw
              );


            const type =
              signalType(
                row.decision
              );


            const score =
              row.aiScore === null
                ? '—'
                : Math.round(
                    row.aiScore
                  );


            return `
              <div
                class="ranking-row"
                data-ticker="${escapeHtml(
                  row.ticker
                )}"
              >

                <span
                  class="ranking-rank"
                >
                  ${escapeHtml(
                    row.rank
                  )}
                </span>


                <div
                  class="ranking-stock"
                >

                  <strong>
                    ${escapeHtml(
                      row.name
                    )}
                  </strong>

                  <span>
                    ${escapeHtml(
                      row.ticker
                    )}
                    ·
                    ${escapeHtml(
                      row.regime ||
                      'MARKET'
                    )}
                  </span>

                </div>


                <div
                  class="ai-score"
                >
                  ${score}
                </div>


                <div
                  class="
                    ai-signal
                    ${type}
                  "
                >
                  ${escapeHtml(
                    row.decision
                  )}
                </div>

              </div>
            `;
          }
        )
        .join('');


    bindRows();
  }


  /* ============================================================
   * ROW CLICK
   * ============================================================ */

  function bindRows() {

    document
      .querySelectorAll(
        '.ranking-row'
      )
      .forEach(
        row => {

          row.addEventListener(
            'click',
            () => {

              const ticker =
                row.dataset.ticker;


              if (
                !ticker
              ) {
                return;
              }


              /*
               * 기존 검색 기능을 활용한다.
               */

              const input =
                document.getElementById(
                  'searchInput'
                );

              const searchButton =
                document.getElementById(
                  'searchBtn'
                );


              if (
                input
              ) {
                input.value =
                  ticker;
              }


              if (
                searchButton
              ) {

                searchButton.click();


                window.scrollTo({
                  top: 0,

                  behavior:
                    'smooth',
                });


                return;
              }


              /*
               * 검색 UI가 없는 경우
               * URL query만 업데이트.
               */

              try {

                const url =
                  new URL(
                    window.location.href
                  );


                url.searchParams.set(
                  'ticker',
                  ticker
                );


                window.history.pushState(
                  {},
                  '',
                  url
                );

              } catch {
                // ignore
              }

            }
          );

        }
      );
  }


  /* ============================================================
   * LOAD
   * ============================================================ */

  async function load(
    type =
      currentRanking
  ) {

    if (
      loading
    ) {
      return;
    }


    loading =
      true;


    const requestId =
      Date.now();


    lastRequest =
      requestId;


    if (
      rankingList
    ) {

      rankingList.innerHTML = `
        <div class="ranking-loading">
          ${type === 'ai'
            ? 'clau2 AI가 종목을 분석하는 중...'
            : '시장 순위를 불러오는 중...'}
        </div>
      `;

    }


    if (
      aiRankingList
    ) {

      aiRankingList.innerHTML = `
        <div class="ranking-loading">
          AI PICK을 불러오는 중...
        </div>
      `;

    }


    try {

      /*
       * 선택한 랭킹.
       */

      const data =
        await fetchRanking(
          type,
          'all',
          10
        );


      /*
       * 이미 더 최신 요청이 실행됐다면
       * 현재 결과를 화면에 덮어쓰지 않는다.
       */

      if (
        requestId !==
        lastRequest
      ) {
        return;
      }


      const rows =
        Array.isArray(
          data?.rows
        )
          ? data.rows
          : [];


      const aiPicks =
        Array.isArray(
          data?.aiPicks
        )
          ? data.aiPicks
          : [];


      renderRanking(
        rows,
        type
      );


      renderAiRanking(
        aiPicks
      );


    } catch (
      error
    ) {

      console.error(
        '[CLAU2 RANKING]',
        error
      );


      if (
        rankingList
      ) {

        rankingList.innerHTML = `
          <div class="ranking-empty">

            <div>

              랭킹 데이터를 불러오지 못했습니다.

              <br><br>

              <span
                style="
                  color:var(--sell);
                  font-size:10px;
                "
              >
                ${escapeHtml(
                  error.message
                )}
              </span>

            </div>

          </div>
        `;

      }


      if (
        aiRankingList
      ) {

        aiRankingList.innerHTML = `
          <div class="ranking-empty">
            AI PICK을 불러오지 못했습니다.
          </div>
        `;

      }

    } finally {

      loading =
        false;

    }

  }


  /* ============================================================
   * TABS
   * ============================================================ */

  function activateTab(
    type
  ) {

    currentRanking =
      type;


    rankingTabs.forEach(
      tab => {

        tab.classList.toggle(
          'active',
          tab.dataset.ranking ===
            type
        );

      }
    );


    load(
      type
    );

  }


  rankingTabs.forEach(
    tab => {

      tab.addEventListener(
        'click',
        () => {

          activateTab(
            tab.dataset.ranking ||
            'popular'
          );

        }
      );

    }
  );


  /* ============================================================
   * NAV
   * ============================================================ */

  function setNavActive(
    target
  ) {

    navButtons.forEach(
      button => {

        button.classList.toggle(
          'active',
          button.dataset.navTarget ===
            target
        );

      }
    );


    document
      .querySelectorAll(
        '.quick-btn'
      )
      .forEach(
        button => {

          button.classList.toggle(
            'active',
            button.dataset.navTarget ===
              target
          );

        }
      );

  }


  function handleNavigation(
    target
  ) {

    if (
      !target
    ) {
      return;
    }


    setNavActive(
      target
    );


    const rankingTypes = {

      popular:
        'popular',

      volume:
        'volume',

      gainers:
        'gainers',

      losers:
        'losers',

      'volume-count':
        'volume-count',

      ai:
        'ai',

    };


    if (
      rankingTypes[
        target
      ]
    ) {

      activateTab(
        rankingTypes[
          target
        ]
      );


      const section =
        document.getElementById(
          'rankingSection'
        );


      if (
        section
      ) {

        section.scrollIntoView({
          behavior:
            'smooth',

          block:
            'start',
        });

      }


      return;
    }


    if (
      target === 'home'
    ) {

      window.scrollTo({
        top: 0,

        behavior:
          'smooth',
      });

      return;
    }


    const sectionMap = {

      market:
        'marketOverview',

      account:
        'accountSection',

      backtest:
        'signalTrackSection',

    };


    const sectionId =
      sectionMap[
        target
      ];


    if (
      sectionId
    ) {

      const section =
        document.getElementById(
          sectionId
        );


      if (
        section
      ) {

        section.scrollIntoView({
          behavior:
            'smooth',

          block:
            'start',
        });

      }

    }

  }


  navButtons.forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          handleNavigation(
            button.dataset.navTarget
          );

        }
      );

    }
  );


  /* ============================================================
   * REFRESH
   * ============================================================ */

  function refresh() {

    cache.clear();

    load(
      currentRanking
    );

  }


  window.addEventListener(
    'clau2:refresh-ranking',
    refresh
  );


  const refreshButton =
    document.getElementById(
      'refreshBtn'
    );


  if (
    refreshButton
  ) {

    refreshButton.addEventListener(
      'click',
      () => {

        window.setTimeout(
          refresh,
          200
        );

      }
    );

  }


  /* ============================================================
   * INIT
   * ============================================================ */

  function init() {

    activateTab(
      'popular'
    );

  }


  if (
    document.readyState ===
    'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      init,
      {
        once: true,
      }
    );

  } else {

    init();

  }

})();
