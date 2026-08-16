// app.js
//
// SIGNAL DESK
//
// 기존 UI를 유지하면서
// 검색 -> AI 분석 -> 차트 -> 백테스트
// 흐름을 복구한다.

if (
  'serviceWorker' in
  navigator
) {
  window.addEventListener(
    'load',
    () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch(
          err =>
            console.warn(
              '서비스워커 등록 실패:',
              err
            )
        );
    }
  );
}


/*
 * ============================================================
 * DOM
 * ============================================================
 */

const buyBoard =
  document.getElementById(
    'buyBoard'
  );

const sellBoard =
  document.getElementById(
    'sellBoard'
  );

const marketOverview =
  document.getElementById(
    'marketOverview'
  );

const breadthBar =
  document.getElementById(
    'breadthBar'
  );

const tape =
  document.getElementById(
    'tape'
  );

const updatedAt =
  document.getElementById(
    'updatedAt'
  ) ||
  document.getElementById(
    'updated'
  );

const refreshBtn =
  document.getElementById(
    'refreshBtn'
  );

const searchInput =
  document.getElementById(
    'searchInput'
  );

const searchBtn =
  document.getElementById(
    'searchBtn'
  );

const searchResult =
  document.getElementById(
    'searchResult'
  );

const newsList =
  document.getElementById(
    'newsList'
  ) ||
  document.getElementById(
    'marketNewsList'
  );

const newsRefresh =
  document.getElementById(
    'marketNewsRefresh'
  ) ||
  document.getElementById(
    'marketNewsRefreshBtn'
  );

const newsUpdated =
  document.getElementById(
    'newsUpdated'
  );

const backtestTicker =
  document.getElementById(
    'backtestTicker'
  );

const backtestPeriod =
  document.getElementById(
    'backtestPeriod'
  );

const backtestBtn =
  document.getElementById(
    'backtestBtn'
  );

const backtestResult =
  document.getElementById(
    'backtestResult'
  );


let loading = false;


/*
 * ============================================================
 * UTILITIES
 * ============================================================
 */

function num(
  value,
  fallback = 0
) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


function fmtPrice(
  value,
  currency
) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return '—';
  }

  if (
    currency === 'KRW' ||
    currency === '원'
  ) {
    return (
      Math.round(n)
        .toLocaleString(
          'ko-KR'
        ) +
      '원'
    );
  }

  return (
    '$' +
    n.toLocaleString(
      'en-US',
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }
    )
  );
}


function fmtChange(
  value
) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return '';
  }

  return (
    (n >= 0
      ? '+'
      : '') +
    n.toFixed(2) +
    '%'
  );
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


function signalClass(
  item
) {
  if (
    item?.aiStrategy
      ?.signal === 1
  ) {
    return 'buy';
  }

  if (
    item?.aiStrategy
      ?.signal === -1
  ) {
    return 'sell';
  }

  return 'hold';
}


function signalText(
  item
) {
  if (
    item?.aiLabel
  ) {
    return item.aiLabel;
  }

  if (
    item?.aiStrategy
      ?.decision
  ) {
    return item.aiStrategy
      .decision;
  }

  return (
    item?.classification ||
    'AI 대기'
  );
}


function formatNumber(
  value,
  digits = 2
) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return '—';
  }

  return n.toLocaleString(
    'ko-KR',
    {
      minimumFractionDigits:
        digits,
      maximumFractionDigits:
        digits,
    }
  );
}


/*
 * ============================================================
 * NEWS
 * ============================================================
 */

function renderHeadlines(
  headlines
) {
  if (
    !Array.isArray(
      headlines
    ) ||
    !headlines.length
  ) {
    return '';
  }

  return `
    <ul class="headlines">

      ${headlines
        .slice(0, 5)
        .map(
          headline => {

            const title =
              typeof headline ===
              'string'
                ? headline
                : headline?.title ||
                  headline?.description ||
                  '';

            if (!title) {
              return '';
            }

            const sentiment =
              headline?.sentiment;

            const cls =
              sentiment ===
              'positive'
                ? 'change-up'
                : sentiment ===
                  'negative'
                  ? 'change-down'
                  : '';

            return `
              <li>

                <span class="${cls}">
                  ${
                    sentiment ===
                    'positive'
                      ? '[긍정]'
                      : sentiment ===
                        'negative'
                        ? '[부정]'
                        : ''
                  }
                </span>

                ${escapeHtml(
                  title
                )}

              </li>
            `;
          }
        )
        .join('')}

    </ul>
  `;
}


function formatNewsTime(
  value
) {
  const time =
    Date.parse(
      value
    );

  if (!time) {
    return '';
  }

  return new Date(
    time
  ).toLocaleString(
    'ko-KR',
    {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }
  );
}


function newsCategoryLabel(
  category
) {
  const map = {
    KOREA:
      'KOREA',

    US:
      'US MARKET',

    SEMICONDUCTOR:
      'SEMICONDUCTOR',

    MACRO:
      'MACRO',

    GLOBAL:
      'GLOBAL',
  };

  return (
    map[category] ||
    'MARKET'
  );
}


