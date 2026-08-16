// app.js
//
// SIGNAL DESK
//
// 기존 SIGNAL DESK UI 유지
// 검색 → AI 분석 → 차트 → 백테스트
// 시장 현황 → 뉴스 → 스캔 → breadth
//
// 안정화:
// - 검색 / AI / 차트를 서로 독립적으로 처리
// - AI 실패 시에도 차트 표시
// - 차트 실패 시에도 AI 결과 표시
// - 검색 결과에서 백테스트 연결 유지
// - 뉴스 / 시장현황 / 스캔 개별 실패 허용
// - 중복 이벤트 등록 방지
// - 외부 뉴스 링크 안전성 강화
// - 숫자/배열/null 응답 방어
//

/* ============================================================
 * SERVICE WORKER
 * ============================================================ */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch(err => {
        console.warn(
          '서비스워커 등록 실패:',
          err
        );
      });
  });
}


/* ============================================================
 * DOM
 * ============================================================ */

const buyBoard =
  document.getElementById('buyBoard');

const sellBoard =
  document.getElementById('sellBoard');

const marketOverview =
  document.getElementById('marketOverview');

const breadthBar =
  document.getElementById('breadthBar');

const tape =
  document.getElementById('tape');

const updatedAt =
  document.getElementById('updatedAt') ||
  document.getElementById('updated');

const refreshBtn =
  document.getElementById('refreshBtn');

const searchInput =
  document.getElementById('searchInput');

const searchBtn =
  document.getElementById('searchBtn');

const searchResult =
  document.getElementById('searchResult');

const newsList =
  document.getElementById('newsList') ||
  document.getElementById('marketNewsList');

const newsRefresh =
  document.getElementById('marketNewsRefresh') ||
  document.getElementById('marketNewsRefreshBtn');

const newsUpdated =
  document.getElementById('newsUpdated');

const backtestTicker =
  document.getElementById('backtestTicker');

const backtestPeriod =
  document.getElementById('backtestPeriod');

const backtestBtn =
  document.getElementById('backtestBtn');

const backtestResult =
  document.getElementById('backtestResult');

const accountTotal =
  document.getElementById('accountTotal');

const accountAvailable =
  document.getElementById('accountAvailable');

const accountProfit =
  document.getElementById('accountProfit');

const accountRate =
  document.getElementById('accountRate');

const accountNotice =
  document.getElementById('accountNotice');

const holdingsList =
  document.getElementById('holdingsList');


let loading = false;
let appStarted = false;


/* ============================================================
 * UTILS
 * ============================================================ */

async function safeJson(response) {
  const text =
    await response.text();

  let data = {};

  try {
    data =
      text
        ? JSON.parse(text)
        : {};
  } catch {
    throw new Error(
      `서버 응답 오류 (HTTP ${response.status})`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      `요청 실패 (HTTP ${response.status})`
    );
  }

  return data;
}


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

  if (!Number.isFinite(n)) {
    return '—';
  }

  if (
    currency === 'KRW' ||
    currency === '원'
  ) {
    return (
      Math.round(n)
        .toLocaleString('ko-KR') +
      '원'
    );
  }

  return (
    '$' +
    n.toLocaleString(
      'en-US',
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    )
  );
}


function fmtChange(value) {
  const n =
    Number(value);

  if (!Number.isFinite(n)) {
    return '';
  }

  return (
    (n >= 0 ? '+' : '') +
    n.toFixed(2) +
    '%'
  );
}


function formatNumber(
  value,
  digits = 2
) {
  const n =
    Number(value);

  if (!Number.isFinite(n)) {
    return '—';
  }

  return n.toLocaleString(
    'ko-KR',
    {
      minimumFractionDigits:
        digits,
      maximumFractionDigits:
        digits
    }
  );
}


function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


/*
 * 뉴스 링크는 HTML escape만으로
 * javascript: 같은 scheme까지 막을 수 없다.
 *
 * 실제 RSS 링크만 허용하고
 * 이상한 URL은 #으로 처리한다.
 */
function safeExternalUrl(value) {
  const raw =
    String(value || '').trim();

  if (!raw) {
    return '#';
  }

  try {
    const url =
      new URL(
        raw,
        window.location.origin
      );

    if (
      url.protocol !== 'http:' &&
      url.protocol !== 'https:'
    ) {
      return '#';
    }

    return url.href;
  } catch {
    return '#';
  }
}


