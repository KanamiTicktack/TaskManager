const CACHE_NAME = 'task-entry-cache-v2';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// インストール時に指定リソースをキャッシュへ保存
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(urlsToCache);
    }).then(() => {
      // 新しいサービスワーカーを即座に有効化
      return self.skipWaiting();
    })
  );
});

// アクティベート時に古いキャッシュを削除
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames.map(function (cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('Old cache deleted:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // 既存のクライアント（タブ）をすべて制御下におく
      return self.clients.claim();
    })
  );
});

// 通信発生時にキャッシュにデータがあればそれを返し、なければ通信する
self.addEventListener('fetch', function (event) {
  event.respondWith(
    caches.match(event.request).then(function (response) {
      return response || fetch(event.request);
    })
  );
});