function renderMarketNews(
  articles
) {
  if (!newsList) {
    return;
  }

  if (
    !Array.isArray(
      articles
    ) ||
    !articles.length
  ) {
    newsList.innerHTML = `
      <div class="account-notice">
        현재 표시할 주요 시황 뉴스가 없습니다.
      </div>
    `;

    return;
  }

  newsList.innerHTML =
    articles
      .slice(0, 20)
      .map(
        article => `
          <article
            class="market-news-item"
          >

            <div
              class="market-news-meta"
            >

              <span
                class="market-news-category"
              >
                ${escapeHtml(
                  newsCategoryLabel(
                    article.category
                  )
                )}
              </span>

              <span>
                ${escapeHtml(
                  article.source ||
                  ''
                )}
              </span>

              <span>
                ${escapeHtml(
                  formatNewsTime(
                    article.pubDate
                  )
                )}
              </span>

            </div>

            <a
              class="market-news-title"
              href="${escapeHtml(
                article.link ||
                '#'
              )}"
              target="_blank"
              rel="noopener noreferrer"
            >
              ${escapeHtml(
                article.title
              )}
            </a>

          </article>
        `
      )
      .join('');

  if (newsUpdated) {
    newsUpdated.textContent =
      `LIVE · ${
        new Date()
          .toLocaleTimeString(
            'ko-KR'
          )
      }`;
  }
}


async function loadMarketNews() {
  if (!newsList) {
    return;
  }

  if (newsRefresh) {
    newsRefresh.disabled =
      true;

    newsRefresh.textContent =
      'LOADING...';
  }

  newsList.innerHTML = `
    <div class="account-notice">
      주요 시황 뉴스를 불러오는 중...
    </div>
  `;

  try {
    const response =
      await fetch(
        '/api/market-news?limit=20',
        {
          cache:
            'no-store',
        }
      );

    const data =
      await response.json();

    if (
      !response.ok
    ) {
      throw new Error(
        data?.error ||
        '뉴스 조회 실패'
      );
    }

    renderMarketNews(
      data.articles
    );

  } catch (error) {

    console.error(
      '[market news]',
      error
    );

    newsList.innerHTML = `
      <div class="search-error">

        주요 시황을 불러오지 못했습니다.

        <br />

        ${escapeHtml(
          error.message
        )}

      </div>
    `;

  } finally {

    if (newsRefresh) {
      newsRefresh.disabled =
        false;

      newsRefresh.textContent =
        'NEWS REFRESH';
    }

  }
}


/*
 * ============================================================
 * AI AGENT SUMMARY
 * ============================================================
 */

function renderAgentSummary(
  item
) {
  const strategy =
    item.aiStrategy ||
    {};

  const day =
    strategy.day ||
    {};

  const swing =
    strategy.swing ||
    {};

  const ensemble =
    strategy.ensemble ||
    {};

  const confidence =
    num(
      item.aiConfidence
    );

  const bullish =
    num(
      ensemble.bullishAgents
    );

  const bearish =
    num(
      ensemble.bearishAgents
    );

  const regime =
    strategy.regime ||
    'UNKNOWN';

  return `
    <div class="ai-panel">

      <div class="ai-panel-title">
        AI 종합 판단
      </div>

      <div class="ai-main-row">

        <span
          class="signal-badge signal-${signalClass(
            item
          )}"
        >
          ${escapeHtml(
            signalText(item)
          )}
        </span>

        <span class="ai-score">
          AI ${num(
            item.aiScore
          ).toFixed(0)}
        </span>

        <span class="ai-confidence">
          신뢰도 ${confidence.toFixed(
            0
          )}%
        </span>

      </div>

      <div class="ai-meta">

        <span>
          Regime:
          ${escapeHtml(
            regime
          )}
        </span>

        <span>
          DAY:
          ${escapeHtml(
            day.decision ||
            'WAIT'
          )}
        </span>

        <span>
          SWING:
          ${escapeHtml(
            swing.decision ||
            'WAIT'
          )}
        </span>

        <span>
          합의:
          ${bullish}↑ /
          ${bearish}↓
        </span>

      </div>

      ${
        strategy.reason
          ? `
            <div class="ai-reason">
              ${escapeHtml(
                strategy.reason
              )}
            </div>
          `
          : ''
      }

    </div>
  `;
}


/*
 * ============================================================
 * EXECUTION
 * ============================================================
 */

function renderExecution(
  item
) {
  const execution =
    item?.aiStrategy
      ?.execution;

  if (!execution) {
    return '';
  }

  const values = [
    execution.entry,
    execution.stop,
    execution.target1,
    execution.target2,
    execution.riskReward,
  ];

  if (
    values.every(
      value =>
        value === null ||
        value === undefined
    )
  ) {
    return '';
  }

  return `
    <div class="execution-panel">

      <div class="execution-title">
        실행 계획
      </div>

      <div class="execution-grid">

        <div>
          <span>진입</span>
          <b>${escapeHtml(
            execution.entry
          )}</b>
        </div>

        <div>
          <span>손절</span>
          <b>${escapeHtml(
            execution.stop
          )}</b>
        </div>

        <div>
          <span>목표1</span>
          <b>${escapeHtml(
            execution.target1
          )}</b>
        </div>

        <div>
          <span>목표2</span>
          <b>${escapeHtml(
            execution.target2
          )}</b>
        </div>

        <div>
          <span>R/R</span>
          <b>${escapeHtml(
            execution.riskReward
          )}</b>
        </div>

      </div>

    </div>
  `;
}


