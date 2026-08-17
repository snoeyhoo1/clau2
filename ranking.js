/*
 * ============================================================
 * CLAU2 MARKET RANKING
 * ============================================================
 *
 * 증권사 HTS 스타일 시장 랭킹
 *
 * API
 *   GET /api/scan?market=all
 *
 * 사용 데이터
 *   rankings.popular
 *   rankings.volume
 *   rankings.gainers
 *   rankings.losers
 *   rankings.volume-count
 *   rankings.ai
 *   rankings.confidence
 *   rankings.aiPicks
 *
 * 중요
 *   별도의 /api/rankings Serverless Function을 만들지 않는다.
 *
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


  const marketSwitches =
    Array.from(
      document.querySelectorAll(
        '[data-ranking-market]'
      )
    );


  const navButtons =
    Array.from(
      document.querySelectorAll(
        '[data-nav-target]'
      )
    );


  const shortcutButtons =
    Array.from(
      document.querySelectorAll(
        '[data-ranking-shortcut]'
      )
    );


  /*
   * 랭킹 UI가 없는 페이지에서는 종료.
   */

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


  let currentMarket =
    'all';


  let loading =
    false;


  let lastRequest =
    0;


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
      Number(
        value
      );


    return Number.isFinite(
      n
    )
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
      number(
        value
      );


    if (
      n === null
    ) {
      return '—';
    }


    const code =
      String(
        ticker || ''
      )
        .toUpperCase();


    const isKorea =
      code.endsWith(
        '.KS'
      ) ||
      code.endsWith(
        '.KQ'
      );


    if (
      isKorea
    ) {

      return Math.round(
        n
      ).toLocaleString(
        'ko-KR'
      );

    }


    return n.toLocaleString(
      'en-US',
      {
        minimumFractionDigits:
          2,

        maximumFractionDigits:
          2
      }
    );
  }


  function formatPercent(
    value
  ) {

    const n =
      number(
        value
      );


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
      n.toFixed(
        2
      ) +
      '%';
  }


  function formatAmount(
    value
  ) {

    const n =
      number(
        value
      );


    if (
      n === null ||
      n === 0
    ) {
      return '—';
    }


    const abs =
      Math.abs(
        n
      );


    if (
      abs >=
      1_000_000_000_000
    ) {

      return (
        (
          n /
          1_000_000_000_000
        ).toFixed(
          2
        ) +
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
        ).toFixed(
          1
        ) +
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
        ).toFixed(
          1
        ) +
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
      value.endsWith(
        '.KS'
      )
    ) {
      return 'KOSPI';
    }


    if (
      value.endsWith(
        '.KQ'
      )
    ) {
      return 'KOSDAQ';
    }


    return 'US';
  }


  function changeClass(
    value
  ) {

    const n =
      number(
        value,
        0
      );


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
      text.includes(
        'BUY'
      ) ||
      text.includes(
        'LONG'
      )
    ) {
      return 'buy';
    }


    if (
      text.includes(
        'SELL'
      ) ||
      text.includes(
        'SHORT'
      ) ||
      text.includes(
        'EXIT'
      )
    ) {
      return 'sell';
    }


    return 'wait';
  }


  function normalizeRow(
    row,
    index = 0
  ) {

    if (
      !row ||
      typeof row !== 'object'
    ) {

      return {
        rank:
          index + 1,

        ticker:
          '',

        name:
          '',

        price:
          null,

        changePct:
          null,

        aiScore:
          null,

        aiConfidence:
          null,

        aiLabel:
          '',

        decision:
          'WAIT',

        regime:
          '',

        volume:
          null,

        tradingValue:
          null
      };
    }


    return {

      rank:
        number(
          row.rank,
          index + 1
        ),

      ticker:
        String(
          row.ticker ||
          row.symbol ||
          ''
        ),

      name:
        String(
          row.label ||
          row.name ||
          row.title ||
          row.ticker ||
          row.symbol ||
          ''
        ),

      price:
        number(
          row.currentPrice ??
          row.price ??
          row.close
        ),

      changePct:
        number(
          row.changePct ??
          row.change ??
          row.changePercent ??
          row.pctChange
        ),

      aiScore:
        number(
          row.aiScore ??
          row.score
        ),

      aiConfidence:
        number(
          row.aiConfidence ??
          row.confidence
        ),

      aiLabel:
        String(
          row.aiLabel ||
          row.aiSignal ||
          ''
        ),

      decision:
        String(
          row.decision ||
          row.signal ||
          'WAIT'
        ),

      regime:
        String(
          row.regime ||
          row.marketType ||
          ''
        ),

      volume:
        number(
          row.volume ??
          row.volumeCount
        ),

      tradingValue:
        number(
          row.tradingValue ??
          row.turnover ??
          row.amount
        )
    };
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
      cache.get(
        key
      );


    if (
      cached &&
      Date.now() -
        cached.time <
        CACHE_MS
    ) {

      return cached.data;
    }


    const params =
      new URLSearchParams();


    if (
      market &&
      market !== 'all'
    ) {

      params.set(
        'market',
        market
      );

    }


    /*
     * 핵심:
     *
     * /api/rankings 사용 X
     * /api/scan 하나만 사용.
     */

    const query =
      params.toString();


    const url =
      query
        ? `/api/scan?${query}`
        : '/api/scan';


    const response =
      await fetch(
        url,
        {
          method:
            'GET',

          cache:
            'no-store',

          headers: {
            Accept:
              'application/json'
          }
        }
      );


    const text =
      await response.text();


    let data;


    try {

      data =
        text
          ? JSON.parse(
              text
            )
          : {};

    } catch {

      throw new Error(
        '시장 데이터 응답을 읽을 수 없습니다.'
      );
    }


    if (
      !response.ok ||
      data?.ok === false
    ) {

      throw new Error(
        data?.error ||
        data?.message ||
        `시장 데이터 조회 실패 (${response.status})`
      );
    }


    const rankings =
      data?.rankings ||
      {};


    const selected =
      Array.isArray(
        rankings[type]
      )
        ? rankings[type]
        : Array.isArray(
            data?.ranked
          )
          ? data.ranked
          : [];


    const aiPicks =
      Array.isArray(
        rankings.aiPicks
      )
        ? rankings.aiPicks
        : Array.isArray(
            data?.aiPicks
          )
          ? data.aiPicks
          : [];


    const normalized = {

      ok:
        true,

      rows:
        selected
          .slice(
            0,
            limit
          ),

      aiPicks:
        aiPicks
          .slice(
            0,
            20
          ),

      allRankings:
        rankings,

      summary:
        data?.summary ||
        {},

      breadth:
        data?.breadth ||
        null,

      generatedAt:
        data?.generatedAt ||
        null
    };


    cache.set(
      key,
      {
        time:
          Date.now(),

        data:
          normalized
      }
    );


    return normalized;
  }


  /* ============================================================
   * RENDER - MAIN
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
      !Array.isArray(
        rows
      ) ||
      rows.length === 0
    ) {

      rankingList.innerHTML = `
        <div class="ranking-empty">
          현재 표시할 종목 데이터가 없습니다.
        </div>
      `;

      return;
    }


    rankingList.innerHTML =
      rows
        .map(
          (
            raw,
            index
          ) => {

            const row =
              normalizeRow(
                raw,
                index
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


            if (
              type ===
              'volume'
            ) {

              rightValue =
                formatAmount(
                  row.tradingValue
                );
            }


            if (
              type ===
              'volume-count'
            ) {

              rightValue =
                formatAmount(
                  row.volume
                );
            }


            return `
              <button
                type="button"
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


                <span
                  class="ranking-stock"
                >

                  <strong>
                    ${escapeHtml(
                      row.name
                    )}
                  </strong>

                  <small>
                    ${escapeHtml(
                      row.ticker
                    )}
                    ·
                    ${escapeHtml(
                      market
                    )}
                  </small>

                </span>


                <span
                  class="ranking-price"
                >
                  ${formatPrice(
                    row.price,
                    row.ticker
                  )}
                </span>


                <span
                  class="
                    ranking-change
                    ${change}
                  "
                >
                  ${rightValue}
                </span>

              </button>
            `;
          }
        )
        .join('');


    bindRows();
  }


  /* ============================================================
   * RENDER - AI
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
      !Array.isArray(
        rows
      ) ||
      rows.length === 0
    ) {

      aiRankingList.innerHTML = `
        <div class="ranking-empty">
          AI PICK 데이터가 없습니다.
        </div>
      `;

      return;
    }


    aiRankingList.innerHTML =
      rows
        .slice(
          0,
          10
        )
        .map(
          (
            raw,
            index
          ) => {

            const row =
              normalizeRow(
                raw,
                index
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


            const confidence =
              row.aiConfidence === null
                ? ''
                : `${Math.round(
                    row.aiConfidence
                  )}%`;


            const change =
              changeClass(
                row.changePct
              );


            return `
              <button
                type="button"
                class="
                  ranking-row
                  ai-row
                "
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


                <span
                  class="ranking-stock"
                >

                  <strong>
                    ${escapeHtml(
                      row.name
                    )}
                  </strong>

                  <small>
                    ${escapeHtml(
                      row.ticker
                    )}
                    ·
                    ${escapeHtml(
                      row.regime ||
                      'MARKET'
                    )}
                  </small>

                </span>


                <span
                  class="ai-score"
                >
                  ${escapeHtml(
                    score
                  )}
                </span>


                <span
                  class="
                    ai-signal
                    ${type}
                  "
                >

                  <strong>
                    ${escapeHtml(
                      row.decision ||
                      'WAIT'
                    )}
                  </strong>

                  ${
                    confidence
                      ? `
                        <small>
                          ${escapeHtml(
                            confidence
                          )}
                        </small>
                      `
                      : ''
                  }

                </span>


                <span
                  class="
                    ranking-change
                    ${change}
                  "
                >
                  ${formatPercent(
                    row.changePct
                  )}
                </span>

              </button>
            `;
          }
        )
        .join('');


    bindRows();
  }


  /* ============================================================
   * RENDER - MINI RANKINGS
   * ============================================================ */

  function renderMiniRanking(
    elementId,
    rows,
    type
  ) {

    const element =
      document.getElementById(
        elementId
      );


    if (
      !element
    ) {
      return;
    }


    if (
      !Array.isArray(
        rows
      ) ||
      rows.length === 0
    ) {

      element.innerHTML = `
        <div class="ranking-empty">
          데이터가 없습니다.
        </div>
      `;

      return;
    }


    element.innerHTML =
      rows
        .slice(
          0,
          5
        )
        .map(
          (
            raw,
            index
          ) => {

            const row =
              normalizeRow(
                raw,
                index
              );


            let value =
              formatPercent(
                row.changePct
              );


            if (
              type ===
              'volume'
            ) {

              value =
                formatAmount(
                  row.tradingValue
                );
            }


            if (
              type ===
              'volume-count'
            ) {

              value =
                formatAmount(
                  row.volume
                );
            }


            return `
              <button
                type="button"
                class="mini-ranking-row"
                data-ticker="${escapeHtml(
                  row.ticker
                )}"
              >

                <span
                  class="mini-ranking-rank"
                >
                  ${escapeHtml(
                    row.rank
                  )}
                </span>


                <span
                  class="mini-ranking-name"
                >

                  <strong>
                    ${escapeHtml(
                      row.name
                    )}
                  </strong>

                  <small>
                    ${escapeHtml(
                      row.ticker
                    )}
                  </small>

                </span>


                <span
                  class="
                    mini-ranking-value
                    ${changeClass(
                      row.changePct
                    )}
                  "
                >
                  ${escapeHtml(
                    value
                  )}
                </span>

              </button>
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
        '[data-ticker]'
      )
      .forEach(
        row => {

          if (
            row.dataset.rankingBound ===
            'true'
          ) {
            return;
          }


          row.dataset.rankingBound =
            'true';


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
               * 기존 검색 UI와 연결.
               */

              const input =
                document.getElementById(
                  'searchInput'
                );


              const searchBtn =
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
                searchBtn
              ) {

                searchBtn.click();

                window.scrollTo(
                  {
                    top:
                      0,

                    behavior:
                      'smooth'
                  }
                );

                return;
              }


              /*
               * 다른 검색 이벤트가 있을 경우.
               */

              window.dispatchEvent(
                new CustomEvent(
                  'clau2:select-ticker',
                  {
                    detail: {
                      ticker
                    }
                  }
                )
              );
            }
          );
        }
      );
  }


  /* ============================================================
   * SUMMARY
   * ============================================================ */

  function updateSummary(
    data
  ) {

    const summary =
      data?.summary ||
      {};


    const breadth =
      data?.breadth ||
      {};


    const gainers =
      number(
        summary.gainers ??
        breadth.gainers
      );


    const losers =
      number(
        summary.losers ??
        breadth.losers
      );


    const topValue =
      document.getElementById(
        'topTradingValue'
      );


    const topValueTicker =
      document.getElementById(
        'topTradingValueTicker'
      );


    const topVolume =
      document.getElementById(
        'topVolume'
      );


    const topVolumeTicker =
      document.getElementById(
        'topVolumeTicker'
      );


    const gainersCount =
      document.getElementById(
        'rankingGainersCount'
      );


    const losersCount =
      document.getElementById(
        'rankingLosersCount'
      );


    const volumeRows =
      Array.isArray(
        data?.allRankings?.volume
      )
        ? data.allRankings.volume
        : [];


    const volumeCountRows =
      Array.isArray(
        data?.allRankings?.[
          'volume-count'
        ]
      )
        ? data.allRankings[
            'volume-count'
          ]
        : [];


    const firstValue =
      volumeRows[0]
        ? normalizeRow(
            volumeRows[0],
            0
          )
        : null;


    const firstVolume =
      volumeCountRows[0]
        ? normalizeRow(
            volumeCountRows[0],
            0
          )
        : null;


    if (
      topValue
    ) {

      topValue.textContent =
        firstValue
          ? formatAmount(
              firstValue.tradingValue
            )
          : '—';
    }


    if (
      topValueTicker
    ) {

      topValueTicker.textContent =
        firstValue
          ? (
              firstValue.name ||
              firstValue.ticker
            )
          : '데이터 없음';
    }


    if (
      topVolume
    ) {

      topVolume.textContent =
        firstVolume
          ? formatAmount(
              firstVolume.volume
            )
          : '—';
    }


    if (
      topVolumeTicker
    ) {

      topVolumeTicker.textContent =
        firstVolume
          ? (
              firstVolume.name ||
              firstVolume.ticker
            )
          : '데이터 없음';
    }


    if (
      gainersCount
    ) {

      gainersCount.textContent =
        gainers === null
          ? '—'
          : gainers.toLocaleString(
              'ko-KR'
            );
    }


    if (
      losersCount
    ) {

      losersCount.textContent =
        losers === null
          ? '—'
          : losers.toLocaleString(
              'ko-KR'
            );
    }
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
          시장 순위를 불러오는 중...
        </div>
      `;
    }


    if (
      aiRankingList
    ) {

      aiRankingList.innerHTML = `
        <div class="ranking-loading">
          CLAU2 AI를 분석하는 중...
        </div>
      `;
    }


    try {

      const data =
        await fetchRanking(
          type,
          currentMarket,
          10
        );


      if (
        requestId !==
        lastRequest
      ) {
        return;
      }


      /*
       * 메인 랭킹
       */

      renderRanking(
        data.rows,
        type
      );


      /*
       * AI PICK
       */

      renderAiRanking(
        data.aiPicks
      );


      /*
       * 상승 / 하락
       */

      renderMiniRanking(
        'gainersList',
        data.allRankings?.gainers ||
        [],
        'gainers'
      );


      renderMiniRanking(
        'losersList',
        data.allRankings?.losers ||
        [],
        'losers'
      );


      /*
       * 거래대금 / 거래량
       */

      updateSummary(
        data
      );


      /*
       * 외부 UI가 데이터를 받을 수 있게 이벤트 발행.
       */

      window.dispatchEvent(
        new CustomEvent(
          'clau2:ranking-loaded',
          {
            detail:
              data
          }
        )
      );


    } catch (
      error
    ) {

      console.error(
        '[CLAU2 RANKING]',
        error
      );


      const message =
        escapeHtml(
          error?.message ||
          '알 수 없는 오류'
        );


      if (
        rankingList
      ) {

        rankingList.innerHTML = `
          <div class="ranking-empty">

            시장 데이터를
            불러오지 못했습니다.

            <br>

            <span
              style="
                color:var(--sell);
                font-size:10px;
              "
            >
              ${message}
            </span>

          </div>
        `;
      }


      if (
        aiRankingList
      ) {

        aiRankingList.innerHTML = `
          <div class="ranking-empty">

            AI PICK 데이터를
            불러오지 못했습니다.

          </div>
        `;
      }


    } finally {

      loading =
        false;
    }
  }


  /* ============================================================
   * RANKING TAB
   * ============================================================ */

  rankingTabs.forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          const type =
            button.dataset.ranking;


          if (
            !type
          ) {
            return;
          }


          currentRanking =
            type;


          rankingTabs.forEach(
            item => {

              item.classList.toggle(
                'active',
                item === button
              );
            }
          );


          load(
            currentRanking
          );
        }
      );
    }
  );


  /* ============================================================
   * MARKET SWITCH
   * ============================================================ */

  marketSwitches.forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          const market =
            button.dataset.rankingMarket;


          if (
            !market
          ) {
            return;
          }


          currentMarket =
            market;


          marketSwitches.forEach(
            item => {

              item.classList.toggle(
                'active',
                item === button
              );
            }
          );


          /*
           * 시장 변경 시 기존 캐시 제거.
           */

          cache.clear();


          load(
            currentRanking
          );
        }
      );
    }
  );


  /* ============================================================
   * NAV BUTTONS
   * ============================================================ */

  navButtons.forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          const target =
            button.dataset.navTarget;


          if (
            !target
          ) {
            return;
          }


          /*
           * 랭킹 탭으로 이동.
           */

          const tab =
            rankingTabs.find(
              item =>
                item.dataset.ranking ===
                target
            );


          if (
            tab
          ) {

            tab.click();

            return;
          }


          /*
           * AI 전체보기.
           */

          if (
            target ===
            'ai'
          ) {

            const aiTab =
              rankingTabs.find(
                item =>
                  item.dataset.ranking ===
                  'ai'
              );


            if (
              aiTab
            ) {

              aiTab.click();

              return;
            }
          }


          /*
           * 기존 네비게이션 시스템과 연동.
           */

          window.dispatchEvent(
            new CustomEvent(
              'clau2:ranking-nav',
              {
                detail: {
                  target
                }
              }
            )
          );
        }
      );
    }
  );


  /* ============================================================
   * MINI RANKING SHORTCUT
   * ============================================================ */

  shortcutButtons.forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          const target =
            button.dataset.rankingShortcut;


          if (
            !target
          ) {
            return;
          }


          const tab =
            rankingTabs.find(
              item =>
                item.dataset.ranking ===
                target
            );


          if (
            tab
          ) {

            tab.click();

            return;
          }


          /*
           * 상승 / 하락 탭이 없다면
           * 현재 랭킹 데이터를 직접 요청.
           */

          if (
            target ===
            'gainers' ||
            target ===
            'losers'
          ) {

            currentRanking =
              target;


            load(
              target
            );
          }
        }
      );
    }
  );


  /* ============================================================
   * REFRESH EVENT
   * ============================================================ */

  window.addEventListener(
    'clau2:refresh',
    () => {

      cache.clear();

      load(
        currentRanking
      );
    }
  );


  /* ============================================================
   * PERIODIC REFRESH
   * ============================================================ */

  const REFRESH_MS =
    60 * 1000;


  setInterval(
    () => {

      if (
        document.hidden
      ) {
        return;
      }


      cache.clear();


      load(
        currentRanking
      );

    },
    REFRESH_MS
  );


  /* ============================================================
   * INITIAL LOAD
   * ============================================================ */

  load(
    currentRanking
  );

})();