function signalClass(item) {
  if (
    item?.aiStrategy?.signal === 1 ||
    num(item?.signal) === 1
  ) {
    return 'buy';
  }

  if (
    item?.aiStrategy?.signal === -1 ||
    num(item?.signal) === -1
  ) {
    return 'sell';
  }

  return 'hold';
}


function signalText(item) {
  if (item?.aiLabel) {
    return item.aiLabel;
  }

  if (
    item?.aiStrategy?.decision
  ) {
    return item.aiStrategy.decision;
  }

  if (item?.decision) {
    return item.decision;
  }

  return (
    item?.classification ||
    'AI 대기'
  );
}


function decisionText(signal) {
  if (num(signal) === 1) {
    return 'LONG';
  }

  if (num(signal) === -1) {
    return 'EXIT';
  }

  return 'WAIT';
}


function decisionClass(signal) {
  if (num(signal) === 1) {
    return 'buy';
  }

  if (num(signal) === -1) {
    return 'sell';
  }

  return 'hold';
}


/* ============================================================
 * NEWS
 * ============================================================ */

function formatNewsTime(value) {
  const time =
    Date.parse(value);

  if (!time) {
    return '';
  }

  return new Date(time)
    .toLocaleString(
      'ko-KR',
      {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }
    );
}


function newsCategoryLabel(category) {
  const map = {
    KOREA: 'KOREA',
    US: 'US MARKET',
    SEMICONDUCTOR:
      'SEMICONDUCTOR',
    MACRO: 'MACRO',
    GLOBAL: 'GLOBAL'
  };

  return (
    map[category] ||
    'MARKET'
  );
}


function renderMarketNews(articles) {
  if (!newsList) {
    return;
  }

  if (
    !Array.isArray(articles) ||
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
      .map(article => {
        const title =
          article?.title ||
          article?.description ||
          '제목 없음';

        const link =
          safeExternalUrl(
            article?.link
          );

        return `
          <article class="market-news-item">

            <div class="market-news-meta">

              <span class="market-news-category">
                ${escapeHtml(
                  newsCategoryLabel(
                    article?.category
                  )
                )}
              </span>

              <span>
                ${escapeHtml(
                  article?.source || ''
                )}
              </span>

              <span>
                ${escapeHtml(
                  formatNewsTime(
                    article?.pubDate
                  )
                )}
              </span>

            </div>

            <a
              class="market-news-title"
              href="${escapeHtml(link)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              ${escapeHtml(title)}
            </a>

          </article>
        `;
      })
      .join('');

  if (newsUpdated) {
    newsUpdated.textContent =
      `LIVE · ${
        new Date()
          .toLocaleTimeString('ko-KR')
      }`;
  }
}


async function loadMarketNews() {
  if (!newsList) {
    return;
  }

  if (newsRefresh) {
    newsRefresh.disabled = true;

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
          cache: 'no-store'
        }
      );

    const data =
      await safeJson(response);

    renderMarketNews(
      data?.articles
    );

  } catch (error) {
    console.error(
      '[market news]',
      error
    );

    newsList.innerHTML = `
      <div class="search-error">
        주요 시황을 불러오지 못했습니다.
        <br>
        ${escapeHtml(
          error.message
        )}
      </div>
    `;

  } finally {
    if (newsRefresh) {
      newsRefresh.disabled = false;

      newsRefresh.textContent =
        'NEWS REFRESH';
    }
  }
}


/* ============================================================
 * STOCK HEADLINES
 * ============================================================ */

function renderHeadlines(headlines) {
  if (
    !Array.isArray(headlines) ||
    !headlines.length
  ) {
    return '';
  }

  return `
    <ul class="headlines">

      ${headlines
        .slice(0, 5)
        .map(headline => {
          const title =
            typeof headline === 'string'
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
            sentiment === 'positive'
              ? 'change-up'
              : sentiment === 'negative'
                ? 'change-down'
                : '';

          const tag =
            sentiment === 'positive'
              ? '[긍정]'
              : sentiment === 'negative'
                ? '[부정]'
                : '';

          return `
            <li>
              <span class="${cls}">
                ${tag}
              </span>
              ${escapeHtml(title)}
            </li>
          `;
        })
        .join('')}

    </ul>
  `;
}


/* ============================================================
 * AI SUMMARY
 * ============================================================ */

