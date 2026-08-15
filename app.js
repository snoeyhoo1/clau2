// app.js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('서비스워커 등록 실패:', err);
    });
  });
}

const buyBoard = document.getElementById('buyBoard');
const sellBoard = document.getElementById('sellBoard');
const marketOverview = document.getElementById('marketOverview');
const breadthBar = document.getElementById('breadthBar');
const tape = document.getElementById('tape');
const updatedAt = document.getElementById('updated');
const refreshBtn = document.getElementById('refreshBtn');

function fmtChange(pct) {
  if (pct === null || pct === undefined) return '';
  const num = parseFloat(pct);
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num}%`;
}

function scoreColor(score) {
  if (score >= 40) return 'buy';
  if (score <= -40) return 'sell';
  return 'hold';
}

function renderUpProb(up) {
  if (!up || !up.byHorizon) return '';

  const horizons = Object.keys(up.byHorizon)
    .map(Number)
    .sort((a, b) => a - b);

  const rows = horizons.map((h) => {
    const d = up.byHorizon[h];

    if (!d || d.probability === null) {
      return `
        <div class="prob-row">
          <span class="prob-horizon">${h}일</span>
          <span class="prob-note">데이터 부족</span>
        </div>`;
    }

    const retClass =
      parseFloat(d.avgReturnPct) >= 0 ? 'change-up' : 'change-down';

    return `
      <div class="prob-row">
        <span class="prob-horizon">${h}거래일 후</span>
        <span class="prob-value">${d.probability}%</span>
        <span class="prob-return ${retClass}">평균 ${d.avgReturnPct}%</span>
        <span class="prob-conf">${d.confidence}${d.widened ? ' · 완화적용' : ''}</span>
      </div>`;
  }).join('');

  return `
    <div class="up-prob">
      <div class="up-prob-title">상승 확률(참고용, 과거 유사신호 기준)</div>
      ${rows}
    </div>`;
}

function renderHeadlines(headlines) {
  if (!headlines || headlines.length === 0) return '';

  const items = headlines.map((h) => {
    const isIrrelevant = h.relevant === false;

    const sentClass =
      h.sentiment === 'positive'
        ? 'change-up'
        : h.sentiment === 'negative'
          ? 'change-down'
          : '';

    const sentTag =
      h.sentiment && h.sentiment !== 'neutral'
        ? `<span class="${sentClass}">[${
            h.sentiment === 'positive' ? '긍정' : '부정'
          }]</span> `
        : '';

    const sourceTag = h.source
      ? `<span class="headline-source">${h.source}</span>`
      : '';

    return `
      <li class="${isIrrelevant ? 'headline-irrelevant' : ''}">
        ${sentTag}${h.title} ${sourceTag}
      </li>`;
  }).join('');

  return `<ul class="headlines">${items}</ul>`;
}

function renderCard(item) {
  if (item.error) {
    return `
      <div class="card">
        <div class="card-head">
          <span class="card-label">${item.label}</span>
          <span class="card-ticker">${item.ticker}</span>
        </div>
        <div class="card-error">데이터 조회 실패: ${item.error}</div>
      </div>`;
  }

  const changeClass =
    parseFloat(item.changePct) >= 0 ? 'change-up' : 'change-down';

  const barPos = Math.max(
    -50,
    Math.min(50, item.combinedScore / 2)
  );

  const barColor = scoreColor(item.combinedScore);

  const newsSourceTag =
    item.news.source === 'claude'
      ? ' (Claude 분석)'
      : ' (키워드 분석)';

  return `
    <div class="card">
      <div class="card-head">
        <span class="card-label">${item.label}</span>
        <span class="card-ticker">${item.ticker}</span>
      </div>

      <div class="card-price">
        ${item.currentPrice?.toLocaleString() ?? '—'}
        <span style="font-size:12px;color:var(--ink-dim)">
          ${item.currency ?? ''}
        </span>
      </div>

      <div class="card-change ${changeClass}">
        ${fmtChange(item.changePct)}
      </div>

      <div class="signal-badge signal-${item.signalColor}">
        ${item.classification} ·
        ${item.combinedScore > 0 ? '+' : ''}${item.combinedScore}
      </div>

      <div class="score-bar-wrap">
        <div
          class="score-bar"
          style="
            width:${Math.abs(barPos)}%;
            ${barPos < 0 ? 'right:50%' : 'left:50%'};
            background:var(--${barColor});
          "
        ></div>
      </div>

      ${renderUpProb(item.upProbability)}

      <div class="breakdown">
        <div>
          <b>기술적 점수</b>
          ${item.technical.score} —
          ${item.technical.detail?.ma ?? ''}
          ${
            item.technical.detail?.rsiSignal
              ? '· RSI ' +
                item.technical.detail.rsi +
                '(' +
                item.technical.detail.rsiSignal +
                ')'
              : ''
          }
        </div>

        <div style="margin-top:4px;">
          <b>뉴스 감성${newsSourceTag}</b>
          ${item.news.score} — ${item.news.detail}
        </div>

        ${renderHeadlines(item.news.headlines)}
      </div>
    </div>`;
}

function renderTape(items) {
  const valid = items.filter((i) => !i.error);

  if (valid.length === 0) {
    tape.innerHTML =
      '<span class="tape-loading">표시할 데이터가 없습니다</span>';
    return;
  }

  const doubled = [...valid, ...valid];

  const inner = doubled.map((i) => {
    const color =
      i.combinedScore >= 40
        ? 'var(--buy)'
        : i.combinedScore <= -40
          ? 'var(--sell)'
          : 'var(--ink-dim)';

    return `
      <span class="tape-item">
        ${i.label}
        <span style="color:${color}">
          ${i.combinedScore > 0 ? '+' : ''}${i.combinedScore}
        </span>
      </span>`;
  }).join('');

  tape.innerHTML = `<div class="tape-inner">${inner}</div>`;
}

function renderBreadth(breadth) {
  if (!breadth || breadth.total === 0) {
    breadthBar.innerHTML = '';
    return;
  }

  const buyW = (breadth.buyCount / breadth.total) * 100;
  const holdW = (breadth.holdCount / breadth.total) * 100;
  const sellW = (breadth.sellCount / breadth.total) * 100;

  breadthBar.innerHTML = `
    <span style="color:var(--ink-dim)">시장 breadth</span>

    <div class="breadth-track">
      <div
        class="breadth-buy"
        style="width:${buyW}%"
      ></div>

      <div
        class="breadth-hold"
        style="width:${holdW}%"
      ></div>

      <div
        class="breadth-sell"
        style="width:${sellW}%"
      ></div>
    </div>

    <span style="color:var(--buy)">
      매수 ${breadth.buyCount}
    </span>

    <span style="color:var(--hold)">
      중립 ${breadth.holdCount}
    </span>

    <span style="color:var(--sell)">
      매도 ${breadth.sellCount}
    </span>

    <span style="color:var(--ink-dim)">
      (전체 ${breadth.total}종목 중)
    </span>
  `;
}

function renderMarketOverview(indices) {
  marketOverview.innerHTML = indices
    .map((idx) => {
      if (idx.error) {
        return `
          <div class="mo-card">
            <div class="mo-label">${idx.label}</div>
            <div
              class="card-error"
              style="font-size:11px;"
            >
              조회 실패
            </div>
          </div>`;
      }

      const cls =
        parseFloat(idx.changePct) >= 0
          ? 'change-up'
          : 'change-down';

      return `
        <div class="mo-card">
          <div class="mo-label">${idx.label}</div>

          <div class="mo-price">
            ${idx.currentPrice?.toLocaleString() ?? '—'}
          </div>

          <div class="mo-change ${cls}">
            ${fmtChange(idx.changePct)}
          </div>
        </div>`;
    })
    .join('');
}

async function loadMarketOverview() {
  try {
    const res = await fetch('/api/market-overview');
    const data = await res.json();

    if (data.indices) {
      renderMarketOverview(data.indices);
    }
  } catch (err) {
    marketOverview.innerHTML = `
      <div class="mo-loading">
        시장 현황 불러오기 실패
      </div>`;
  }
}

let isLoading = false;

async function loadScan() {
  if (isLoading) return;

  isLoading = true;

  buyBoard.innerHTML = `
    <div style="padding:32px;color:var(--ink-dim)">
      스캔 중…
    </div>`;

  sellBoard.innerHTML = '';

  try {
    const res = await fetch('/api/scan');
    const data = await res.json();

    if (data.error) {
      throw new Error(data.error);
    }

    const ranked = data.ranked || [];

    const buyCandidates = ranked
      .filter((s) => s.combinedScore >= 40)
      .slice(0, 10);

    const sellCandidates = [...ranked]
      .reverse()
      .filter((s) => s.combinedScore <= -20)
      .slice(0, 10);

    buyBoard.innerHTML = buyCandidates.length
      ? buyCandidates.map(renderCard).join('')
      : `
        <div style="padding:24px;color:var(--ink-dim)">
          현재 매수 우세 종목 없음
        </div>`;

    sellBoard.innerHTML = sellCandidates.length
      ? sellCandidates.map(renderCard).join('')
      : `
        <div style="padding:24px;color:var(--ink-dim)">
          현재 매도 우세 종목 없음
        </div>`;

    renderTape(ranked);
    renderBreadth(data.breadth);

    updatedAt.textContent =
      `업데이트 ${new Date(data.generatedAt).toLocaleTimeString('ko-KR')}`;
  } catch (err) {
    buyBoard.innerHTML = `
      <div style="padding:32px;color:var(--sell)">
        불러오기 실패: ${err.message}
      </div>`;
  } finally {
    isLoading = false;
  }
}

// --- 가격 차트 (검색 상세화면용) ---
function priceChart(
  dates,
  closes,
  width = 680,
  height = 160
) {
  if (!closes || closes.length < 2) {
    return `
      <div style="color:var(--ink-dim);font-size:12px;">
        차트 데이터 없음
      </div>`;
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  const padTop = 10;
  const padBottom = 20;
  const usableH = height - padTop - padBottom;
  const step = width / (closes.length - 1);

  const points = closes
    .map((v, i) => {
      const x = i * step;
      const y =
        padTop +
        (usableH - ((v - min) / range) * usableH);

      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPoints =
    `0,${height - padBottom} ${points} ` +
    `${width},${height - padBottom}`;

  const color =
    closes[closes.length - 1] >= closes[0]
      ? 'var(--buy)'
      : 'var(--sell)';

  const firstDate = dates?.[0] || '';
  const lastDate = dates?.[dates.length - 1] || '';

  return `
    <svg
      width="100%"
      height="${height}"
      viewBox="0 0 ${width} ${height}"
      preserveAspectRatio="none"
    >
      <polygon
        points="${areaPoints}"
        fill="${color}"
        opacity="0.08"
      />

      <polyline
        points="${points}"
        fill="none"
        stroke="${color}"
        stroke-width="2"
      />
    </svg>

    <div class="chart-axis">
      <span>${firstDate}</span>

      <span style="color:var(--ink-dim)">
        최고 ${max.toLocaleString()} ·
        최저 ${min.toLocaleString()}
      </span>

      <span>${lastDate}</span>
    </div>`;
}

function sparkline(
  equityCurve,
  width = 680,
  height = 100
) {
  if (!equityCurve || equityCurve.length < 2) {
    return `
      <div style="color:var(--ink-dim);font-size:12px;">
        데이터 없음
      </div>`;
  }

  const min = Math.min(...equityCurve);
  const max = Math.max(...equityCurve);
  const range = max - min || 1;
  const step = width / (equityCurve.length - 1);

  const points = equityCurve
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${
          (height - ((v - min) / range) * height).toFixed(1)
        }`
    )
    .join(' ');

  const color =
    equityCurve[equityCurve.length - 1] >= equityCurve[0]
      ? 'var(--buy)'
      : 'var(--sell)';

  return `
    <svg
      width="100%"
      height="${height}"
      viewBox="0 0 ${width} ${height}"
      preserveAspectRatio="none"
    >
      <polyline
        points="${points}"
        fill="none"
        stroke="${color}"
        stroke-width="2"
      />
    </svg>`;
}