/*
 * ============================================================
 * UP PROBABILITY
 * ============================================================
 */

function renderUpProbability(
  up
) {
  if (
    !up?.byHorizon
  ) {
    return '';
  }

  const horizons =
    Object.keys(
      up.byHorizon
    )
      .map(Number)
      .sort(
        (a, b) =>
          a - b
      );

  return `
    <div class="up-prob">

      <div class="up-prob-title">
        상승 확률
      </div>

      ${horizons
        .map(
          horizon => {

            const data =
              up.byHorizon[
                horizon
              ];

            if (
              !data ||
              data.probability ===
              null
            ) {
              return `
                <div class="prob-row">

                  <span>
                    ${horizon}일
                  </span>

                  <span>
                    데이터 부족
                  </span>

                </div>
              `;
            }

            return `
              <div class="prob-row">

                <span>
                  ${horizon}거래일
                </span>

                <strong>
                  ${data.probability}%
                </strong>

                <span>
                  평균
                  ${data.avgReturnPct}%
                </span>

              </div>
            `;
          }
        )
        .join('')}

    </div>
  `;
}


/*
 * ============================================================
 * CARD
 * ============================================================
 */

function renderCard(
  item
) {
  if (
    item.error
  ) {
    return `
      <div class="card">

        <div class="card-head">

          <span>
            ${escapeHtml(
              item.label
            )}
          </span>

          <span>
            ${escapeHtml(
              item.ticker
            )}
          </span>

        </div>

        <div class="card-error">
          ${escapeHtml(
            item.error
          )}
        </div>

      </div>
    `;
  }

  const change =
    num(
      item.changePct
    );

  const changeClass =
    change >= 0
      ? 'change-up'
      : 'change-down';

  const score =
    num(
      item.combinedScore
    );

  const aiScore =
    num(
      item.aiScore
    );

  const barWidth =
    Math.min(
      50,
      Math.abs(score) / 2
    );

  const barClass =
    signalClass(
      item
    );

  return `
    <article
      class="card"
      data-ticker="${escapeHtml(
        item.ticker
      )}"
    >

      <div class="card-head">

        <span class="card-label">
          ${escapeHtml(
            item.label
          )}
        </span>

        <span class="card-ticker">
          ${escapeHtml(
            item.ticker
          )}
        </span>

      </div>

      <div class="card-price">
        ${fmtPrice(
          item.currentPrice,
          item.currency
        )}
      </div>

      <div
        class="card-change ${changeClass}"
      >
        ${fmtChange(
          item.changePct
        )}
      </div>

      <div
        class="signal-badge signal-${barClass}"
      >
        ${escapeHtml(
          signalText(item)
        )}
        · AI
        ${
          aiScore >= 0
            ? '+'
            : ''
        }${aiScore}
      </div>

      <div class="score-bar-wrap">

        <div
          class="score-bar"
          style="
            width:${barWidth}%;
            ${
              score < 0
                ? 'right:50%'
                : 'left:50%'
            };
            background:var(--${barClass});
          "
        ></div>

      </div>

      ${renderAgentSummary(
        item
      )}

      ${renderExecution(
        item
      )}

      ${renderUpProbability(
        item.upProbability
      )}

      <div class="breakdown">

        <div>
          <b>기술적</b>
          ${num(
            item.technical
              ?.score
          ).toFixed(0)}
        </div>

        <div>
          <b>뉴스</b>
          ${num(
            item.news
              ?.score
          ).toFixed(0)}
        </div>

        <div>
          <b>기존 점수</b>
          ${score}
        </div>

      </div>

      ${renderHeadlines(
        item.news
          ?.headlines
      )}

    </article>
  `;
}


/*
 * ============================================================
 * TAPE
 * ============================================================
 */

function renderTape(
  ranked
) {
  if (!tape) {
    return;
  }

  const valid =
    ranked.filter(
      item =>
        !item.error
    );

  if (!valid.length) {
    tape.innerHTML =
      '<span>데이터 없음</span>';

    return;
  }

  const items = [
    ...valid,
    ...valid,
  ];

  tape.innerHTML = `
    <div class="tape-inner">

      ${items
        .map(
          item => {

            const score =
              num(
                item.aiScore
              );

            const cls =
              signalClass(
                item
              );

            return `
              <span class="tape-item">

                ${escapeHtml(
                  item.label
                )}

                <span
                  class="change-${cls}"
                >
                  ${
                    score >= 0
                      ? '+'
                      : ''
                  }${score}
                </span>

              </span>
            `;
          }
        )
        .join('')}

    </div>
  `;
}


