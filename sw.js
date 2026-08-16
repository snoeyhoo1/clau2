// sw.js
//
// SIGNAL DESK SERVICE WORKER
//
// 변경:
// - 캐시 버전을 v3으로 변경
// - 실제 /icon 경로 사용
// - index.html / app.js / style.css는 최신 네트워크 파일 우선
// - 네트워크 실패 시에만 캐시 fallback
// - API는 항상 network-first
// - 업데이트된 Service Worker가 즉시 활성화되도록 유지

const CACHE_NAME =
  'signal-desk-v3';

const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icon/icon-192.png',
  '/icon/icon-512.png',
];


/* ============================================================
 * INSTALL
 * ============================================================ */

self.addEventListener(
  'install',
  event => {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then(cache =>
          cache.addAll(
            APP_SHELL
          )
        )
    );

    self.skipWaiting();
  }
);


/* ============================================================
 * ACTIVATE
 * ============================================================ */

self.addEventListener(
  'activate',
  event => {
    event.waitUntil(
      caches
        .keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(
                key =>
                  key !==
                  CACHE_NAME
              )
              .map(
                key =>
                  caches.delete(
                    key
                  )
              )
          )
        )
        .then(() =>
          self.clients.claim()
        )
    );
  }
);


/* ============================================================
 * FETCH
 * ============================================================ */

self.addEventListener(
  'fetch',
  event => {
    const request =
      event.request;

    /*
     * GET이 아닌 요청은
     * Service Worker에서 건드리지 않는다.
     */
    if (
      request.method !==
      'GET'
    ) {
      return;
    }

    const url =
      new URL(
        request.url
      );


    /*
     * ========================================================
     * API
     * ========================================================
     *
     * 실시간 시장 데이터 / AI 신호 / 검색 / 차트 /
     * 백테스트 / 계좌 / 뉴스는 항상 최신 데이터가 필요하다.
     *
     * 따라서 API는 network-first.
     */

    if (
      url.pathname.startsWith(
        '/api/'
      )
    ) {
      event.respondWith(
        fetch(request).catch(
          () =>
            new Response(
              JSON.stringify({
                error:
                  '오프라인 상태입니다.',
              }),
              {
                status: 503,

                headers: {
                  'Content-Type':
                    'application/json; charset=utf-8',
                },
              }
            )
        )
      );

      return;
    }


    /*
     * ========================================================
     * APP SHELL
     * ========================================================
     *
     * HTML / JS / CSS는 최신 버전을 먼저 가져온다.
     *
     * network -> cache
     *
     * 이렇게 해야 GitHub/Vercel에 새 app.js나
     * style.css를 올렸을 때 이전 화면이 계속 남는 문제가
     * 발생하지 않는다.
     */

    const isAppShell =
      APP_SHELL.includes(
        url.pathname
      ) ||
      url.pathname ===
        '/';

    if (
      isAppShell
    ) {
      event.respondWith(
        fetch(request)
          .then(
            response => {
              /*
               * 정상 응답만 캐시에 저장한다.
               */
              if (
                response &&
                response.ok
              ) {
                const cloned =
                  response.clone();

                caches
                  .open(
                    CACHE_NAME
                  )
                  .then(
                    cache =>
                      cache.put(
                        request,
                        cloned
                      )
                  )
                  .catch(
                    () => {}
                  );
              }

              return response;
            }
          )
          .catch(
            () =>
              caches.match(
                request
              )
          )
      );

      return;
    }


    /*
     * ========================================================
     * OTHER STATIC FILES
     * ========================================================
     *
     * 이미지 / 아이콘 등은
     * cache-first로 처리해서 성능을 유지한다.
     */

    event.respondWith(
      caches
        .match(request)
        .then(
          cached => {
            if (cached) {
              return cached;
            }

            return fetch(
              request
            ).then(
              response => {
                if (
                  response &&
                  response.ok
                ) {
                  const cloned =
                    response.clone();

                  caches
                    .open(
                      CACHE_NAME
                    )
                    .then(
                      cache =>
                        cache.put(
                          request,
                          cloned
                        )
                    )
                    .catch(
                      () => {}
                    );
                }

                return response;
              }
            );
          }
        )
    );
  }
);


/* ============================================================
 * PUSH NOTIFICATION
 * ============================================================ */

self.addEventListener(
  'push',
  event => {
    let data = {
      title:
        'SIGNAL DESK',

      body:
        '새 신호가 있습니다',

      url:
        '/',
    };

    try {
      if (
        event.data
      ) {
        data = {
          ...data,
          ...event.data.json(),
        };
      }
    } catch {
      /*
       * JSON이 아니면 기본값 유지
       */
    }

    event.waitUntil(
      self.registration.showNotification(
        data.title,
        {
          body:
            data.body,

          icon:
            '/icon/icon-192.png',

          badge:
            '/icon/icon-192.png',

          data: {
            url:
              data.url ||
              '/',
          },
        }
      )
    );
  }
);


/* ============================================================
 * NOTIFICATION CLICK
 * ============================================================ */

self.addEventListener(
  'notificationclick',
  event => {
    event.notification.close();

    const targetUrl =
      event.notification
        .data?.url ||
      '/';

    event.waitUntil(
      self.clients
        .matchAll({
          type:
            'window',
          includeUncontrolled:
            true,
        })
        .then(
          clients => {
            for (
              const client of
                clients
            ) {
              if (
                client.url.includes(
                  self.location
                    .origin
                ) &&
                'focus' in
                  client
              ) {
                return client
                  .focus()
                  .then(() => {
                    if (
                      'navigate' in
                      client
                    ) {
                      return client.navigate(
                        targetUrl
                      );
                    }

                    return client;
                  });
              }
            }

            return self.clients.openWindow(
              targetUrl
            );
          }
        )
    );
  }
);