function renderBacktestBlock(bt, btError) {
  if (btError) {
    return `
      <div class="detail-block">
        <h3>자동 백테스트</h3>

        <div class="card-error">
          백테스트 실패: ${btError}
        </div>
      </div>`;
  }

  if (!bt) return '';

  const stratClass =
    parseFloat(bt.strategyReturnPct) >= 0
      ? 'change-up'
      : 'change-down';

  const bhClass =
    parseFloat(bt.buyHoldReturnPct) >= 0
      ? 'change-up'
      : 'change-down';

  return `
    <div class="detail-block">
      <h3>
        자동 백테스트 (최근 2년, 기술적 신호 기준)
      </h3>

      <div class="bt-metrics">
        <div class="bt-metric">
          <div class="bt-metric-label">전략 수익률</div>
          <div class="bt-metric-value ${stratClass}">
            ${bt.strategyReturnPct}%
          </div>
        </div>

        <div class="bt-metric">
          <div class="bt-metric-label">Buy&Hold 수익률</div>
          <div class="bt-metric-value ${bhClass}">
            ${bt.buyHoldReturnPct}%
          </div>
        </div>

        <div class="bt-metric">
          <div class="bt-metric-label">거래 횟수</div>
          <div class="bt-metric-value">
            ${bt.numTrades}
          </div>
        </div>

        <div class="bt-metric">
          <div class="bt-metric-label">승률</div>
          <div class="bt-metric-value">
            ${bt.winRatePct}%
          </div>
        </div>

        <div class="bt-metric">
          <div class="bt-metric-label">최대 낙폭(MDD)</div>
          <div class="bt-metric-value change-down">
            -${bt.maxDrawdownPct}%
          </div>
        </div>
      </div>

      <div class="bt-curve">
        ${sparkline(bt.equityCurve)}
      </div>

      <div class="bt-limitation">
        ⚠ ${bt.limitation}
      </div>
    </div>`;
}

