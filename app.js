// app.js
//
// Multi-Agent AI Signal Desk UI
//
// 기존 시장 현황 / breadth / 뉴스 / 상승확률 UI를 유지하면서
// 새 AI Strategy 결과를 종목 카드에 통합한다.

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

let loading =
  false;

/*
 * ============================================================
 * Utilities
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
    currency ===
      'KRW' ||
    currency ===
      '원'
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
    item.aiStrategy
      ?.signal === 1
  ) {
    return 'buy';
  }

  if (
    item.aiStrategy
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
    item.aiLabel
  ) {
    return item.aiLabel;
  }

  if (
    item.aiStrategy
      ?.decision
  ) {
    return item.aiStrategy
      .decision;
  }

  return (
    item.classification ||
    'AI 대기'
  );
}

/*
 * ============================================================
 * News
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
                : headline.title ||
                  headline.description ||
                  '';

            if (!title) {
              return '';
            }

            const sentiment =
              headline.sentiment;

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

/*
 * ============================================================
 * AI Agent Summary
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

        <span class="signal-badge signal-${signalClass(
          item
        )}">
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
 * Execution
 * ============================================================
 */

function renderExecution(
  item
) {
  const execution =
    item.aiStrategy
      ?.execution;

  if (
    !execution
  ) {
    return '';
  }

  const entry =
    execution.entry;

  const stop =
    execution.stop;

  const target1 =
    execution.target1;

  const target2 =
    execution.target2;

  const rr =
    execution.riskReward;

  if (
    entry === null &&
    stop === null &&
    target1 === null
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
            entry
          )}</b>
        </div>

        <div>
          <span>손절</span>
          <b>${escapeHtml(
            stop
          )}</b>
        </div>

        <div>
          <span>목표1</span>
          <b>${escapeHtml(
            target1
          )}</b>
        </div>

        <div>
          <span>목표2</span>
          <b>${escapeHtml(
            target2
          )}</b>
        </div>

        <div>
          <span>R/R</span>
          <b>${escapeHtml(
            rr
          )}</b>
        </div>

      </div>

    </div>
  `;
}

/*
 * ============================================================
 * Up Probability
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
 * Card
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
      Math.abs(
        score
      ) / 2
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

      <div class="card-change ${changeClass}">
        ${fmtChange(
          item.changePct
        )}
      </div>

      <div class="signal-badge signal-${barClass}">
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

          ${
            item.news
              ?.source ===
            'claude'
              ? ' · Claude'
              : ''
          }
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
 * Tape
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

  if (
    !valid.length
  ) {
    tape.innerHTML =
      '<span>데이터 없음</span>';

    return;
  }

  const items =
    [
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
 * Breadth
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
    breadthBar.innerHTML =
      '';

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

  const buyWidth =
    buy /
    total *
    100;

  const holdWidth =
    hold /
    total *
    100;

  const sellWidth =
    sell /
    total *
    100;

  breadthBar.innerHTML = `
    <span>
      시장 breadth
    </span>

    <div class="breadth-track">

      <div
        class="breadth-buy"
        style="width:${buyWidth}%"
      ></div>

      <div
        class="breadth-hold"
        style="width:${holdWidth}%"
      ></div>

      <div
        class="breadth-sell"
        style="width:${sellWidth}%"
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
 * Market Overview
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
        data.error ||
        '시장 현황 조회 실패'
      );
    }

    renderMarketOverview(
      data.indices
    );
  } catch (err) {
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
 * Scan
 * ============================================================
 */

async function loadScan() {
  if (loading) {
    return;
  }

  loading =
    true;

  if (
    buyBoard
  ) {
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

  if (
    sellBoard
  ) {
    sellBoard.innerHTML =
      '';
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
        data.error ||
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
            item.aiScore >= 50
        )
        .slice(
          0,
          10
        );

    const sellCandidates =
      ranked
        .filter(
          item =>
            item.aiStrategy
              ?.signal === -1 ||
            item.aiScore <= -40
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
        .slice(
          0,
          10
        );

    if (
      buyBoard
    ) {
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

    if (
      sellBoard
    ) {
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

    if (
      updatedAt
    ) {
      updatedAt.textContent =
        `업데이트 ${
          new Date(
            data.generatedAt ||
              Date.now()
          ).toLocaleTimeString(
            'ko-KR'
          )}`;
    }
  } catch (err) {
    if (
      buyBoard
    ) {
      buyBoard.innerHTML = `
        <div
          style="
            padding:32px;
            color:var(--sell)
          "
        >
          스캔 실패:
          ${escapeHtml(
            err.message
          )}
        </div>
      `;
    }
  } finally {
    loading =
      false;
  }
}

/*
 * ============================================================
 * Refresh
 * ============================================================
 */

if (
  refreshBtn
) {
  refreshBtn.addEventListener(
    'click',
    async () => {
      await Promise.all([
        loadMarketOverview(),
        loadScan(),
      ]);
    }
  );
}

/*
 * ============================================================
 * Initial Load
 * ============================================================
 */

window.addEventListener(
  'DOMContentLoaded',
  async () => {
    await Promise.all([
      loadMarketOverview(),
      loadScan(),
    ]);
  }
);