/*
 * ============================================================
 * BREADTH
 * ============================================================
 */

function renderBreadth(
  breadth
) {
  if (
    !breadthBar ||
    !breadth
  ) {
    return;
  }

  const total =
    num(
      breadth.total
    );

  if (!total) {
    return;
  }

  const buy =
    num(
      breadth.buyCount
    );

  const hold =
    num(
      breadth.holdCount
    );

  const sell =
    num(
      breadth.sellCount
    );

  breadthBar.innerHTML = `
    <span>
      시장 breadth
    </span>

    <div class="breadth-track">

      <div
        class="breadth-buy"
        style="
          width:${buy / total * 100}%
        "
      ></div>

      <div
        class="breadth-hold"
        style="
          width:${hold / total * 100}%
        "
      ></div>

      <div
        class="breadth-sell"
        style="
          width:${sell / total * 100}%
        "
      ></div>

    </div>

    <span class="change-up">
      매수 ${buy}
    </span>

    <span>
      중립 ${hold}
    </span>

    <span class="change-down">
      매도 ${sell}
    </span>

    <span>
      전체 ${total}
    </span>
  `;
}


/*
 * ============================================================
 * MARKET OVERVIEW
 * ============================================================
 */

function renderMarketOverview(
  indices
) {
  if (
    !marketOverview
  ) {
    return;
  }

  marketOverview.innerHTML =
    (
      Array.isArray(
        indices
      )
        ? indices
        : []
    )
      .map(
        index => {

          if (
            index.error
          ) {
            return `
              <div class="mo-card">

                <div class="mo-label">
                  ${escapeHtml(
                    index.label
                  )}
                </div>

                <div class="card-error">
                  조회 실패
                </div>

              </div>
            `;
          }

          const change =
            num(
              index.changePct
            );

          return `
            <div class="mo-card">

              <div class="mo-label">
                ${escapeHtml(
                  index.label
                )}
              </div>

              <div class="mo-price">
                ${fmtPrice(
                  index.currentPrice,
                  index.currency
                )}
              </div>

              <div
                class="mo-change ${
                  change >= 0
                    ? 'change-up'
                    : 'change-down'
                }"
              >
                ${fmtChange(
                  index.changePct
                )}
              </div>

            </div>
          `;
        }
      )
      .join('');
}


async function loadMarketOverview() {
  try {

    const response =
      await fetch(
        '/api/market-overview',
        {
          cache:
            'no-store',
        }
      );

    const data =
      await response.json();

    if (
      !response.ok
    ) {
      throw new Error(
        data?.error ||
        '시장 현황 조회 실패'
      );
    }

    renderMarketOverview(
      data.indices
    );

  } catch (error) {

    console.error(
      '[market overview]',
      error
    );

    if (
      marketOverview
    ) {
      marketOverview.innerHTML = `
        <div class="mo-loading">
          시장 현황 조회 실패
        </div>
      `;
    }

  }
}


/*
 * ============================================================
 * SCAN
 * ============================================================
 */

async function loadScan() {
  if (loading) {
    return;
  }

  loading = true;

  if (buyBoard) {
    buyBoard.innerHTML = `
      <div
        style="
          padding:32px;
          color:var(--ink-dim)
        "
      >
        Multi-Agent AI가 시장을 분석하는 중…
      </div>
    `;
  }

  if (sellBoard) {
    sellBoard.innerHTML = '';
  }

  try {

    const response =
      await fetch(
        '/api/scan',
        {
          cache:
            'no-store',
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      data.error
    ) {
      throw new Error(
        data?.error ||
        '스캔 실패'
      );
    }

    const ranked =
      Array.isArray(
        data.ranked
      )
        ? data.ranked
        : [];

    const buyCandidates =
      ranked
        .filter(
          item =>
            item.aiStrategy
              ?.signal === 1 ||
            num(
              item.aiScore
            ) >= 50
        )
        .slice(0, 10);

    const sellCandidates =
      ranked
        .filter(
          item =>
            item.aiStrategy
              ?.signal === -1 ||
            num(
              item.aiScore
            ) <= -40
        )
        .sort(
          (a, b) =>
            num(
              a.aiScore
            ) -
            num(
              b.aiScore
            )
        )
        .slice(0, 10);

    if (buyBoard) {
      buyBoard.innerHTML =
        buyCandidates.length
          ? buyCandidates
              .map(
                renderCard
              )
              .join('')
          : `
            <div
              style="
                padding:24px;
                color:var(--ink-dim)
              "
            >
              현재 AI 매수 합의 종목 없음
            </div>
          `;
    }

    if (sellBoard) {
      sellBoard.innerHTML =
        sellCandidates.length
          ? sellCandidates
              .map(
                renderCard
              )
              .join('')
          : `
            <div
              style="
                padding:24px;
                color:var(--ink-dim)
              "
            >
              현재 AI 청산 종목 없음
            </div>
          `;
    }

    renderTape(
      ranked
    );

    renderBreadth(
      data.breadth
    );

    if (updatedAt) {
      updatedAt.textContent =
        `업데이트 ${
          new Date(
            data.generatedAt ||
            Date.now()
          ).toLocaleTimeString(
            'ko-KR'
          )}`;
    }

  } catch (error) {

    console.error(
      '[scan]',
      error
    );

    if (buyBoard) {
      buyBoard.innerHTML = `
        <div
          style="
            padding:32px;
            color:var(--sell)
          "
        >
          스캔 실패:
          ${escapeHtml(
            error.message
          )}
        </div>
      `;
    }

  } finally {
    loading = false;
  }
}


/*
 * ============================================================
 * STOCK SEARCH
 * ============================================================
 */

function renderSearchResults(
  results
) {
  if (!searchResult) {
    return;
  }

  if (
    !Array.isArray(
      results
    ) ||
    !results.length
  ) {
    searchResult.innerHTML = `
      <div class="search-empty">
        검색 결과가 없습니다.
      </div>
    `;

    return;
  }

  searchResult.innerHTML = `
    <div class="search-results-list">

      ${results
        .map(
          item => `
            <button
              type="button"
              class="search-result-item"
              data-search-ticker="${escapeHtml(
                item.ticker
              )}"
              data-search-label="${escapeHtml(
                item.label
              )}"
            >

              <span
                class="search-result-main"
              >

                <strong>
                  ${escapeHtml(
                    item.label
                  )}
                </strong>

                <small>
                  ${escapeHtml(
                    item.ticker
                  )}
                </small>

              </span>

              <span
                class="search-result-exchange"
              >
                ${escapeHtml(
                  item.exchange ||
                  ''
                )}
              </span>

              <span
                class="search-result-action"
              >
                ANALYZE →
              </span>

            </button>
          `
        )
        .join('')}

    </div>
  `;

  searchResult
    .querySelectorAll(
      '[data-search-ticker]'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () => {

            analyzeSearchedStock(
              button.dataset
                .searchTicker,
              button.dataset
                .searchLabel
            );

          }
        );

      }
    );
}