function renderTradeButtons(signal) {
  const krMatch =
    signal.ticker.match(/^(\d{6})\.(KS|KQ)$/i);

  // 접미사 없는 순수 알파벳 티커면 미국 주식으로 간주
  // 예: AAPL, TSLA
  const isUsTicker =
    /^[A-Z.]{1,6}$/.test(signal.ticker) &&
    !krMatch;

  if (krMatch) {
    const code = krMatch[1];

    return `
      <div class="trade-buttons">
        <button
          class="btn-trade btn-buy"
          data-market="domestic"
          data-code="${code}"
          data-name="${signal.label}"
          data-price="${signal.currentPrice}"
          data-side="buy"
        >
          매수
        </button>

        <button
          class="btn-trade btn-sell"
          data-market="domestic"
          data-code="${code}"
          data-name="${signal.label}"
          data-price="${signal.currentPrice}"
          data-side="sell"
        >
          매도
        </button>
      </div>`;
  }

  if (isUsTicker) {
    return `
      <div class="trade-buttons">
        <button
          class="btn-trade btn-buy"
          data-market="overseas"
          data-code="${signal.ticker}"
          data-name="${signal.label}"
          data-price="${signal.currentPrice}"
          data-side="buy"
        >
          매수 (미국)
        </button>

        <button
          class="btn-trade btn-sell"
          data-market="overseas"
          data-code="${signal.ticker}"
          data-name="${signal.label}"
          data-price="${signal.currentPrice}"
          data-side="sell"
        >
          매도 (미국)
        </button>
      </div>`;
  }

  return '';
}

