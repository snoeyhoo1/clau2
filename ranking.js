/*
 * ============================================================
 * CLAU2 MARKET RANKING
 * ============================================================
 *
 * 기존 SIGNAL DESK 기능을 건드리지 않고
 * 홈 화면에 증권사식 종목 랭킹을 추가한다.
 *
 * 데이터:
 *   /api/scan
 *
 * 화면:
 *   - 인기
 *   - 거래대금
 *   - 상승
 *   - 하락
 *   - 거래량
 *   - AI PICK
 *
 * 주의:
 *   scan API의 필드명이 일부 달라져도
 *   여러 후보 필드명을 순차적으로 확인하도록 작성했다.
 * ============================================================
 */

(() => {
  'use strict';


  /* ============================================================
   * DOM
   * ============================================================ */

  const rankingList =
    document.getElementById('rankingList');

  const aiRankingList =
    document.getElementById('aiRankingList');

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

  let scanData = null;

  let currentRanking =
    'popular';

  let loading = false;

  let lastLoadedAt = 0;


  const CACHE_MS =
    60 * 1000;


  /* ============================================================
   * BASIC UTILS
   * ============================================================ */

  function number(
    value,
    fallback = 0
  ) {
    const n =
      Number(value);

    return Number.isFinite(n)
      ? n
      : fallback;
  }


  function firstNumber(
    object,
    keys
  ) {
    if (!object) {
      return null;
    }

    for (const key of keys) {
      const value =
        object?.[key];

      const n =
        Number(value);

      if (
        Number.isFinite(n)
      ) {
        return n;
      }
    }

    return null;
  }


  function firstValue(
    object,
    keys,
    fallback = ''
  ) {
    if (!object) {
      return fallback;
    }

    for (const key of keys) {
      const value =
        object?.[key];

      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ''
      ) {
        return value;
      }
    }

    return fallback;
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
    market
  ) {
    const n =
      Number(value);

    if (
      !Number.isFinite(n)
    ) {
      return '—';
    }

    if (
      market === 'kr' ||
      market === 'korea' ||
      n >= 1000
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
        maximumFractionDigits: 2
      }
    );
  }


  function formatPercent(
    value
  ) {
    const n =
      Number(value);

    if (
      !Number.isFinite(n)
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


  function formatLargeNumber(
    value
  ) {
    const n =
      Number(value);

    if (
      !Number.isFinite(n)
    ) {
      return '—';
    }

    const abs =
      Math.abs(n);

    if (
      abs >= 1_000_000_000_000
    ) {
      return (
        (n / 1_000_000_000_000)
          .toFixed(2) +
        '조'
      );
    }

    if (
      abs >= 100_000_000
    ) {
      return (
        (n / 100_000_000)
          .toFixed(1) +
        '억'
      );
    }

    if (
      abs >= 10_000
    ) {
      return (
        (n / 10_000)
          .toFixed(1) +
        '만'
      );
    }

    return n.toLocaleString(
      'ko-KR'
    );
  }


  function signalLabel(
    item
  ) {
    const raw =
      firstValue(
        item,
        [
          'aiLabel',
          'decision',
          'classification',
          'signalText',
          'strategy'
        ],
        ''
      );

    if (raw) {
      return String(raw)
        .toUpperCase();
    }

    const signal =
      firstNumber(
        item,
        [
          'signal',
          'aiSignal'
        ]
      );

    if (
      signal === 1
    ) {
      return 'BUY';
    }

    if (
      signal === -1
    ) {
      return 'SELL';
    }

    return 'WAIT';
  }


  function signalType(
    label
  ) {
    const value =
      String(label)
        .toUpperCase();

    if (
      value.includes('BUY') ||
      value.includes('LONG')
    ) {
      return 'buy';
    }

    if (
      value.includes('SELL') ||
      value.includes('EXIT') ||
      value.includes('SHORT')
    ) {
      return 'sell';
    }

    return 'wait';
  }


  /* ============================================================
   * RESULT EXTRACTION
   * ============================================================ */

  function extractCandidates(
    data
  ) {
    if (!data) {
      return [];
    }


    const candidates = [];


    function addArray(
      value
    ) {
      if (
        !Array.isArray(value)
      ) {
        return;
      }

      for (
        const item of value
      ) {
        if (
          item &&
          typeof item === 'object'
        ) {
          candidates.push(item);
        }
      }
    }


    /*
     * scanUniverse에서 흔히 사용할 수 있는
     * 배열 이름들을 모두 확인한다.
     */
    addArray(
      data.ranked
    );
    addArray(
      data.results
    );

    addArray(
      data.items
    );

    addArray(
      data.stocks
    );

    addArray(
      data.universe
    );

    addArray(
      data.signals
    );

    addArray(
      data.candidates
    );

    addArray(
      data.buy
    );

    addArray(
      data.sell
    );

    addArray(
      data.buyCandidates
    );

    addArray(
      data.sellCandidates
    );


    /*
     * 결과가 { data: [...] } 형태인 경우.
     */

    addArray(
      data.data
    );


    /*
     * 중복 제거.
     */

    const seen =
      new Set();

    return candidates.filter(
      item => {
        const ticker =
          firstValue(
            item,
            [
              'ticker',
              'symbol',
              'code',
              'stockCode'
            ],
            ''
          );

        const key =
          String(
            ticker ||
            JSON.stringify(item)
          );

        if (
          seen.has(key)
        ) {
          return false;
        }

        seen.add(key);

        return true;
      }
    );
  }


  function normalizeItem(
    item
  ) {
    const ticker =
      firstValue(
        item,
        [
          'ticker',
          'symbol',
          'code',
          'stockCode'
        ],
        ''
      );


    const name =
      firstValue(
        item,
        [
          'name',
          'stockName',
          'companyName',
          'displayName'
        ],
        ticker
      );


    const price =
      firstNumber(
        item,
        [
          'price',
          'currentPrice',
          'close',
          'lastPrice',
          'current'
        ]
      );


    const change =
      firstNumber(
        item,
        [
          'changePercent',
          'changePct',
          'pctChange',
          'rate',
          'return',
          'change'
        ]
      );


    const volume =
      firstNumber(
        item,
        [
          'volume',
          'tradeVolume',
          'accVolume',
          'totalVolume'
        ]
      );


    const turnover =
      firstNumber(
        item,
        [
          'turnover',
          'tradingValue',
          'tradeValue',
          'amount',
          'tradingAmount'
        ]
      );


    const aiScore =
      firstNumber(
        item,
        [
          'aiScore',
          'score',
          'finalScore',
          'confidenceScore'
        ]
      );


    const confidence =
      firstNumber(
        item,
        [
          'confidence',
          'aiConfidence',
          'probability'
        ]
      );


    const market =
      String(
        firstValue(
          item,
          [
            'market',
            'exchange'
          ],
          ''
        )
      ).toLowerCase();


    return {
      raw: item,

      ticker:
        String(
          ticker
        ),

      name:
        String(
          name
        ),

      price,

      change,

      volume,

      turnover,

      aiScore,

      confidence,

      market,

      signal:
        signalLabel(
          item
        )
    };
  }


  /* ============================================================
   * SORTING
   * ============================================================ */

  function normalizedItems() {
    return extractCandidates(
      scanData
    )
      .map(
        normalizeItem
      )
      .filter(
        item =>
          item.ticker ||
          item.name
      );
  }


  function sortRanking(
    items,
    type
  ) {
    const list =
      [...items];


    if (
      type === 'gainers'
    ) {
      return list
        .sort(
          (
            a,
            b
          ) =>
            number(
              b.change
            ) -
            number(
              a.change
            )
        )
        .slice(
          0,
          10
        );
    }


    if (
      type === 'losers'
    ) {
      return list
        .sort(
          (
            a,
            b
          ) =>
            number(
              a.change
            ) -
            number(
              b.change
            )
        )
        .slice(
          0,
          10
        );
    }


    if (
      type === 'volume'
    ) {
      return list
        .sort(
          (
            a,
            b
          ) =>
            number(
              b.turnover
            ) -
            number(
              a.turnover
            )
        )
        .slice(
          0,
          10
        );
    }


    if (
      type === 'volume-count'
    ) {
      return list
        .sort(
          (
            a,
            b
          ) =>
            number(
              b.volume
            ) -
            number(
              a.volume
            )
        )
        .slice(
          0,
          10
        );
    }


    if (
      type === 'ai'
    ) {
      return list
        .filter(
          item =>
            Number.isFinite(
              item.aiScore
            )
        )
        .sort(
          (
            a,
            b
          ) =>
            number(
              b.aiScore
            ) -
            number(
              a.aiScore
            )
        )
        .slice(
          0,
          10
        );
    }


    /*
     * 인기:
     *
     * 단순 거래량 하나가 아니라
     * 거래대금 + 거래량 + 절대 등락률을
     * 합친 임시 popularity score.
     *
     * 이후 실제 인기 API가 생기면 교체한다.
     */

    return list
      .sort(
        (
          a,
          b
        ) => {

          const scoreA =
            Math.log10(
              1 +
              Math.max(
                0,
                number(
                  a.turnover
                )
              )
            ) *
              0.55 +
            Math.log10(
              1 +
              Math.max(
                0,
                number(
                  a.volume
                )
              )
            ) *
              0.30 +
            Math.min(
              20,
              Math.abs(
                number(
                  a.change
                )
              )
            ) *
              0.15;


          const scoreB =
            Math.log10(
              1 +
              Math.max(
                0,
                number(
                  b.turnover
                )
              )
            ) *
              0.55 +
            Math.log10(
              1 +
              Math.max(
                0,
                number(
                  b.volume
                )
              )
            ) *
              0.30 +
            Math.min(
              20,
              Math.abs(
                number(
                  b.change
                )
              )
            ) *
              0.15;


          return (
            scoreB -
            scoreA
          );
        }
      )
      .slice(
        0,
        10
      );
  }


  /* ============================================================
   * RENDER
   * ============================================================ */

  function renderRanking(
    items
  ) {
    if (
      !rankingList
    ) {
      return;
    }


    if (
      !items.length
    ) {
      rankingList.innerHTML = `
        <div class="ranking-loading">
          현재 표시할 종목 데이터가 없습니다.
        </div>
      `;

      return;
    }


    rankingList.innerHTML =
      items
        .map(
          (
            item,
            index
          ) => {

            const changeClass =
              number(
                item.change
              ) > 0
                ? 'up'
                : number(
                    item.change
                  ) < 0
                    ? 'down'
                    : 'flat';


            return `
              <div
                class="ranking-row"
                data-ticker="${escapeHtml(
                  item.ticker
                )}"
              >

                <span class="ranking-rank">
                  ${index + 1}
                </span>


                <div class="ranking-stock">

                  <strong>
                    ${escapeHtml(
                      item.name
                    )}
                  </strong>

                  <span>
                    ${escapeHtml(
                      item.ticker
                    )}
                  </span>

                </div>


                <div class="ranking-price">

                  ${formatPrice(
                    item.price,
                    item.market
                  )}

                </div>


                <div
                  class="ranking-change ${changeClass}"
                >

                  ${formatPercent(
                    item.change
                  )}

                </div>

              </div>
            `;
          }
        )
        .join('');


    bindRankingRows();
  }


  function renderAiRanking(
    items
  ) {
    if (
      !aiRankingList
    ) {
      return;
    }


    if (
      !items.length
    ) {
      aiRankingList.innerHTML = `
        <div class="ranking-loading">
          AI 종목 데이터가 없습니다.
          <br>
          스캔 결과에 AI Score가 포함되면 자동으로 표시됩니다.
        </div>
      `;

      return;
    }


    aiRankingList.innerHTML =
      items
        .map(
          (
            item,
            index
          ) => {

            const type =
              signalType(
                item.signal
              );


            return `
              <div
                class="ranking-row"
                data-ticker="${escapeHtml(
                  item.ticker
                )}"
              >

                <span class="ranking-rank">
                  ${index + 1}
                </span>


                <div class="ranking-stock">

                  <strong>
                    ${escapeHtml(
                      item.name
                    )}
                  </strong>

                  <span>
                    ${escapeHtml(
                      item.ticker
                    )}
                  </span>

                </div>


                <div class="ai-score">

                  ${Number.isFinite(
                    item.aiScore
                  )
                    ? Math.round(
                        item.aiScore
                      )
                    : '—'}

                </div>


                <div
                  class="ai-signal ${type}"
                >

                  ${escapeHtml(
                    item.signal
                  )}

                </div>

              </div>
            `;
          }
        )
        .join('');


    bindRankingRows();
  }


  function renderCurrentRanking() {
    const items =
      normalizedItems();


    const ranking =
      sortRanking(
        items,
        currentRanking
      );


    renderRanking(
      ranking
    );


    const aiRanking =
      sortRanking(
        items,
        'ai'
      );


    renderAiRanking(
      aiRanking
    );
  }


  /* ============================================================
   * ROW INTERACTION
   * ============================================================ */

  function bindRankingRows() {
    const rows =
      document.querySelectorAll(
        '.ranking-row'
      );


    rows.forEach(
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
             * 기존 검색 시스템을 우선 사용한다.
             */

            const input =
              document.getElementById(
                'searchInput'
              );

            const button =
              document.getElementById(
                'searchBtn'
              );


            if (input) {
              input.value =
                ticker;
            }


            if (
              button
            ) {
              button.click();

              window.scrollTo({
                top: 0,
                behavior: 'smooth'
              });

              return;
            }


            /*
             * 검색 버튼이 없더라도
             * URL에 ticker를 남겨둔다.
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
              // no-op
            }

          }
        );

      }
    );
  }


  /* ============================================================
   * API
   * ============================================================ */

  async function loadScan(
    force = false
  ) {

    const now =
      Date.now();


    if (
      !force &&
      scanData &&
      now - lastLoadedAt <
        CACHE_MS
    ) {
      renderCurrentRanking();

      return;
    }


    if (
      loading
    ) {
      return;
    }


    loading = true;


    if (
      rankingList
    ) {
      rankingList.innerHTML = `
        <div class="ranking-loading">
          시장 종목 데이터를 불러오는 중...
        </div>
      `;
    }


    if (
      aiRankingList
    ) {
      aiRankingList.innerHTML = `
        <div class="ranking-loading">
          clau2 AI 데이터를 불러오는 중...
        </div>
      `;
    }


    try {

      const response =
        await fetch(
          '/api/scan?market=all',
          {
            method: 'GET',
            cache: 'no-store',
            headers: {
              Accept:
                'application/json'
            }
          }
        );


      const text =
        await response.text();


      let data =
        null;


      try {
        data =
          text
            ? JSON.parse(text)
            : {};
      } catch {
        throw new Error(
          '시장 스캔 API가 JSON을 반환하지 않았습니다.'
        );
      }


      if (
        !response.ok
      ) {
        throw new Error(
          data?.error ||
          data?.message ||
          `시장 스캔 실패 (${response.status})`
        );
      }


      scanData =
        data;


      lastLoadedAt =
        Date.now();


      renderCurrentRanking();


    } catch (
      error
    ) {

      console.error(
        '[clau2 ranking]',
        error
      );


      if (
        rankingList
      ) {
        rankingList.innerHTML = `
          <div class="ranking-loading">

            시장 순위를 불러오지 못했습니다.

            <br><br>

            <span style="color:var(--sell)">
              ${escapeHtml(
                error.message
              )}
            </span>

          </div>
        `;
      }


      if (
        aiRankingList
      ) {
        aiRankingList.innerHTML = `
          <div class="ranking-loading">

            AI 순위를 불러오지 못했습니다.

          </div>
        `;
      }


    } finally {

      loading =
        false;

    }
  }


  /* ============================================================
   * RANKING TABS
   * ============================================================ */

  function setRanking(
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


    renderCurrentRanking();
  }


  rankingTabs.forEach(
    tab => {

      tab.addEventListener(
        'click',
        () => {

          setRanking(
            tab.dataset.ranking ||
            'popular'
          );

        }
      );

    }
  );


  /* ============================================================
   * NAVIGATION
   * ============================================================ */

  function setNavActive(
    target
  ) {

    navButtons.forEach(
      button => {

        const value =
          button.dataset.navTarget;

        button.classList.toggle(
          'active',
          value === target
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


    /*
     * 랭킹 관련 메뉴.
     */

    const rankingTargets = [
      'popular',
      'volume',
      'gainers',
      'losers',
      'volume-count',
      'high52',
      'low52',
      'ai'
    ];


    if (
      rankingTargets.includes(
        target
      )
    ) {

      if (
        target === 'ai'
      ) {
        setRanking(
          'ai'
        );
      } else if (
        target === 'volume-count'
      ) {
        setRanking(
          'volume-count'
        );
      } else if (
        target === 'gainers'
      ) {
        setRanking(
          'gainers'
        );
      } else if (
        target === 'losers'
      ) {
        setRanking(
          'losers'
        );
      } else if (
        target === 'volume'
      ) {
        setRanking(
          'volume'
        );
      } else {
        setRanking(
          'popular'
        );
      }


      const section =
        document.getElementById(
          'rankingSection'
        );


      if (
        section
      ) {
        section.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }


      return;
    }


    /*
     * 홈.
     */

    if (
      target === 'home'
    ) {

      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });

      return;
    }


    /*
     * 기존 화면의 섹션으로 연결.
     */

    const sectionMap = {

      market:
        'marketOverview',

      account:
        'accountSection',

      backtest:
        'signalTrackSection'

    };


    const id =
      sectionMap[target];


    if (
      id
    ) {

      const section =
        document.getElementById(
          id
        );


      if (
        section
      ) {

        section.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
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
   * REFRESH BUTTON
   * ============================================================ */

  window.addEventListener(
    'clau2:refresh-ranking',
    () => {
      loadScan(
        true
      );
    }
  );


  /*
   * 기존 REFRESH 버튼에도 연결.
   */

  const refresh =
    document.getElementById(
      'refreshBtn'
    );


  if (
    refresh
  ) {

    refresh.addEventListener(
      'click',
      () => {

        window.setTimeout(
          () => {
            loadScan(
              true
            );
          },
          150
        );

      }
    );

  }


  /* ============================================================
   * INITIALIZE
   * ============================================================ */

  function init() {

    /*
     * 초기에는 인기순.
     */

    setRanking(
      'popular'
    );


    /*
     * API 호출.
     */

    loadScan(
      false
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
        once: true
      }
    );

  } else {

    init();

  }

})();