async function searchStocks() {
  if (!searchInput) {
    return;
  }

  const query =
    searchInput.value.trim();

  if (!query) {

    if (searchResult) {
      searchResult.innerHTML = `
        <div class="search-empty">
          종목명 또는 종목코드를 입력하세요.
        </div>
      `;
    }

    return;
  }

  if (searchBtn) {
    searchBtn.disabled =
      true;

    searchBtn.textContent =
      'SEARCHING...';
  }

  if (searchResult) {
    searchResult.innerHTML = `
      <div class="search-loading">
        종목을 검색하는 중...
      </div>
    `;
  }

  try {

    const response =
      await fetch(
        `/api/search?q=${encodeURIComponent(
          query
        )}`,
        {
          cache:
            'no-store',
        }
      );

    const data =
      await response.json();

    if (
      !response.ok
    ) {
      throw new Error(
        data?.error ||
        '검색 실패'
      );
    }

    renderSearchResults(
      data.results
    );

  } catch (error) {

    console.error(
      '[stock search]',
      error
    );

    if (searchResult) {
      searchResult.innerHTML = `
        <div class="search-error">

          검색 중 오류가 발생했습니다.

          <br />

          ${escapeHtml(
            error.message
          )}

        </div>
      `;
    }

  } finally {

    if (searchBtn) {
      searchBtn.disabled =
        false;

      searchBtn.textContent =
        'SEARCH';
    }

  }
}


/*
 * ============================================================
 * CHART
 *
 * Chart.js 같은 외부 라이브러리에 의존하지 않고
 * SVG로 그려서 기존 UI와 충돌하지 않게 한다.
 * ============================================================
 */

