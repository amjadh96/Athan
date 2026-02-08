// capacitor-bridge.js - Native notification scheduling via Capacitor
// Active only when running inside a Capacitor native shell.
// In a browser, all functions are no-ops.

(function () {
    'use strict';

    const isCapacitor = typeof window !== 'undefined'
        && window.Capacitor
        && window.Capacitor.isNativePlatform();

    window.isCapacitorNative = isCapacitor;

    if (!isCapacitor) {
        window.CapacitorBridge = {
            scheduleNotifications: async () => { },
            cancelAllNotifications: async () => { },
            init: async () => { },
            testNotification: async () => { },
            debugStatus: () => 'Not running in Capacitor',
            isNative: false
        };
        return;
    }

    console.log('CapacitorBridge: Running in native mode');

    let LocalNotifications, App;
    try {
        LocalNotifications = window.Capacitor.Plugins.LocalNotifications;
        App = window.Capacitor.Plugins.App;
        console.log('CapacitorBridge: Plugins loaded', !!LocalNotifications, !!App);
    } catch (e) {
        console.error('CapacitorBridge: Failed to load plugins', e);
        window.CapacitorBridge = {
            scheduleNotifications: async () => { },
            cancelAllNotifications: async () => { },
            init: async () => { },
            testNotification: async () => { },
            debugStatus: () => 'Plugin load failed: ' + e.message,
            isNative: true
        };
        return;
    }

    // Map BUILTIN_ATHAN keys (Arabic filenames without extension) to Android res/raw/ names
    // Also map the default 'naji' key used before loadAthanList() runs
    const SOUND_TO_RAW = {
        'naji': 'athan_naji',
        'ناجي قزاز': 'athan_naji',
        'أحمد جلال يحيى': 'athan_ahmad',
        'أذان الأموي الجماعي': 'athan_omawi',
        'علي بن أحمد ملا': 'athan_ali',
        'عبد الباسط': 'athan_abdulbasit',
        'ناصر القطامي': 'athan_nasser'
    };

    const PRAYER_NAMES_AR = {
        fajr: 'الفجر',
        dhuhr: 'الظهر',
        asr: 'العصر',
        maghrib: 'المغرب',
        isha: 'العشاء'
    };

    // Fixed notification IDs: today 1-5, tomorrow 31-35, pre-reminders +10, post-reminders +20
    const PRAYER_IDS = { fajr: 1, dhuhr: 2, asr: 3, maghrib: 4, isha: 5 };
    const PRAYER_LIST = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    const PRAYER_INDICES = { fajr: 0, dhuhr: 2, asr: 3, maghrib: 4, isha: 5 };

    // Track debug info
    let lastDebug = {};

    function getSoundForPrayer(prayer) {
        const soundId = window.settings?.prayers?.[prayer]?.sound || 'naji';
        if (soundId.startsWith('custom-')) {
            return 'athan_naji';
        }
        return SOUND_TO_RAW[soundId] || 'athan_naji';
    }

    async function requestPermissions() {
        try {
            const result = await LocalNotifications.requestPermissions();
            lastDebug.permission = result.display;
            console.log('CapacitorBridge: Notification permission:', result.display);
            return result;
        } catch (e) {
            lastDebug.permissionError = e.message;
            console.error('CapacitorBridge: Permission request failed:', e);
        }
    }

    async function cancelAllNotifications() {
        try {
            const pending = await LocalNotifications.getPending();
            if (pending.notifications.length > 0) {
                await LocalNotifications.cancel({ notifications: pending.notifications });
            }
        } catch (e) {
            console.error('CapacitorBridge: Failed to cancel notifications:', e);
        }
    }

    async function createChannels() {
        try {
            // Create one channel per prayer so each can have its own sound
            for (const prayer of PRAYER_LIST) {
                const soundName = getSoundForPrayer(prayer);
                await LocalNotifications.createChannel({
                    id: `athan-${prayer}`,
                    name: `أذان ${PRAYER_NAMES_AR[prayer]}`,
                    description: `أذان صلاة ${PRAYER_NAMES_AR[prayer]}`,
                    importance: 5,
                    visibility: 1,
                    sound: soundName + '.mp3',
                    vibration: true
                });
            }

            // Reminder channel
            await LocalNotifications.createChannel({
                id: 'reminder-channel',
                name: 'تذكيرات الصلاة',
                description: 'تذكيرات قبل وبعد الصلاة',
                importance: 3,
                visibility: 1,
                vibration: true
            });

            lastDebug.channels = 'created';
            console.log('CapacitorBridge: Channels created');
        } catch (e) {
            lastDebug.channelError = e.message;
            console.error('CapacitorBridge: Failed to create channels:', e);
        }
    }

    function buildNotificationsForDay(times, date, idOffset) {
        const now = new Date();
        const notifications = [];

        for (const prayer of PRAYER_LIST) {
            const prayerSettings = window.settings?.prayers?.[prayer];
            if (!prayerSettings || !prayerSettings.athan) continue;

            const index = PRAYER_INDICES[prayer];
            const timeStr = times[index];
            if (!timeStr) {
                console.warn('CapacitorBridge: No time for', prayer, 'at index', index);
                continue;
            }
            const [hours, minutes] = timeStr.split(':').map(Number);
            const scheduleDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0);

            // Skip if in the past
            if (scheduleDate <= now) continue;

            const soundName = getSoundForPrayer(prayer);

            notifications.push({
                id: PRAYER_IDS[prayer] + idOffset,
                title: 'حان وقت الصلاة',
                body: `حان الآن وقت صلاة ${PRAYER_NAMES_AR[prayer]}`,
                schedule: { at: scheduleDate, allowWhileIdle: true },
                sound: soundName + '.mp3',
                channelId: `athan-${prayer}`,
                extra: { prayer: prayer },
                autoCancel: true
            });

            // Pre-reminder
            if (prayerSettings.preEnabled && prayerSettings.preBefore > 0) {
                const preDate = new Date(scheduleDate.getTime() - prayerSettings.preBefore * 60000);
                if (preDate > now) {
                    notifications.push({
                        id: PRAYER_IDS[prayer] + idOffset + 10,
                        title: `تذكير صلاة ${PRAYER_NAMES_AR[prayer]}`,
                        body: `باقي ${prayerSettings.preBefore} دقيقة على صلاة ${PRAYER_NAMES_AR[prayer]}`,
                        schedule: { at: preDate, allowWhileIdle: true },
                        channelId: 'reminder-channel',
                        extra: { prayer: prayer, type: 'pre-reminder' },
                        autoCancel: true
                    });
                }
            }

            // Post-reminder
            if (prayerSettings.postEnabled && prayerSettings.postAfter > 0) {
                const postDate = new Date(scheduleDate.getTime() + prayerSettings.postAfter * 60000);
                if (postDate > now) {
                    notifications.push({
                        id: PRAYER_IDS[prayer] + idOffset + 20,
                        title: `تذكير بعد صلاة ${PRAYER_NAMES_AR[prayer]}`,
                        body: `مضت ${prayerSettings.postAfter} دقيقة على صلاة ${PRAYER_NAMES_AR[prayer]}`,
                        schedule: { at: postDate, allowWhileIdle: true },
                        channelId: 'reminder-channel',
                        extra: { prayer: prayer, type: 'post-reminder' },
                        autoCancel: true
                    });
                }
            }
        }

        return notifications;
    }

    async function scheduleNotifications() {
        await cancelAllNotifications();

        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);

        try {
            const todayTimes = await window.getPrayerTimesAsync(now);
            const tomorrowTimes = await window.getPrayerTimesAsync(tomorrow);

            const todayNotifs = buildNotificationsForDay(todayTimes, now, 0);
            const tomorrowNotifs = buildNotificationsForDay(tomorrowTimes, tomorrow, 30);
            const all = [...todayNotifs, ...tomorrowNotifs];

            lastDebug.scheduledCount = all.length;
            lastDebug.scheduledAt = now.toLocaleTimeString();
            lastDebug.nextNotifs = all.slice(0, 3).map(n => ({
                prayer: n.extra.prayer,
                at: n.schedule.at.toLocaleTimeString(),
                sound: n.sound
            }));

            if (all.length > 0) {
                await LocalNotifications.schedule({ notifications: all });
                console.log('CapacitorBridge: Scheduled', all.length, 'notifications:', JSON.stringify(lastDebug.nextNotifs));
            } else {
                console.log('CapacitorBridge: No upcoming notifications to schedule');
            }
        } catch (e) {
            lastDebug.scheduleError = e.message;
            console.error('CapacitorBridge: Failed to schedule notifications:', e);
        }
    }

    // When notification fires while app is in foreground, play full athan
    try {
        LocalNotifications.addListener('localNotificationReceived', (notification) => {
            console.log('CapacitorBridge: Notification received in foreground:', JSON.stringify(notification));
            const prayer = notification.extra?.prayer;
            const type = notification.extra?.type;
            if (prayer && !type && typeof window.playAthan === 'function') {
                window.playAthan(prayer);
            }
        });

        // When user taps notification, open app and play full athan
        LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
            console.log('CapacitorBridge: Notification tapped:', JSON.stringify(action));
            const prayer = action.notification.extra?.prayer;
            if (prayer && typeof window.playAthan === 'function') {
                window.playAthan(prayer);
            }
        });
    } catch (e) {
        console.error('CapacitorBridge: Failed to add listeners:', e);
    }

    // Reschedule on app resume
    try {
        App.addListener('appStateChange', async (state) => {
            if (state.isActive) {
                console.log('CapacitorBridge: App resumed, rescheduling notifications');
                await scheduleNotifications();
            }
        });
    } catch (e) {
        console.error('CapacitorBridge: Failed to add app listener:', e);
    }

    async function testNotification() {
        const testDate = new Date(Date.now() + 10000);
        try {
            await LocalNotifications.schedule({
                notifications: [{
                    id: 999,
                    title: 'اختبار الأذان',
                    body: 'هذا اختبار لإشعار وقت الصلاة',
                    schedule: { at: testDate, allowWhileIdle: true },
                    sound: 'athan_naji.mp3',
                    channelId: 'athan-fajr',
                    extra: { prayer: 'fajr' }
                }]
            });
            console.log('CapacitorBridge: Test notification scheduled for', testDate.toLocaleTimeString());
            return 'Test notification scheduled for ' + testDate.toLocaleTimeString();
        } catch (e) {
            console.error('CapacitorBridge: Test notification failed:', e);
            return 'Failed: ' + e.message;
        }
    }

    function debugStatus() {
        return JSON.stringify(lastDebug, null, 2);
    }

    async function init() {
        try {
            await requestPermissions();
            await createChannels();
            await scheduleNotifications();
            lastDebug.initialized = true;
            console.log('CapacitorBridge: Initialized successfully');
        } catch (e) {
            lastDebug.initError = e.message;
            console.error('CapacitorBridge: Init failed:', e);
        }
    }

    window.CapacitorBridge = {
        scheduleNotifications,
        cancelAllNotifications,
        init,
        testNotification,
        debugStatus,
        isNative: true
    };
})();
