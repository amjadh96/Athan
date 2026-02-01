const CACHE_NAME = 'prayer-times-v2';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './prayer-data.js',
    './hijri.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './audio/athan-makkah.mp3',
    './audio/athan-madinah.mp3',
    './audio/athan-mishary.mp3',
    './audio/athan-abdul-basit.mp3'
];

// Install
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch
self.addEventListener('fetch', (event) => {
    // API requests - network first, cache fallback
    if (event.request.url.includes('api.aladhan.com')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const cloned = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, cloned);
                    });
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Static assets - cache first
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
            .catch(() => {
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            })
    );
});