function renderPriceChart(
  dates,
  closes
) {
  if (
    !Array.isArray(
      closes
    ) ||
    closes.length < 2
  ) {
    return `
      <div class="search-chart-empty">
        차트 데이터가 부족합니다.
      </div>
    `;
  }

  const values =
    closes
      .map(Number)
      .filter(
        Number.isFinite
      );

  if (
    values.length < 2
  ) {
    return `
      <div class="search-chart-empty">
        차트 데이터가 없습니다.
      </div>
    `;
  }

  const width = 900;
  const height = 300;

  const paddingX = 12;
  const paddingY = 20;

  const min =
    Math.min(
      ...values
    );

  const max =
    Math.max(
      ...values
    );

  const spread =
    max - min ||
    1;

  const points =
    values
      .map(
        (value, index) => {

          const x =
            paddingX +
            (
              index /
              Math.max(
                values.length - 1,
                1
              )
            ) *
            (
              width -
              paddingX * 2
            );

          const y =
            height -
            paddingY -
            (
              (
                value -
                min
              ) /
              spread
            ) *
            (
              height -
              paddingY * 2
            );

          return `${x},${y}`;
        }
      )
      .join(' ');

  const first =
    values[0];

  const last =
    values[
      values.length - 1
    ];

  const chartChange =
    first !== 0
      ? (
          (
            last -
            first
          ) /
          first
        ) *
        100
      : 0;

  const chartClass =
    chartChange >= 0
      ? 'change-up'
      : 'change-down';

  const startDate =
    Array.isArray(dates)
      ? dates[0]
      : '';

  const endDate =
    Array.isArray(dates)
      ? dates[
          dates.length - 1
        ]
      : '';

  return `
    <div class="search-chart">

      <div
        class="search-chart-header"
      >

        <div>

          <strong>
            PRICE CHART
          </strong>

          <span>
            ${escapeHtml(
              startDate || ''
            )}
            →
            ${escapeHtml(
              endDate || ''
            )}
          </span>

        </div>

        <strong
          class="${chartClass}"
        >
          ${
            chartChange >= 0
              ? '+'
              : ''
          }${chartChange.toFixed(
            2
          )}%
        </strong>

      </div>

      <div
        class="search-chart-wrap"
      >

        <svg
          class="search-chart-svg"
          viewBox="0 0 ${width} ${height}"
          preserveAspectRatio="none"
          role="img"
          aria-label="주가 차트"
        >

          <line
            x1="0"
            y1="${height * 0.25}"
            x2="${width}"
            y2="${height * 0.25}"
            class="chart-grid"
          />

          <line
            x1="0"
            y1="${height * 0.5}"
            x2="${width}"
            y2="${height * 0.5}"
            class="chart-grid"
          />

          <line
            x1="0"
            y1="${height * 0.75}"
            x2="${width}"
            y2="${height * 0.75}"
            class="chart-grid"
          />

          <polyline
            points="${points}"
            class="chart-line"
            fill="none"
          />

        </svg>

      </div>

      <div
        class="search-chart-footer"
      >

        <span>
          LOW
          ${formatNumber(
            min,
            2
          )}
        </span>

        <span>
          LAST
          ${formatNumber(
            last,
            2
          )}
        </span>

        <span>
          HIGH
          ${formatNumber(
            max,
            2
          )}
        </span>

      </div>

    </div>
  `;
}


/*
 * ============================================================
 * SEARCH ANALYSIS
 * ============================================================
 */

async function loadSearchChart(
  ticker
) {
  const chartBox =
    document.getElementById(
      'searchedStockChart'
    );

  if (!chartBox) {
    return;
  }

  chartBox.innerHTML = `
    <div class="search-loading">
      차트를 불러오는 중...
    </div>
  `;

  try {

    const response =
      await fetch(
        `/api/chart/${encodeURIComponent(
          ticker
        )}?range=6mo`,
        {
          cache:
            'no-store',
        }
      );

    const data =
      await response.json();

    if (
      !response.ok
    ) {
      throw new Error(
        data?.error ||
        '차트 조회 실패'
      );
    }

    chartBox.innerHTML =
      renderPriceChart(
        data.dates,
        data.closes
      );

  } catch (error) {

    console.error(
      '[chart]',
      error
    );

    chartBox.innerHTML = `
      <div class="search-error">
        차트를 불러오지 못했습니다.
        <br />
        ${escapeHtml(
          error.message
        )}
      </div>
    `;
  }
}


function renderSearchBacktest(
  result
) {
  if (!result) {
    return `
      <div class="search-chart-empty">
        백테스트 결과가 없습니다.
      </div>
    `;
  }

  if (result.error) {
    return `
      <div class="search-error">
        ${escapeHtml(
          result.error
        )}
      </div>
    `;
  }

  const returnPct =
    num(
      result.returnPct
    );

  const returnClass =
    returnPct >= 0
      ? 'change-up'
      : 'change-down';

  return `
    <div
      class="search-backtest-result"
    >

      <div
        class="search-backtest-title"
      >
        BACKTEST RESULT
      </div>

      <div
        class="search-backtest-grid"
      >

        <div>
          <span>RETURN</span>
          <strong
            class="${returnClass}"
          >
            ${
              returnPct >= 0
                ? '+'
                : ''
            }${returnPct.toFixed(
              2
            )}%
          </strong>
        </div>

        <div>
          <span>TRADES</span>
          <strong>
            ${num(
              result.totalTrades
            )}
          </strong>
        </div>

        <div>
          <span>WIN RATE</span>
          <strong>
            ${num(
              result.winRate
            ).toFixed(1)}%
          </strong>
        </div>

        <div>
          <span>PROFIT FACTOR</span>
          <strong>
            ${
              result.profitFactor ===
              null
                ? '—'
                : num(
                    result.profitFactor
                  ).toFixed(2)
            }
          </strong>
        </div>

        <div>
          <span>MAX DD</span>
          <strong
            class="change-down"
          >
            ${num(
              result.maxDrawdownPct
            ).toFixed(2)}%
          </strong>
        </div>

        <div>
          <span>SHARPE</span>
          <strong>
            ${num(
              result.sharpe
            ).toFixed(3)}
          </strong>
        </div>

      </div>

      <div
        class="search-backtest-meta"
      >
        ${escapeHtml(
          result.range ||
          ''
        )}
        ·
        ${escapeHtml(
          result.interval ||
          ''
        )}
        ·
        ${num(
          result?.dataInfo?.bars
        )} bars
      </div>

    </div>
  `;
}