function renderDetailPanel(
  signal,
  chart,
  bt,
  btError
) {
  if (signal.error) {
    return `
      <div class="detail-panel">
        <div class="card-error">
          "${signal.ticker}" 조회 실패: ${signal.error}
        </div>
      </div>`;
  }

  const changeClass =
    parseFloat(signal.changePct) >= 0
      ? 'change-up'
      : 'change-down';

  const barPos = Math.max(
    -50,
    Math.min(50, signal.combinedScore / 2)
  );

  const barColor =
    scoreColor(signal.combinedScore);

  const newsSourceTag =
    signal.news.source === 'claude'
      ? ' (Claude 분석)'
      : ' (키워드 분석)';

  return `
    <div class="detail-panel">
      <div class="detail-header">
        <div>
          <span
            class="card-label"
            style="font-size:20px;"
          >
            ${signal.label}
          </span>

          <span class="card-ticker">
            ${signal.ticker}
          </span>
        </div>

        <div style="text-align:right;">
          <div
            class="card-price"
            style="font-size:24px;"
          >
            ${signal.currentPrice?.toLocaleString() ?? '—'}
            <span
              style="font-size:12px;color:var(--ink-dim)"
            >
              ${signal.currency ?? ''}
            </span>
          </div>

          <div class="card-change ${changeClass}">
            ${fmtChange(signal.changePct)}
          </div>
        </div>
      </div>

      ${renderTradeButtons(signal)}

      <div class="detail-block">
        <h3>가격 차트 (최근 6개월)</h3>

        ${
          chart
            ? priceChart(chart.dates, chart.closes)
            : `
              <div
                style="color:var(--ink-dim);font-size:12px;"
              >
                차트 불러오기 실패
              </div>`
        }
      </div>

      <div class="detail-block">
        <div
          class="signal-badge signal-${signal.signalColor}"
        >
          ${signal.classification} ·
          ${signal.combinedScore > 0 ? '+' : ''}
          ${signal.combinedScore}
        </div>

        <div class="score-bar-wrap">
          <div
            class="score-bar"
            style="
              width:${Math.abs(barPos)}%;
              ${
                barPos < 0
                  ? 'right:50%'
                  : 'left:50%'
              };
              background:var(--${barColor});
            "
          ></div>
        </div>

        ${renderUpProb(signal.upProbability)}

        <div class="breakdown">
          <div>
            <b>기술적 점수</b>
            ${signal.technical.score} —
            ${signal.technical.detail?.ma ?? ''}
            ${
              signal.technical.detail?.rsiSignal
                ? '· RSI ' +
                  signal.technical.detail.rsi +
                  '(' +
                  signal.technical.detail.rsiSignal +
                  ')'
                : ''
            }
          </div>

          <div style="margin-top:4px;">
            <b>뉴스 감성${newsSourceTag}</b>
            ${signal.news.score} —
            ${signal.news.detail}
          </div>

          ${renderHeadlines(signal.news.headlines)}
        </div>
      </div>

      ${renderBacktestBlock(bt, btError)}
    </div>`;
}

