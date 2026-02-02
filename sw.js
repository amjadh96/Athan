const CACHE_NAME = 'prayer-times-v6';
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
    './audio/athan-list.json',
    './audio/ناجي قزاز.mp3',
    './audio/أحمد جلال يحيى.mp3',
    './audio/أذان الأموي الجماعي.mp3',
    './audio/علي بن أحمد ملا.mp3',
    './audio/عبد الباسط.mp3',
    './audio/ناصر القطامي.mp3'
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

// Handle messages from the app (for notifications)
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_ATHAN_NOTIFICATION') {
        const { prayer, prayerName } = event.data;
        self.registration.showNotification('حان وقت الصلاة', {
            body: `حان الآن وقت صلاة ${prayerName}`,
            icon: 'icons/icon-192.png',
            tag: 'athan-' + prayer,
            silent: true,
            data: { prayer }
        });
    }
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const prayer = event.notification.data?.prayer || 'fajr';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // Focus existing window if available
            for (const client of clientList) {
                if ('focus' in client) {
                    client.focus();
                    client.postMessage({ type: 'PLAY_ATHAN', prayer });
                    return;
                }
            }
            // Otherwise open new window
            if (clients.openWindow) {
                return clients.openWindow('/').then(client => {
                    client.postMessage({ type: 'PLAY_ATHAN', prayer });
                });
            }
        })
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

    // Audio files - cache on first load
    if (event.request.url.includes('/audio/')) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    const cloned = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, cloned);
                    });
                    return response;
                });
            })
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