async function runSearchBacktest(
  ticker
) {
  const box =
    document.getElementById(
      'searchedStockBacktest'
    );

  if (!box) {
    return;
  }

  box.innerHTML = `
    <div class="search-loading">
      전략 백테스트를 실행하는 중...
    </div>
  `;

  try {

    /*
     * Yahoo 장중 데이터 제한 때문에
     * 현재 엔진의 30m 백테스트는 최대 60d다.
     */
    const response =
      await fetch(
        `/api/backtest/${encodeURIComponent(
          ticker
        )}?range=60d&interval=30m`,
        {
          cache:
            'no-store',
        }
      );

    const data =
      await response.json();

    if (
      !response.ok
    ) {
      throw new Error(
        data?.error ||
        '백테스트 실패'
      );
    }

    box.innerHTML =
      renderSearchBacktest(
        data
      );

  } catch (error) {

    console.error(
      '[search backtest]',
      error
    );

    box.innerHTML = `
      <div class="search-error">

        백테스트 실패:
        ${escapeHtml(
          error.message
        )}

      </div>
    `;
  }
}


async function analyzeSearchedStock(
  ticker,
  label
) {
  if (
    !searchResult
  ) {
    return;
  }

  searchResult.innerHTML = `
    <div class="search-analysis">

      <div
        class="search-analysis-header"
      >

        <div>

          <strong>
            ${escapeHtml(
              label ||
              ticker
            )}
          </strong>

          <small>
            ${escapeHtml(
              ticker
            )}
          </small>

        </div>

        <span
          class="signal-badge signal-hold"
        >
          ANALYZING
        </span>

      </div>

      <div class="search-loading">
        Multi-Agent AI가 분석하는 중...
      </div>

    </div>
  `;

  try {

    /*
     * AI signal,
     * chart,
     * 기본 quote 정보를
     * 동시에 요청한다.
     */
    const [
      signalResponse,
      chartResponse,
    ] = await Promise.all([
      fetch(
        `/api/signal/${encodeURIComponent(
          ticker
        )}?label=${encodeURIComponent(
          label || ticker
        )}`,
        {
          cache:
            'no-store',
        }
      ),

      fetch(
        `/api/chart/${encodeURIComponent(
          ticker
        )}?range=6mo`,
        {
          cache:
            'no-store',
        }
      ),
    ]);

    const signalData =
      await signalResponse.json();

    const chartData =
      await chartResponse.json();

    if (
      !signalResponse.ok
    ) {
      throw new Error(
        signalData?.error ||
        'AI 분석 실패'
      );
    }

    const signal =
      num(
        signalData.signal
      );

    const confidence =
      num(
        signalData.confidence
      );

    const strength =
      num(
        signalData.strength
      );

    const regime =
      signalData.regime ||
      'UNKNOWN';

    const reason =
      signalData.reason ||
      '판단 이유 없음';

    const decision =
      signal === 1
        ? 'LONG'
        : signal === -1
          ? 'EXIT'
          : 'WAIT';

    const decisionClass =
      signal === 1
        ? 'buy'
        : signal === -1
          ? 'sell'
          : 'hold';

    /*
     * 검색 분석 화면 자체에
     * 차트 / AI / 백테스트를 모두 넣는다.
     */
    searchResult.innerHTML = `
      <div class="search-analysis">

        <div
          class="search-analysis-header"
        >

          <div>

            <strong>
              ${escapeHtml(
                label ||
                ticker
              )}
            </strong>

            <small>
              ${escapeHtml(
                ticker
              )}
            </small>

          </div>

          <span
            class="signal-badge signal-${decisionClass}"
          >
            ${decision}
          </span>

        </div>


        <div
          class="search-analysis-grid"
        >

          <div>
            <span>
              AI SCORE
            </span>

            <strong>
              ${strength.toFixed(
                1
              )}
            </strong>
          </div>


          <div>
            <span>
              CONFIDENCE
            </span>

            <strong>
              ${confidence.toFixed(
                1
              )}%
            </strong>
          </div>


          <div>
            <span>
              REGIME
            </span>

            <strong>
              ${escapeHtml(
                regime
              )}
            </strong>
          </div>

        </div>


        <div
          class="search-analysis-reason"
        >
          ${escapeHtml(
            reason
          )}
        </div>


        <div
          id="searchedStockChart"
        >

          ${
            chartResponse.ok
              ? renderPriceChart(
                  chartData.dates,
                  chartData.closes
                )
              : `
                <div class="search-error">
                  차트 조회 실패:
                  ${escapeHtml(
                    chartData?.error ||
                    '차트 데이터 없음'
                  )}
                </div>
              `
          }

        </div>


        <div
          class="searched-stock-actions"
        >

          <button
            type="button"
            id="searchedBacktestBtn"
            class="btn-apply"
          >
            RUN BACKTEST
          </button>

          <button
            type="button"
            id="searchBackBtn"
            class="btn-refresh"
          >
            ← 검색 결과
          </button>

        </div>


        <div
          id="searchedStockBacktest"
        ></div>


      </div>
    `;

    /*
     * 검색한 종목을
     * 아래의 전체 백테스트 입력에도 자동 입력.
     */
    if (
      backtestTicker
    ) {
      backtestTicker.value =
        ticker;
    }

    document
      .getElementById(
        'searchedBacktestBtn'
      )
      ?.addEventListener(
        'click',
        () =>
          runSearchBacktest(
            ticker
          )
      );

    document
      .getElementById(
        'searchBackBtn'
      )
      ?.addEventListener(
        'click',
        searchStocks
      );

  } catch (error) {

    console.error(
      '[searched stock analysis]',
      error
    );

    searchResult.innerHTML = `
      <div class="search-error">

        분석 실패:

        ${escapeHtml(
          error.message
        )}

        <br /><br />

        <button
          type="button"
          id="searchRetryBtn"
          class="btn-refresh"
        >
          다시 분석
        </button>

      </div>
    `;

    document
      .getElementById(
        'searchRetryBtn'
      )
      ?.addEventListener(
        'click',
        () =>
          analyzeSearchedStock(
            ticker,
            label
          )
      );
  }
}