// --- 종목 직접 검색 ---
const searchInput =
  document.getElementById('searchInput');

const searchBtn =
  document.getElementById('searchBtn');

const searchResult =
  document.getElementById('searchResult');

async function searchTicker(ticker) {
  searchResult.innerHTML = `
    <div class="detail-panel">
      <div style="color:var(--ink-dim)">
        "${ticker}" 조회 중…
        (차트·신호·백테스트 동시 진행)
      </div>
    </div>`;

  const [
    signalRes,
    chartRes,
    btRes
  ] = await Promise.allSettled([
    fetch(
      `/api/signal/${encodeURIComponent(ticker)}?label=${encodeURIComponent(ticker)}`
    ).then((r) => r.json()),

    fetch(
      `/api/chart/${encodeURIComponent(ticker)}?range=6mo`
    ).then((r) => r.json()),

    fetch(
      `/api/backtest/${encodeURIComponent(ticker)}?range=2y`
    ).then((r) => r.json()),
  ]);

  const signal =
    signalRes.status === 'fulfilled'
      ? signalRes.value
      : {
          error:
            signalRes.reason?.message ||
            '조회 실패',
          ticker,
        };

  const chart =
    chartRes.status === 'fulfilled' &&
    !chartRes.value.error
      ? chartRes.value
      : null;

  const bt =
    btRes.status === 'fulfilled' &&
    !btRes.value.error
      ? btRes.value
      : null;

  const btError =
    btRes.status === 'fulfilled'
      ? btRes.value.error
      : btRes.reason?.message || null;

  searchResult.innerHTML =
    renderDetailPanel(
      signal,
      chart,
      bt,
      bt ? null : btError
    );
}

searchBtn.addEventListener(
  'click',
  () => {
    const val = searchInput.value.trim();

    if (val) {
      searchTicker(val);
    }
  }
);

searchInput.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();

      if (val) {
        searchTicker(val);
      }
    }
  }
);

refreshBtn.addEventListener(
  'click',
  () => {
    loadScan();
    loadMarketOverview();
    loadAccount();
  }
);

loadScan();
loadMarketOverview();

// 1분마다 자동 갱신.
// 탭이 안 보이면 백그라운드에서 멈춰 불필요한 API 호출을 줄임.
let refreshTimer = setInterval(
  () => {
    loadScan();
    loadMarketOverview();
    loadAccount();
  },
  60 * 1000
);

document.addEventListener(
  'visibilitychange',
  () => {
    if (document.hidden) {
      clearInterval(refreshTimer);
    } else {
      loadScan();
      loadMarketOverview();
      loadAccount();

      refreshTimer = setInterval(
        () => {
          loadScan();
          loadMarketOverview();
          loadAccount();
        },
        60 * 1000
      );
    }
  }
);

// --- 홈 화면 설치 ---
const installBtn =
  document.getElementById('installBtn');

let deferredPrompt = null;

window.addEventListener(
  'beforeinstallprompt',
  (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  }
);

installBtn.addEventListener(
  'click',
  async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn.hidden = true;
    } else if (
      /iPad|iPhone|iPod/.test(
        navigator.userAgent
      )
    ) {
      alert(
        'iOS에서는: 공유 버튼(□↑) → "홈 화면에 추가"를 눌러주세요.'
      );
    }
  }
);