function renderAgentSummary(item) {
  const strategy =
    item?.aiStrategy ||
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
    num(item?.aiConfidence);

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
          class="signal-badge signal-${signalClass(item)}"
        >
          ${escapeHtml(
            signalText(item)
          )}
        </span>

        <span class="ai-score">
          AI ${num(
            item?.aiScore
          ).toFixed(0)}
        </span>

        <span class="ai-confidence">
          신뢰도 ${confidence.toFixed(0)}%
        </span>

      </div>

      <div class="ai-meta">

        <span>
          Regime:
          ${escapeHtml(regime)}
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


/* ============================================================
 * EXECUTION
 * ============================================================ */

function renderExecution(item) {
  const execution =
    item?.aiStrategy?.execution;

  if (!execution) {
    return '';
  }

  const values = [
    execution.entry,
    execution.stop,
    execution.target1,
    execution.target2,
    execution.riskReward
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
          <b>
            ${escapeHtml(
              execution.entry
            )}
          </b>
        </div>

        <div>
          <span>손절</span>
          <b>
            ${escapeHtml(
              execution.stop
            )}
          </b>
        </div>

        <div>
          <span>목표1</span>
          <b>
            ${escapeHtml(
              execution.target1
            )}
          </b>
        </div>

        <div>
          <span>목표2</span>
          <b>
            ${escapeHtml(
              execution.target2
            )}
          </b>
        </div>

        <div>
          <span>R/R</span>
          <b>
            ${escapeHtml(
              execution.riskReward
            )}
          </b>
        </div>

      </div>

    </div>
  `;
}


/* ============================================================
 * UP PROBABILITY
 * ============================================================ */

function renderUpProbability(up) {
  if (!up?.byHorizon) {
    return '';
  }

  const horizons =
    Object.keys(up.byHorizon)
      .map(Number)
      .filter(Number.isFinite)
      .sort(
        (a, b) => a - b
      );

  if (!horizons.length) {
    return '';
  }

  return `
    <div class="up-prob">

      <div class="up-prob-title">
        상승 확률
      </div>

      ${horizons
        .map(horizon => {
          const data =
            up.byHorizon[
              horizon
            ];

          if (
            !data ||
            data.probability === null ||
            data.probability === undefined
          ) {
            return `
              <div class="prob-row">
                <span>
                  ${horizon}거래일
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
                ${escapeHtml(
                  data.probability
                )}%
              </strong>

              <span>
                평균
                ${escapeHtml(
                  data.avgReturnPct
                )}%
              </span>

            </div>
          `;
        })
        .join('')}

    </div>
  `;
}


/* ============================================================
 * SCAN CARD
 * ============================================================ */

function renderCard(item) {
  if (item?.error) {
    return `
      <div class="card">

        <div class="card-head">

          <span>
            ${escapeHtml(
              item?.label
            )}
          </span>

          <span>
            ${escapeHtml(
              item?.ticker
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
    num(item?.changePct);

  const score =
    num(item?.combinedScore);

  const aiScore =
    num(item?.aiScore);

  const changeClass =
    change >= 0
      ? 'change-up'
      : 'change-down';

  const barClass =
    signalClass(item);

  const barWidth =
    Math.min(
      50,
      Math.abs(score) / 2
    );

  return `
    <article
      class="card"
      data-ticker="${escapeHtml(
        item?.ticker
      )}"
    >

      <div class="card-head">

        <span class="card-label">
          ${escapeHtml(
            item?.label
          )}
        </span>

        <span class="card-ticker">
          ${escapeHtml(
            item?.ticker
          )}
        </span>

      </div>

      <div class="card-price">
        ${fmtPrice(
          item?.currentPrice,
          item?.currency
        )}
      </div>

      <div class="card-change ${changeClass}">
        ${fmtChange(
          item?.changePct
        )}
      </div>

      <div
        class="signal-badge signal-${barClass}"
      >
        ${escapeHtml(
          signalText(item)
        )}
        · AI
        ${aiScore >= 0 ? '+' : ''}
        ${aiScore}
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

      ${renderAgentSummary(item)}

      ${renderExecution(item)}

      ${renderUpProbability(
        item?.upProbability
      )}

      <div class="breakdown">

        <div>
          <b>기술적</b>
          ${num(
            item?.technical?.score
          ).toFixed(0)}
        </div>

        <div>
          <b>뉴스</b>
          ${num(
            item?.news?.score
          ).toFixed(0)}
        </div>

        <div>
          <b>기존 점수</b>
          ${score}
        </div>

      </div>

      ${renderHeadlines(
        item?.news?.headlines
      )}

    </article>
  `;
}


/* ============================================================
 * TAPE
 * ============================================================ */

function renderTape(ranked) {
  if (!tape) {
    return;
  }

  const valid =
    Array.isArray(ranked)
      ? ranked.filter(
          item => !item?.error
        )
      : [];

  if (!valid.length) {
    tape.innerHTML =
      '<span>데이터 없음</span>';

    return;
  }

  const items = [
    ...valid,
    ...valid
  ];

  tape.innerHTML = `
    <div class="tape-inner">

      ${items
        .map(item => {
          const score =
            num(item?.aiScore);

          const cls =
            signalClass(item);

          return `
            <span class="tape-item">

              ${escapeHtml(
                item?.label
              )}

              <span
                class="change-${cls}"
              >
                ${score >= 0 ? '+' : ''}
                ${score}
              </span>

            </span>
          `;
        })
        .join('')}

    </div>
  `;
}


/* ============================================================
 * BREADTH
 * ============================================================ */

function renderBreadth(breadth) {
  if (
    !breadthBar ||
    !breadth
  ) {
    return;
  }

  const total =
    num(breadth.total);

  if (!total) {
    return;
  }

  const buy =
    num(breadth.buyCount);

  const hold =
    num(breadth.holdCount);

  const sell =
    num(breadth.sellCount);

  breadthBar.innerHTML = `
    <span>
      MARKET BREADTH
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


/* ============================================================
 * MARKET OVERVIEW
 * ============================================================ */

function renderMarketOverview(indices) {
  if (!marketOverview) {
    return;
  }

  const list =
    Array.isArray(indices)
      ? indices
      : [];

  if (!list.length) {
    marketOverview.innerHTML = `
      <div class="mo-loading">
        시장 데이터가 없습니다.
      </div>
    `;

    return;
  }

  marketOverview.innerHTML =
    list
      .map(index => {
        if (index?.error) {
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
          num(index?.changePct);

        return `
          <div class="mo-card">

            <div class="mo-label">
              ${escapeHtml(
                index?.label
              )}
            </div>

            <div class="mo-price">
              ${fmtPrice(
                index?.currentPrice,
                index?.currency
              )}
            </div>

            <div
              class="
                mo-change
                ${
                  change >= 0
                    ? 'change-up'
                    : 'change-down'
                }
              "
            >
              ${fmtChange(
                index?.changePct
              )}
            </div>

          </div>
        `;
      })
      .join('');
}


async function loadMarketOverview() {
  try {
    const response =
      await fetch(
        '/api/market-overview',
        {
          cache: 'no-store'
        }
      );

    const data =
      await safeJson(response);

    renderMarketOverview(
      data?.indices
    );

  } catch (error) {
    console.error(
      '[market overview]',
      error
    );

    if (marketOverview) {
      marketOverview.innerHTML = `
        <div class="mo-loading">
          시장 현황 조회 실패
        </div>
      `;
    }
  }
}


/* ============================================================
 * MARKET SCAN
 * ============================================================ */

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
          cache: 'no-store'
        }
      );

    const data =
      await safeJson(response);

    const ranked =
      Array.isArray(data?.ranked)
        ? data.ranked
        : [];

    const buyCandidates =
      ranked
        .filter(
          item =>
            item?.aiStrategy?.signal === 1 ||
            num(item?.aiScore) >= 50
        )
        .slice(0, 10);

    const sellCandidates =
      ranked
        .filter(
          item =>
            item?.aiStrategy?.signal === -1 ||
            num(item?.aiScore) <= -40
        )
        .sort(
          (a, b) =>
            num(a?.aiScore) -
            num(b?.aiScore)
        )
        .slice(0, 10);

    if (buyBoard) {
      buyBoard.innerHTML =
        buyCandidates.length
          ? buyCandidates
              .map(renderCard)
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
              .map(renderCard)
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

    renderTape(ranked);
    renderBreadth(data?.breadth);

    if (updatedAt) {
      updatedAt.textContent =
        `업데이트 ${
          new Date(
            data?.generatedAt ||
            Date.now()
          ).toLocaleTimeString(
            'ko-KR'
          )
        }`;
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

    if (sellBoard) {
      sellBoard.innerHTML = `
        <div
          style="
            padding:32px;
            color:var(--ink-dim)
          "
        >
          스캔 데이터를 불러오지 못했습니다.
        </div>
      `;
    }

  } finally {
    loading = false;
  }
}


/* ============================================================
 * SEARCH RESULTS
 * ============================================================ */

function renderSearchResults(results) {
  if (!searchResult) {
    return;
  }

  if (
    !Array.isArray(results) ||
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
        .map(item => `
          <button
            type="button"
            class="search-result-item"
            data-search-ticker="${escapeHtml(
              item?.ticker
            )}"
            data-search-label="${escapeHtml(
              item?.label
            )}"
          >

            <span class="search-result-main">

              <strong>
                ${escapeHtml(
                  item?.label
                )}
              </strong>

              <small>
                ${escapeHtml(
                  item?.ticker
                )}
              </small>

            </span>

            <span
              class="search-result-exchange"
            >
              ${escapeHtml(
                item?.exchange || ''
              )}
            </span>

            <span
              class="search-result-action"
            >
              ANALYZE →
            </span>

          </button>
        `)
        .join('')}

    </div>
  `;

  searchResult
    .querySelectorAll(
      '[data-search-ticker]'
    )
    .forEach(button => {
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
    });
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
    searchBtn.disabled = true;

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
          cache: 'no-store'
        }
      );

    const data =
      await safeJson(response);

    renderSearchResults(
      data?.results
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
          <br>
          ${escapeHtml(
            error.message
          )}
        </div>
      `;
    }

  } finally {
    if (searchBtn) {
      searchBtn.disabled = false;

      searchBtn.textContent =
        'SEARCH';
    }
  }
}


/* ============================================================
 * PRICE CHART
 *
 * 외부 Chart.js 의존 없음.
 * SVG 기반이라 기존 SIGNAL DESK UI와 충돌하지 않는다.
 * ============================================================ */

function renderPriceChart(
  dates,
  closes
) {
  if (
    !Array.isArray(closes) ||
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

  if (values.length < 2) {
    return `
      <div class="search-chart-empty">
        차트 데이터가 없습니다.
      </div>
    `;
  }

  const width = 900;
  const height = 300;
  const paddingX = 14;
  const paddingY = 20;

  const min =
    Math.min(...values);

  const max =
    Math.max(...values);

  const spread =
    max - min || 1;

  const points =
    values
      .map((value, index) => {
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
              value - min
            ) /
            spread
          ) *
          (
            height -
            paddingY * 2
          );

        return `${x},${y}`;
      })
      .join(' ');

  const first =
    values[0];

  const last =
    values[
      values.length - 1
    ];

  const change =
    first !== 0
      ? (
          (
            last - first
          ) /
          first
        ) *
        100
      : 0;

  const changeClass =
    change >= 0
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
              startDate
            )}
            →
            ${escapeHtml(
              endDate
            )}
          </span>

        </div>

        <strong
          class="${changeClass}"
        >
          ${change >= 0 ? '+' : ''}
          ${change.toFixed(2)}%
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
          ${formatNumber(min, 2)}
        </span>

        <span>
          LAST
          ${formatNumber(last, 2)}
        </span>

        <span>
          HIGH
          ${formatNumber(max, 2)}
        </span>

      </div>

    </div>
  `;
}


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
          cache: 'no-store'
        }
      );

    const data =
      await safeJson(response);

    chartBox.innerHTML =
      renderPriceChart(
        data?.dates,
        data?.closes
      );

  } catch (error) {
    console.error(
      '[chart]',
      error
    );

    chartBox.innerHTML = `
      <div class="search-error">
        차트를 불러오지 못했습니다.
        <br>
        ${escapeHtml(
          error.message
        )}
      </div>
    `;
  }
}


