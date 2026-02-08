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
            isNative: false
        };
        return;
    }

    console.log('CapacitorBridge: Running in native mode');

    const { LocalNotifications } = window.Capacitor.Plugins;
    const { App } = window.Capacitor.Plugins;

    // Map BUILTIN_ATHAN keys (Arabic filenames without extension) to Android res/raw/ names
    const SOUND_TO_RAW = {
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

    function getSoundForPrayer(prayer) {
        const soundId = window.settings?.prayers?.[prayer]?.sound || 'ناجي قزاز';
        if (soundId.startsWith('custom-')) {
            return 'athan_naji'; // Custom athans can't be used as notification sounds, fallback
        }
        return SOUND_TO_RAW[soundId] || 'athan_naji';
    }

    async function requestPermissions() {
        try {
            const result = await LocalNotifications.requestPermissions();
            console.log('Notification permission:', result.display);
            return result;
        } catch (e) {
            console.error('Permission request failed:', e);
        }
    }

    async function cancelAllNotifications() {
        try {
            const pending = await LocalNotifications.getPending();
            if (pending.notifications.length > 0) {
                await LocalNotifications.cancel({ notifications: pending.notifications });
            }
        } catch (e) {
            console.error('Failed to cancel notifications:', e);
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
        } catch (e) {
            console.error('Failed to create channels:', e);
        }
    }

    function buildNotificationsForDay(times, date, idOffset) {
        const now = new Date();
        const notifications = [];

        for (const prayer of PRAYER_LIST) {
            const prayerSettings = window.settings?.prayers?.[prayer];
            if (!prayerSettings || !prayerSettings.athan) continue;

            const index = PRAYER_INDICES[prayer];
            const [hours, minutes] = times[index].split(':').map(Number);
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

            if (all.length > 0) {
                await LocalNotifications.schedule({ notifications: all });
                console.log('Scheduled', all.length, 'notifications');
            }
        } catch (e) {
            console.error('Failed to schedule notifications:', e);
        }
    }

    // When notification fires while app is in foreground, play full athan
    LocalNotifications.addListener('localNotificationReceived', (notification) => {
        console.log('Notification received in foreground:', notification);
        const prayer = notification.extra?.prayer;
        const type = notification.extra?.type;
        if (prayer && !type && typeof window.playAthan === 'function') {
            window.playAthan(prayer);
        }
    });

    // When user taps notification, open app and play full athan
    LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        console.log('Notification tapped:', action);
        const prayer = action.notification.extra?.prayer;
        if (prayer && typeof window.playAthan === 'function') {
            window.playAthan(prayer);
        }
    });

    // Reschedule on app resume
    App.addListener('appStateChange', async (state) => {
        if (state.isActive) {
            console.log('App resumed, rescheduling notifications');
            await scheduleNotifications();
        }
    });

    async function testNotification() {
        const testDate = new Date(Date.now() + 10000);
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
        console.log('Test notification scheduled for', testDate.toLocaleTimeString());
    }

    async function init() {
        await requestPermissions();
        await createChannels();
        await scheduleNotifications();
        console.log('CapacitorBridge initialized');
    }

    window.CapacitorBridge = {
        scheduleNotifications,
        cancelAllNotifications,
        init,
        testNotification,
        isNative: true
    };
})();