if (
  /iPad|iPhone|iPod/.test(
    navigator.userAgent
  ) &&
  !window.navigator.standalone
) {
  installBtn.hidden = false;
}

// --- 푸시 알림 구독 ---
const notifyBtn =
  document.getElementById('notifyBtn');

function urlBase64ToUint8Array(
  base64String
) {
  const padding =
    '='.repeat(
      (4 - (base64String.length % 4)) % 4
    );

  const base64 =
    (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

  const rawData = atob(base64);

  return Uint8Array.from(
    [...rawData].map(
      (c) => c.charCodeAt(0)
    )
  );
}

async function updateNotifyBtnState() {
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    notifyBtn.hidden = true;
    return;
  }

  const reg =
    await navigator.serviceWorker.ready;

  const sub =
    await reg.pushManager.getSubscription();

  notifyBtn.textContent =
    sub ? '알림 끄기' : '알림 켜기';
}

async function enablePush() {
  try {
    const permission =
      await Notification.requestPermission();

    if (permission !== 'granted') {
      alert(
        '알림 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요.'
      );
      return;
    }

    const keyRes =
      await fetch(
        '/api/push/vapid-public-key'
      );

    const keyData =
      await keyRes.json();

    if (!keyData.publicKey) {
      alert(
        '서버에 푸시 알림이 아직 설정되지 않았습니다 (VAPID 키 필요).'
      );
      return;
    }

    const reg =
      await navigator.serviceWorker.ready;

    const sub =
      await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey:
          urlBase64ToUint8Array(
            keyData.publicKey
          ),
      });

    await fetch(
      '/api/push/subscribe',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify(sub),
      }
    );

    await updateNotifyBtnState();
  } catch (err) {
    alert(
      '알림 설정 실패: ' +
      err.message
    );
  }
}

async function disablePush() {
  const reg =
    await navigator.serviceWorker.ready;

  const sub =
    await reg.pushManager.getSubscription();

  if (sub) {
    await fetch(
      '/api/push/unsubscribe',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify({
          endpoint: sub.endpoint,
        }),
      }
    );

    await sub.unsubscribe();
  }

  await updateNotifyBtnState();
}

notifyBtn.addEventListener(
  'click',
  async () => {
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      alert(
        '이 브라우저는 푸시 알림을 지원하지 않습니다.'
      );
      return;
    }

    const reg =
      await navigator.serviceWorker.ready;

    const sub =
      await reg.pushManager.getSubscription();

    if (sub) {
      await disablePush();
    } else {
      await enablePush();
    }
  }
);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready
    .then(updateNotifyBtnState)
    .catch(() => {});
}

// --- 내 계좌 (한국투자증권 실전계좌 연동) ---
const accountContent =
  document.getElementById(
    'accountContent'
  );

const accountEnvBadge =
  document.getElementById(
    'accountEnvBadge'
  );

function renderHoldingsList(
  holdings,
  currencyLabel
) {
  if (
    !holdings ||
    holdings.length === 0
  ) {
    return `
      <div
        style="
          color:var(--ink-dim);
          font-size:12px;
          padding:12px 0;
        "
      >
        보유 종목 없음
      </div>`;
  }

  return holdings
    .map((h) => {
      const cls =
        h.profitLossPct >= 0
          ? 'change-up'
          : 'change-down';

      return `
        <div class="holding-row">
          <div>
            <div class="holding-name">
              ${h.name}
            </div>

            <div class="holding-meta">
              ${h.quantity}주 ·
              평단
              ${h.avgPrice.toLocaleString()}
              ${currencyLabel}
            </div>
          </div>

          <div style="text-align:right;">
            <div>
              ${h.evalAmount.toLocaleString()}
              ${currencyLabel}
            </div>

            <div class="${cls}">
              ${
                h.profitLossPct >= 0
                  ? '+'
                  : ''
              }${h.profitLossPct}%
            </div>
          </div>
        </div>`;
    })
    .join('');
}