/* ============================================================
 * SEARCH BACKTEST
 * ============================================================ */

function renderSearchBacktest(result) {
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
    num(result.returnPct);

  const returnClass =
    returnPct >= 0
      ? 'change-up'
      : 'change-down';

  const profitFactor =
    result.profitFactor === null ||
    result.profitFactor === undefined
      ? '—'
      : formatNumber(
          result.profitFactor,
          2
        );

  return `
    <div class="search-backtest-result">

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
            ${returnPct >= 0 ? '+' : ''}
            ${returnPct.toFixed(2)}%
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
            ${profitFactor}
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
          result.range || ''
        )}
        ·
        ${escapeHtml(
          result.interval || ''
        )}
        ·
        ${num(
          result?.dataInfo?.bars
        )} bars
      </div>

      ${
        result.rangeAdjusted
          ? `
            <div
              class="search-backtest-meta"
            >
              요청한 범위보다 Yahoo Finance
              장중 데이터 제한에 맞춰
              실제 사용 범위가 조정되었습니다.
            </div>
          `
          : ''
      }

    </div>
  `;
}


function getBacktestConfig() {
  const period =
    backtestPeriod?.value ||
    '1y';

  /*
   * Yahoo 장중 데이터 제한 때문에
   * 엔진이 안정적으로 사용하는 30m 데이터는
   * 60d 범위로 고정한다.
   *
   * select의 1y/2y/3y/5y는
   * UI 호환을 유지한다.
   */
  return {
    range: '60d',
    interval: '30m',
    displayPeriod: period
  };
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
    const config =
      getBacktestConfig();

    const response =
      await fetch(
        `/api/backtest/${encodeURIComponent(
          ticker
        )}?range=${encodeURIComponent(
          config.range
        )}&interval=${encodeURIComponent(
          config.interval
        )}`,
        {
          cache: 'no-store'
        }
      );

    const data =
      await safeJson(response);

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


/* ============================================================
 * SEARCH ANALYSIS
 *
 * 핵심 수정:
 *
 * 기존:
 * Promise.all([
 *   signal,
 *   chart
 * ])
 *
 * 문제:
 * signal 하나만 실패해도
 * chart 결과까지 버려짐.
 *
 * 수정:
 * Promise.allSettled()
 *
 * → AI 실패와 차트 실패를 독립적으로 표시.
 * ============================================================ */

async function analyzeSearchedStock(
  ticker,
  label
) {
  if (!searchResult) {
    return;
  }

  const safeTicker =
    String(
      ticker || ''
    )
      .trim()
      .toUpperCase();

  const safeLabel =
    String(
      label ||
      safeTicker
    ).trim();

  if (!safeTicker) {
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
              safeLabel
            )}
          </strong>

          <small>
            ${escapeHtml(
              safeTicker
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

  /*
   * 검색한 종목의 AI와 차트를
   * 서로 독립적으로 요청한다.
   */
  const results =
    await Promise.allSettled([
      fetch(
        `/api/signal/${encodeURIComponent(
          safeTicker
        )}?label=${encodeURIComponent(
          safeLabel
        )}`,
        {
          cache: 'no-store'
        }
      ),

      fetch(
        `/api/chart/${encodeURIComponent(
          safeTicker
        )}?range=6mo`,
        {
          cache: 'no-store'
        }
      )
    ]);

  /*
   * --------------------------
   * AI 결과
   * --------------------------
   */

  let signalData = null;
  let signalError = '';

  const signalRequest =
    results[0];

  if (
    signalRequest?.status ===
    'fulfilled'
  ) {
    try {
      signalData =
        await safeJson(
          signalRequest.value
        );
    } catch (error) {
      signalError =
        error.message;
    }
  } else {
    signalError =
      signalRequest?.reason?.message ||
      'AI 분석 요청 실패';
  }

  /*
   * --------------------------
   * Chart 결과
   * --------------------------
   */

  let chartData = null;
  let chartError = '';

  const chartRequest =
    results[1];

  if (
    chartRequest?.status ===
    'fulfilled'
  ) {
    try {
      chartData =
        await safeJson(
          chartRequest.value
        );
    } catch (error) {
      chartError =
        error.message;
    }
  } else {
    chartError =
      chartRequest?.reason?.message ||
      '차트 요청 실패';
  }

  /*
   * --------------------------
   * AI 데이터 정리
   * --------------------------
   */

  const signal =
    signalData
      ? num(
          signalData?.signal
        )
      : 0;

  const confidence =
    signalData
      ? num(
          signalData?.confidence
        )
      : 0;

  const strength =
    signalData
      ? num(
          signalData?.strength
        )
      : 0;

  const regime =
    signalData?.regime ||
    'UNKNOWN';

  const reason =
    signalData?.reason ||
    (
      signalError
        ? 'AI 분석 결과를 가져오지 못했습니다.'
        : '판단 이유 없음'
    );

  const decision =
    decisionText(
      signal
    );

  const decisionCls =
    decisionClass(
      signal
    );

  /*
   * --------------------------
   * 분석 화면
   * --------------------------
   */

  searchResult.innerHTML = `
    <div class="search-analysis">

      <div
        class="search-analysis-header"
      >

        <div>

          <strong>
            ${escapeHtml(
              safeLabel
            )}
          </strong>

          <small>
            ${escapeHtml(
              safeTicker
            )}
          </small>

        </div>

        <span
          class="
            signal-badge
            signal-${decisionCls}
          "
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
            ${
              signalData
                ? strength.toFixed(1)
                : '—'
            }
          </strong>
        </div>


        <div>
          <span>
            CONFIDENCE
          </span>

          <strong>
            ${
              signalData
                ? confidence.toFixed(1) + '%'
                : '—'
            }
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


      ${
        signalError
          ? `
            <div
              class="search-error"
              style="margin-top:12px"
            >
              AI 분석:
              ${escapeHtml(
                signalError
              )}
            </div>
          `
          : ''
      }


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
          chartData
            ? renderPriceChart(
                chartData?.dates,
                chartData?.closes
              )
            : `
              <div
                class="search-error"
              >
                차트를 불러오지 못했습니다.
                <br>
                ${escapeHtml(
                  chartError ||
                  '차트 데이터 없음'
                )}

                <br><br>

                <button
                  type="button"
                  id="searchChartRetryBtn"
                  class="btn-refresh"
                >
                  RETRY CHART
                </button>
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


      <div
        class="search-analysis-footer"
      >

        <button
          type="button"
          id="searchRefreshAnalysisBtn"
          class="btn-refresh"
        >
          REFRESH ANALYSIS
        </button>

      </div>

    </div>
  `;


  /*
   * 검색한 종목을
   * 아래 백테스트 입력에도 자동 입력.
   */
  if (backtestTicker) {
    backtestTicker.value =
      safeTicker;
  }


  /*
   * 백테스트
   */
  document
    .getElementById(
      'searchedBacktestBtn'
    )
    ?.addEventListener(
      'click',
      () =>
        runSearchBacktest(
          safeTicker
        )
    );


  /*
   * 검색 결과로 돌아가기
   */
  document
    .getElementById(
      'searchBackBtn'
    )
    ?.addEventListener(
      'click',
      searchStocks
    );


  /*
   * AI 재분석
   */
  document
    .getElementById(
      'searchRefreshAnalysisBtn'
    )
    ?.addEventListener(
      'click',
      () =>
        analyzeSearchedStock(
          safeTicker,
          safeLabel
        )
    );


  /*
   * 차트 재시도
   */
  document
    .getElementById(
      'searchChartRetryBtn'
    )
    ?.addEventListener(
      'click',
      () =>
        analyzeSearchedStock(
          safeTicker,
          safeLabel
        )
    );
}


/* ============================================================
 * GLOBAL BACKTEST
 * ============================================================ */

async function runGlobalBacktest() {
  if (
    !backtestTicker ||
    !backtestResult
  ) {
    return;
  }

  const ticker =
    backtestTicker.value
      .trim()
      .toUpperCase();

  if (!ticker) {
    backtestResult.innerHTML = `
      <div class="search-empty">
        종목코드를 입력하세요.
      </div>
    `;

    return;
  }

  if (backtestBtn) {
    backtestBtn.disabled = true;

    backtestBtn.textContent =
      'RUNNING...';
  }

  backtestResult.innerHTML = `
    <div class="search-loading">
      백테스트 실행 중...
    </div>
  `;

  try {
    const config =
      getBacktestConfig();

    const response =
      await fetch(
        `/api/backtest/${encodeURIComponent(
          ticker
        )}?range=${encodeURIComponent(
          config.range
        )}&interval=${encodeURIComponent(
          config.interval
        )}`,
        {
          cache: 'no-store'
        }
      );

    const data =
      await safeJson(response);

    backtestResult.innerHTML =
      renderSearchBacktest(
        data
      );

  } catch (error) {
    console.error(
      '[global backtest]',
      error
    );

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


/* ============================================================
 * ACCOUNT
 * ============================================================ */

function renderAccount(data) {
  if (!data) {
    return;
  }

  if (accountTotal) {
    accountTotal.textContent =
      fmtPrice(
        data.totalValue ??
        data.total ??
        data.evaluationAmount,
        'KRW'
      );
  }

  if (accountAvailable) {
    accountAvailable.textContent =
      fmtPrice(
        data.available ??
        data.availableAmount ??
        data.orderableAmount,
        'KRW'
      );
  }

  if (accountProfit) {
    const profit =
      num(
        data.profit ??
        data.evaluationProfit
      );

    accountProfit.textContent =
      (
        profit >= 0
          ? '+'
          : ''
      ) +
      profit.toLocaleString(
        'ko-KR'
      );
  }

  if (accountRate) {
    const rate =
      num(
        data.rate ??
        data.profitRate
      );

    accountRate.textContent =
      (
        rate >= 0
          ? '+'
          : ''
      ) +
      rate.toFixed(2) +
      '%';
  }

  if (
    holdingsList &&
    Array.isArray(
      data.holdings
    )
  ) {
    if (!data.holdings.length) {
      holdingsList.innerHTML = `
        <div class="account-notice">
          보유 종목이 없습니다.
        </div>
      `;
    } else {
      holdingsList.innerHTML =
        data.holdings
          .map(item => `
            <div class="holding-row">

              <div>
                <strong>
                  ${escapeHtml(
                    item.label ||
                    item.name ||
                    item.ticker
                  )}
                </strong>

                <span>
                  ${escapeHtml(
                    item.ticker ||
                    ''
                  )}
                </span>
              </div>

              <div>
                ${num(
                  item.quantity ||
                  item.qty
                ).toLocaleString(
                  'ko-KR'
                )}
              </div>

              <div>
                ${fmtPrice(
                  item.currentPrice ||
                  item.price,
                  item.currency ||
                  'KRW'
                )}
              </div>

            </div>
          `)
          .join('');
    }
  }

  if (accountNotice) {
    accountNotice.textContent =
      '실전 계좌 연결됨';
  }
}


async function loadAccount() {
  const endpoints = [
    '/api/account',
    '/api/account/summary'
  ];

  for (
    const endpoint of endpoints
  ) {
    try {
      const response =
        await fetch(
          endpoint,
          {
            cache:
              'no-store'
          }
        );

      if (!response.ok) {
        continue;
      }

      const data =
        await response.json();

      renderAccount(
        data
      );

      return;

    } catch {
      continue;
    }
  }

  if (accountNotice) {
    accountNotice.textContent =
      '계좌 정보를 불러올 수 없습니다.';
  }
}


/* ============================================================
 * EVENTS
 * ============================================================ */

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
      await Promise.allSettled([
        loadMarketOverview(),
        loadScan(),
        loadMarketNews(),
        loadAccount()
      ]);
    }
  );
}


/* ============================================================
 * AUTH
 * ============================================================ */

const authGate =
  document.getElementById(
    'authGate'
  );

const authForm =
  document.getElementById(
    'authForm'
  );

const authPassword =
  document.getElementById(
    'authPassword'
  );

const authSubmit =
  document.getElementById(
    'authSubmit'
  );

const authError =
  document.getElementById(
    'authError'
  );


async function checkAuthAndStart() {
  try {
    const response =
      await fetch(
        '/api/auth/status',
        {
          cache:
            'no-store'
        }
      );

    const status =
      await response.json();

    if (
      !status.authRequired ||
      status.authed
    ) {
      startApp();

      return;
    }

    if (authGate) {
      authGate.hidden =
        false;
    }

    authPassword?.focus();

  } catch {
    /*
     * 로컬 개발 환경에서
     * auth API가 없는 경우에도
     * UI는 정상적으로 시작한다.
     */
    startApp();
  }
}


authForm?.addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    if (authSubmit) {
      authSubmit.disabled =
        true;
    }

    if (authError) {
      authError.hidden =
        true;
    }

    try {
      const response =
        await fetch(
          '/api/auth/login',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                password:
                  authPassword?.value ||
                  ''
              })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
          '로그인에 실패했습니다.'
        );
      }

      if (authGate) {
        authGate.hidden =
          true;
      }

      startApp();

    } catch (error) {
      if (authError) {
        authError.textContent =
          error.message ||
          '네트워크 오류가 발생했습니다.';

        authError.hidden =
          false;
      }

    } finally {
      if (authSubmit) {
        authSubmit.disabled =
          false;
      }
    }
  }
);


/* ============================================================
 * APP START
 * ============================================================ */

function startApp() {
  if (appStarted) {
    return;
  }

  appStarted = true;

  const logoutBtn =
    document.getElementById(
      'logoutBtn'
    );

  logoutBtn?.addEventListener(
    'click',
    async () => {
      try {
        await fetch(
          '/api/auth/logout',
          {
            method: 'POST'
          }
        );
      } catch {
        // ignore
      }

      appStarted = false;

      if (authGate) {
        authGate.hidden =
          false;
      }

      if (authPassword) {
        authPassword.value =
          '';

        authPassword.focus();
      }
    }
  );

  /*
   * 하나가 실패해도
   * 나머지 시장 데이터는 계속 로딩한다.
   */
  Promise.allSettled([
    loadMarketOverview(),
    loadScan(),
    loadMarketNews(),
    loadAccount()
  ]).catch(error => {
    console.error(
      '[app start]',
      error
    );
  });
}


/* ============================================================
 * INITIAL LOAD
 * ============================================================ */

window.addEventListener(
  'DOMContentLoaded',
  () => {
    checkAuthAndStart();
  }
);