/*
 * ============================================================
 * GLOBAL BACKTEST PANEL
 * ============================================================
 */

async function runGlobalBacktest() {
  if (
    !backtestTicker ||
    !backtestResult
  ) {
    return;
  }

  const ticker =
    backtestTicker.value.trim();

  if (!ticker) {
    backtestResult.innerHTML = `
      <div class="search-empty">
        종목코드를 입력하세요.
      </div>
    `;

    return;
  }

  if (backtestBtn) {
    backtestBtn.disabled =
      true;

    backtestBtn.textContent =
      'RUNNING...';
  }

  backtestResult.innerHTML = `
    <div class="search-loading">
      백테스트 실행 중...
    </div>
  `;

  try {

    const response =
      await fetch(
        `/api/backtest/${encodeURIComponent(
          ticker
        )}?range=60d&interval=30m`,
        {
          cache:
            'no-store',
        }
      );

    const data =
      await response.json();

    if (
      !response.ok
    ) {
      throw new Error(
        data?.error ||
        '백테스트 실패'
      );
    }

    backtestResult.innerHTML =
      renderSearchBacktest(
        data
      );

  } catch (error) {

    backtestResult.innerHTML = `
      <div class="search-error">
        백테스트 실패:
        ${escapeHtml(
          error.message
        )}
      </div>
    `;

  } finally {

    if (backtestBtn) {
      backtestBtn.disabled =
        false;

      backtestBtn.textContent =
        'RUN BACKTEST';
    }

  }
}


/*
 * ============================================================
 * EVENTS
 * ============================================================
 */

if (searchBtn) {
  searchBtn.addEventListener(
    'click',
    searchStocks
  );
}


if (searchInput) {
  searchInput.addEventListener(
    'keydown',
    event => {

      if (
        event.key ===
        'Enter'
      ) {
        event.preventDefault();

        searchStocks();
      }

    }
  );
}


if (backtestBtn) {
  backtestBtn.addEventListener(
    'click',
    runGlobalBacktest
  );
}


if (newsRefresh) {
  newsRefresh.addEventListener(
    'click',
    loadMarketNews
  );
}


if (refreshBtn) {
  refreshBtn.addEventListener(
    'click',
    async () => {

      await Promise.all([
        loadMarketOverview(),
        loadScan(),
        loadMarketNews(),
      ]);

    }
  );
}


/*
 * ============================================================
 * AUTH GATE
 * ============================================================
 */

const authGate =
  document.getElementById('authGate');

const authForm =
  document.getElementById('authForm');

const authPassword =
  document.getElementById('authPassword');

const authSubmit =
  document.getElementById('authSubmit');

const authError =
  document.getElementById('authError');

async function checkAuthAndStart() {
  let status;

  try {
    const res = await fetch('/api/auth/status');
    status = await res.json();
  } catch (err) {
    // 상태 확인 실패 시에도 앱은 일단 띄운다(로컬 개발 등).
    startApp();
    return;
  }

  if (!status.authRequired || status.authed) {
    startApp();
    return;
  }

  authGate.hidden = false;
  authPassword.focus();
}

authForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  authSubmit.disabled = true;
  authError.hidden = true;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: authPassword.value }),
    });

    const data = await res.json();

    if (!res.ok) {
      authError.textContent =
        data.error || '로그인에 실패했습니다.';
      authError.hidden = false;
      authPassword.value = '';
      authPassword.focus();
      return;
    }

    authGate.hidden = true;
    startApp();
  } catch (err) {
    authError.textContent = '네트워크 오류가 발생했습니다.';
    authError.hidden = false;
  } finally {
    authSubmit.disabled = false;
  }
});

let appStarted = false;

function startApp() {
  if (appStarted) return;
  appStarted = true;

  Promise.all([
    loadMarketOverview(),
    loadScan(),
    loadMarketNews(),
  ]);
}


/*
 * ============================================================
 * INITIAL LOAD
 * ============================================================
 */

window.addEventListener(
  'DOMContentLoaded',
  () => {
    checkAuthAndStart();
  }
);