async function loadAccount() {
  try {
    const res =
      await fetch('/api/kis/balance');

    const data =
      await res.json();

    const {
      domestic,
      overseas
    } = data;

    if (
      domestic?.error &&
      overseas?.error
    ) {
      accountContent.innerHTML = `
        <div class="account-notice">
          실전계좌 연동 안 됨:
          ${domestic.error}
        </div>`;
      return;
    }

    // 이 앱은 실전투자 전용으로 표시한다.
    accountEnvBadge.textContent =
      '실전투자';

    accountEnvBadge.className =
      'env-badge env-real';

    let html = '';

    if (domestic?.error) {
      html += `
        <div class="account-notice">
          국내 계좌:
          ${domestic.error}
        </div>`;
    } else {
      html += `
        <div class="account-subheading">
          국내주식
        </div>

        <div class="account-summary">
          <div>
            <span class="account-label">
              예수금
            </span>

            <span>
              ${domestic.cash.toLocaleString()}원
            </span>
          </div>

          <div>
            <span class="account-label">
              주문가능현금
            </span>

            <span>
              ${domestic.orderableCash.toLocaleString()}원
            </span>
          </div>

          <div>
            <span class="account-label">
              총 평가금액
            </span>

            <span>
              ${domestic.totalEvalAmount.toLocaleString()}원
            </span>
          </div>

          <div>
            <span class="account-label">
              총 평가손익
            </span>

            <span
              class="${
                domestic.totalProfitLoss >= 0
                  ? 'change-up'
                  : 'change-down'
              }"
            >
              ${domestic.totalProfitLoss.toLocaleString()}원
            </span>
          </div>
        </div>

        <div class="holdings-list">
          ${renderHoldingsList(
            domestic.holdings,
            '원'
          )}
        </div>`;
    }

    if (overseas?.error) {
      html += `
        <div
          class="account-notice"
          style="margin-top:16px;"
        >
          해외 계좌:
          ${overseas.error}
        </div>`;
    } else {
      html += `
        <div
          class="account-subheading"
          style="margin-top:20px;"
        >
          해외주식 (${overseas.exchange})
        </div>

        <div class="account-summary">
          <div>
            <span class="account-label">
              총 평가손익
            </span>

            <span
              class="${
                overseas.totalEvalAmountUsd >= 0
                  ? 'change-up'
                  : 'change-down'
              }"
            >
              $${overseas.totalEvalAmountUsd.toLocaleString()}
            </span>
          </div>
        </div>

        <div class="holdings-list">
          ${renderHoldingsList(
            overseas.holdings,
            '달러'
          )}
        </div>`;
    }

    accountContent.innerHTML = html;
  } catch (err) {
    accountContent.innerHTML = `
      <div class="account-notice">
        실전계좌 정보를 불러오지 못했습니다:
        ${err.message}
      </div>`;
  }
}

loadAccount();

// --- 주문 확인 모달 ---
// 2단계:
// 버튼 클릭
// -> 확인창
// -> 사용자가 직접 확인
// -> 실전계좌로 주문 실행

const orderModalOverlay =
  document.getElementById(
    'orderModalOverlay'
  );

const orderModalTitle =
  document.getElementById(
    'orderModalTitle'
  );

const orderModalBody =
  document.getElementById(
    'orderModalBody'
  );

const orderModalResult =
  document.getElementById(
    'orderModalResult'
  );

const orderConfirmBtn =
  document.getElementById(
    'orderConfirmBtn'
  );

const orderCancelBtn =
  document.getElementById(
    'orderCancelBtn'
  );

let pendingOrder = null;

function openOrderModal({
  market,
  code,
  name,
  price,
  side
}) {
  pendingOrder = {
    market,
    code,
    name,
    price: Number(price),
    side,
  };

  orderModalTitle.textContent =
    side === 'buy'
      ? `${name} 매수 주문`
      : `${name} 매도 주문`;

  orderModalResult.innerHTML = '';

  if (market === 'overseas') {
    // 해외주식은 지정가만 지원
    orderModalBody.innerHTML = `
      <div class="order-field">
        <label>
          종목코드 (거래소: NASD)
        </label>

        <div>
          ${code}
        </div>
      </div>

      <div class="order-field">
        <label>
          주문 수량
        </label>

        <input
          type="number"
          id="orderQty"
          value="1"
          min="1"
          step="1"
        />
      </div>

      <div class="order-field">
        <label>
          지정가 (USD) —
          해외주식은 지정가만 지원
        </label>

        <input
          type="number"
          id="orderLimitPrice"
          value="${Number(price).toFixed(2)}"
          step="0.01"
        />
      </div>

      <p class="order-warning">
        ⚠ 확인 버튼을 누르면
        한국투자증권 실전 해외계좌로
        실제 주문이 즉시 전송됩니다.
      </p>
    `;
  } else {
    orderModalBody.innerHTML = `
      <div class="order-field">
        <label>
          종목코드
        </label>

        <div>
          ${code}
        </div>
      </div>

      <div class="order-field">
        <label>
          주문 수량
        </label>

        <input
          type="number"
          id="orderQty"
          value="1"
          min="1"
          step="1"
        />
      </div>

      <div class="order-field">
        <label>
          주문 유형
        </label>

        <select id="orderType">
          <option value="market">
            시장가
          </option>

          <option value="limit">
            지정가
          </option>
        </select>
      </div>

      <div
        class="order-field"
        id="limitPriceField"
        hidden
      >
        <label>
          지정가 (원)
        </label>

        <input
          type="number"
          id="orderLimitPrice"
          value="${Math.round(price)}"
          step="1"
        />
      </div>

      <p class="order-warning">
        ⚠ 확인 버튼을 누르면
        한국투자증권 실전계좌로
        실제 주문이 즉시 전송됩니다.
      </p>
    `;

    document
      .getElementById('orderType')
      .addEventListener(
        'change',
        (e) => {
          document.getElementById(
            'limitPriceField'
          ).hidden =
            e.target.value !== 'limit';
        }
      );
  }

  orderModalOverlay.hidden = false;
}

function closeOrderModal() {
  orderModalOverlay.hidden = true;
  pendingOrder = null;
}

orderCancelBtn.addEventListener(
  'click',
  closeOrderModal
);

orderModalOverlay.addEventListener(
  'click',
  (e) => {
    if (
      e.target === orderModalOverlay
    ) {
      closeOrderModal();
    }
  }
);

orderConfirmBtn.addEventListener(
  'click',
  async () => {
    if (!pendingOrder) return;

    const qty =
      Number(
        document.getElementById(
          'orderQty'
        ).value
      );

    const isOverseas =
      pendingOrder.market ===
      'overseas';

    const orderType = isOverseas
      ? 'limit'
      : document.getElementById(
          'orderType'
        ).value;

    const limitPrice =
      document.getElementById(
        'orderLimitPrice'
      )?.value;

    if (!Number.isInteger(qty) || qty <= 0) {
      orderModalResult.innerHTML = `
        <div class="card-error">
          주문 수량을 올바르게 입력해주세요.
        </div>`;
      return;
    }

    if (
      orderType === 'limit' &&
      (!limitPrice ||
        Number(limitPrice) <= 0)
    ) {
      orderModalResult.innerHTML = `
        <div class="card-error">
          지정가를 올바르게 입력해주세요.
        </div>`;
      return;
    }

    orderConfirmBtn.disabled = true;

    orderModalResult.innerHTML = `
      <div style="color:var(--ink-dim);">
        실전 주문 전송 중…
      </div>`;

    try {
      const res =
        await fetch(
          '/api/kis/order',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              market:
                pendingOrder.market,

              code:
                pendingOrder.code,

              quantity: qty,

              price:
                orderType === 'limit'
                  ? Number(limitPrice)
                  : undefined,

              side:
                pendingOrder.side,

              orderType,

              exchange:
                'NASD',

              // 서버에서도 실전 주문만 허용하도록
              // 확인 플래그 전달
              confirm: true,
            }),
          }
        );

      const data =
        await res.json();

      if (data.error) {
        throw new Error(
          data.error
        );
      }

      orderModalResult.innerHTML = `
        <div class="order-success">
          ✓ ${data.message || '실전 주문 완료'}
          ${
            data.orderNo
              ? `(주문번호 ${data.orderNo})`
              : ''
          }
        </div>`;

      setTimeout(
        () => {
          closeOrderModal();
          loadAccount();
        },
        2000
      );
    } catch (err) {
      orderModalResult.innerHTML = `
        <div class="card-error">
          실전 주문 실패:
          ${err.message}
        </div>`;
    } finally {
      orderConfirmBtn.disabled = false;
    }
  }
);

// 매수/매도 버튼 클릭 감지
// 검색 결과 영역에 이벤트 위임
searchResult.addEventListener(
  'click',
  (e) => {
    const btn =
      e.target.closest(
        '.btn-trade'
      );

    if (!btn) return;

    openOrderModal({
      market:
        btn.dataset.market,

      code:
        btn.dataset.code,

      name:
        btn.dataset.name,

      price:
        btn.dataset.price,

      side:
        btn.dataset.side,
    });
  }
);
