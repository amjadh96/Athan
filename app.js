// Berlin Prayer Times PWA - Main Application

// Global state
let settings = {
    location: 'berlin',
    berlinUseApi: false,
    customCity: '',
    customCountry: '',
    dstOffset: 0,
    timeFormat: '24',
    autoRamadan: true,
    ramadanMode: false,
    showImsak: true,
    showIftarCountdown: true,
    suhoorReminder: true,
    imsakMinutes: 10,
    themeMode: 'auto',
    fullscreenMode: false,
    screenAwake: true,
    showTomorrowTimes: true,
    hijriOffset: 0,
    prayers: {
        fajr: { athan: true, sound: 'naji', volume: 100, preBefore: 0, preEnabled: false, postAfter: 0, postEnabled: false },
        sunrise: { athan: false, sound: 'naji', volume: 100, preBefore: 0, preEnabled: false, postAfter: 0, postEnabled: false },
        dhuhr: { athan: true, sound: 'naji', volume: 100, preBefore: 0, preEnabled: false, postAfter: 0, postEnabled: false },
        asr: { athan: true, sound: 'naji', volume: 100, preBefore: 0, preEnabled: false, postAfter: 0, postEnabled: false },
        maghrib: { athan: true, sound: 'naji', volume: 100, preBefore: 0, preEnabled: false, postAfter: 0, postEnabled: false },
        isha: { athan: true, sound: 'naji', volume: 100, preBefore: 0, preEnabled: false, postAfter: 0, postEnabled: false }
    }
};

let currentCalendarMonth = new Date().getMonth();
let currentCalendarYear = new Date().getFullYear();
let wakeLock = null;
let lastAthanTime = null;
let lastReminderTime = {};
let isCheckingAthan = false;
let menuOpen = false;
let currentScreen = 'main-screen';
let cachedApiTimes = {};
let customAthanDB = null;
let currentAthanObjectUrl = null;
let audioContext = null;
let audioUnlocked = false;
let silentInterval = null;

// Keep audio context alive by playing silent sound periodically
function startSilentAudioLoop() {
    if (!audioContext) return;
    
    // Clear any existing interval
    if (silentInterval) clearInterval(silentInterval);
    
    // Play silent sound every 2 minutes to keep audio context alive
    silentInterval = setInterval(async () => {
        if (!audioContext) return;
        
        // Resume if suspended
        if (audioContext.state === 'suspended') {
            try {
                await audioContext.resume();
                console.log('AudioContext resumed from suspended state');
            } catch (e) {
                console.log('Failed to resume AudioContext:', e);
                return;
            }
        }
        
        // Play a tiny silent ping to keep the context active
        if (audioContext.state === 'running') {
            try {
                const oscillator = audioContext.createOscillator();
                const gain = audioContext.createGain();
                gain.gain.value = 0.001; // Nearly silent
                oscillator.connect(gain);
                gain.connect(audioContext.destination);
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.001);
                console.log('Silent keepalive ping at', new Date().toLocaleTimeString());
            } catch (e) {
                console.log('Silent ping failed:', e);
            }
        }
    }, 120000); // Every 2 minutes
    
    console.log('Silent audio keepalive loop started');
}

// Athan sources - loaded from audio/athan-list.json or fallback
let BUILTIN_ATHAN = {
    naji: { name: 'naji', src: 'audio/ناجي قزاز.mp3' },
};

async function loadAthanList() {
    try {
        const response = await fetch('audio/athan-list.json');
        if (!response.ok) return;
        const files = await response.json();
        if (files && files.length > 0) {
            BUILTIN_ATHAN = {};
            files.forEach(filename => {
                const id = filename.replace(/\.[^/.]+$/, '');
                BUILTIN_ATHAN[id] = { name: id, src: `audio/${filename}` };
            });
        }
    } catch (e) {
        // Use defaults
    }
}

// Popular cities
const CITIES = [
    { id: 'berlin', name: 'برلين', country: 'Germany' },
    { id: 'damascus', name: 'دمشق', city: 'Damascus', country: 'Syria' },
    { id: 'custom', name: 'مدينة أخرى...', city: '', country: '' }
];

function formatTime(hours, minutes, seconds = null, forceFormat = null) {
    const use24 = forceFormat ? forceFormat === '24' : settings.timeFormat === '24';

    let h = hours;
    let suffix = '';

    if (!use24) {
        suffix = hours >= 12 ? ' م' : ' ص';
        h = hours % 12 || 12;
    }

    const hStr = String(h).padStart(2, '0');
    const m = String(minutes).padStart(2, '0');

    const suffixHtml = suffix ? `<span class="time-suffix">${suffix}</span>` : '';

    if (seconds !== null) {
        const s = String(seconds).padStart(2, '0');
        return `${hStr}:${m}:${s}${suffixHtml}`;
    }
    return `${hStr}:${m}${suffixHtml}`;
}

function formatTimeOnly(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return formatTime(hours, minutes);
}

// IndexedDB for custom athan and cached times
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('PrayerTimesDB', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            customAthanDB = request.result;
            resolve();
        };
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('customAthans')) {
                db.createObjectStore('customAthans', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('cachedTimes')) {
                db.createObjectStore('cachedTimes', { keyPath: 'key' });
            }
        };
    });
}

async function saveCustomAthan(id, name, audioBlob) {
    if (!customAthanDB) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
        const tx = customAthanDB.transaction('customAthans', 'readwrite');
        const store = tx.objectStore('customAthans');
        store.put({ id, name, audio: audioBlob });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getCustomAthan(id) {
    if (!customAthanDB) return null;
    return new Promise((resolve, reject) => {
        const tx = customAthanDB.transaction('customAthans', 'readonly');
        const store = tx.objectStore('customAthans');
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getAllCustomAthans() {
    if (!customAthanDB) return [];
    return new Promise((resolve, reject) => {
        const tx = customAthanDB.transaction('customAthans', 'readonly');
        const store = tx.objectStore('customAthans');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

async function cacheApiTimes(key, times) {
    if (!customAthanDB) return;
    return new Promise((resolve, reject) => {
        const tx = customAthanDB.transaction('cachedTimes', 'readwrite');
        const store = tx.objectStore('cachedTimes');
        store.put({ key, times, timestamp: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getCachedApiTimes(key) {
    if (!customAthanDB) return null;
    return new Promise((resolve, reject) => {
        const tx = customAthanDB.transaction('cachedTimes', 'readonly');
        const store = tx.objectStore('cachedTimes');
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function fetchApiTimes(city, country, date) {
    const cacheKey = `${city}-${country}-${date.getMonth() + 1}-${date.getFullYear()}`;
    
    try {
        const cached = await getCachedApiTimes(cacheKey);
        if (cached && cached.times) {
            const dayTimes = cached.times[date.getDate()];
            if (dayTimes) return dayTimes;
        }
    } catch (e) {}
    
    try {
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        const url = `https://api.aladhan.com/v1/calendarByCity/${year}/${month}?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=3`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.code === 200 && data.data) {
            const monthTimes = {};
            data.data.forEach((day, index) => {
                const t = day.timings;
                monthTimes[index + 1] = [
                    t.Fajr.split(' ')[0],
                    t.Sunrise.split(' ')[0],
                    t.Dhuhr.split(' ')[0],
                    t.Asr.split(' ')[0],
                    t.Maghrib.split(' ')[0],
                    t.Isha.split(' ')[0]
                ];
            });
            
            await cacheApiTimes(cacheKey, monthTimes);
            return monthTimes[date.getDate()];
        }
    } catch (e) {
        // API error - fallback to local times
    }
    
    return getPrayerTimes(date);
}

async function getPrayerTimesAsync(date) {
    if (settings.location === 'berlin' && !settings.berlinUseApi) {
        return getPrayerTimes(date);
    }
    
    if (settings.location === 'berlin' && settings.berlinUseApi) {
        return await fetchApiTimes('Berlin', 'Germany', date);
    }
    
    const cityData = CITIES.find(c => c.id === settings.location);
    if (cityData && cityData.city) {
        return await fetchApiTimes(cityData.city, cityData.country, date);
    } else if (settings.location === 'custom' && settings.customCity) {
        return await fetchApiTimes(settings.customCity, settings.customCountry, date);
    }
    
    return getPrayerTimes(date);
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDB();
    } catch (e) {
        // DB init failed
    }

    try {
        await loadAthanList();
    } catch (e) {
        // Use default athan list
    }
    
    loadSettings();
    initNavigation();
    await initSettings();
    initQiblaCompass();
    await updateDisplay();
    startClock();
    await applyTheme();
    updateAthanIndicators();
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (settings.themeMode === 'system') applyTheme();
    });
    
    if (settings.screenAwake) requestWakeLock();
    
    // Request notification permission for athan alerts
    requestNotificationPermission();

    // Listen for messages from Service Worker (notification clicks)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'PLAY_ATHAN') {
                playAthan(event.data.prayer);
            }
        });
    }

    setInterval(checkAthanTime, 15000); // Check every 15 seconds (saves battery)
    setupBackButton();

    // Initialize Capacitor native features if available
    if (window.CapacitorBridge && window.CapacitorBridge.isNative) {
        try {
            await window.CapacitorBridge.init();
            console.log('Capacitor bridge initialized');
        } catch (e) {
            console.error('Capacitor bridge init failed:', e);
        }
    }

    // Unlock audio playback on first user interaction (browser autoplay policy)
    const unlockAudio = async () => {
        if (audioUnlocked) return;

        try {
            // Create AudioContext (required for Android)
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            // Preload the default athan audio
            const athanAudio = document.getElementById('athan-audio');
            const defaultSrc = Object.values(BUILTIN_ATHAN)[0]?.src || 'audio/ناجي قزاز.mp3';
            athanAudio.src = defaultSrc;
            athanAudio.load();

            audioUnlocked = true;
            
            // Start silent audio loop to keep AudioContext alive
            startSilentAudioLoop();
            console.log('Audio unlocked and silent keepalive started');
        } catch (e) {
            // Audio unlock failed - will retry on next interaction
            console.log('Audio unlock failed:', e);
        }
    };

    // Listen for any user interaction to unlock audio
    ['click', 'touchstart', 'touchend', 'keydown'].forEach(event => {
        document.addEventListener(event, unlockAudio, { once: true });
    });
});

function setupBackButton() {
    history.pushState({ screen: 'main-screen' }, '', '');
    window.addEventListener('popstate', (e) => {
        if (currentScreen !== 'main-screen') {
            showScreen('main-screen');
            history.pushState({ screen: 'main-screen' }, '', '');
        }
    });
}

function initNavigation() {
    const menuBtn = document.getElementById('menu-btn');
    const dropdownMenu = document.getElementById('dropdown-menu');
    
    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuOpen = !menuOpen;
        dropdownMenu.classList.toggle('show', menuOpen);
    });
    
    document.addEventListener('click', () => {
        if (menuOpen) {
            menuOpen = false;
            dropdownMenu.classList.remove('show');
        }
    });
    
    document.querySelectorAll('.menu-item[data-view]').forEach(item => {
        item.addEventListener('click', () => {
            showScreen(`${item.dataset.view}-screen`);
            menuOpen = false;
            dropdownMenu.classList.remove('show');
        });
    });
    
    // Fullscreen toggle in menu (only for PWA, Android is always immersive)
    document.getElementById('menu-fullscreen-toggle').addEventListener('click', () => {
        if (!window.isCapacitorNative) {
            if (document.fullscreenElement) {
                document.exitFullscreen?.();
            } else {
                document.documentElement.requestFullscreen?.();
            }
        }
        menuOpen = false;
        dropdownMenu.classList.remove('show');
    });
    
    document.querySelectorAll('.back-btn').forEach(btn => {
        btn.addEventListener('click', () => showScreen('main-screen'));
    });
    
    document.getElementById('prev-month').addEventListener('click', () => {
        currentCalendarMonth--;
        if (currentCalendarMonth < 0) { currentCalendarMonth = 11; currentCalendarYear--; }
        updateCalendar();
    });

    document.getElementById('next-month').addEventListener('click', () => {
        currentCalendarMonth++;
        if (currentCalendarMonth > 11) { currentCalendarMonth = 0; currentCalendarYear++; }
        updateCalendar();
    });
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    currentScreen = screenId;
    
    if (screenId === 'calendar-screen') updateCalendar();
    if (screenId !== 'main-screen') history.pushState({ screen: screenId }, '', '');
}

function startClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

async function updateClock() {
    const now = new Date();
    document.getElementById('current-time').innerHTML = formatTime(now.getHours(), now.getMinutes());
    await updateCountdown();
    
    // Update prayer card states every minute (when seconds = 0)
    if (now.getSeconds() === 0) {
        const times = await getPrayerTimesAsync(now);
        updatePrayerCardStates(now, times);
    }
}

async function updateDisplay() {
    const now = new Date();
    
    document.getElementById('hijri-date').textContent = getHijriDateString(now, settings.hijriOffset);
    document.getElementById('gregorian-date').textContent = getGregorianDateString(now);
    
    const cityData = CITIES.find(c => c.id === settings.location);
    const locationName = settings.location === 'custom' && settings.customCity
        ? settings.customCity
        : (cityData ? cityData.name : 'برلين');
    document.getElementById('location-label').textContent = locationName;
    
    // Auto-Ramadan detection
    if (settings.autoRamadan) {
        const isCurrentlyRamadan = isRamadan(now, settings.hijriOffset);
        if (isCurrentlyRamadan !== settings.ramadanMode) {
            settings.ramadanMode = isCurrentlyRamadan;
            saveSettings();
            document.getElementById('ramadan-mode').checked = isCurrentlyRamadan;
        }
    }
    
    // Apply special theme for Ramadan/Eid
    applySpecialTheme(now);
    
    const times = await getPrayerTimesAsync(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowTimes = await getPrayerTimesAsync(tomorrow);
    
    updatePrayerTimesDisplay(now, times, tomorrowTimes);
    updatePrayerCardStates(now, times);
    updateRamadanDisplay(now, times);
    updateEidDisplay(now);
    updateAthanIndicators();
    
    await applyTheme();
}

function updatePrayerTimesDisplay(now, times, tomorrowTimes) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const prayers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
    
    prayers.forEach((prayer, index) => {
        const [hours, minutes] = times[index].split(':').map(Number);
        const prayerMinutes = hours * 60 + minutes;
        const isPassed = currentMinutes >= prayerMinutes;
        
        const timeElement = document.getElementById(`${prayer}-time`);
        const tomorrowIndicator = document.getElementById(`${prayer}-tomorrow`);
        
        if (isPassed && settings.showTomorrowTimes) {
            timeElement.innerHTML = formatTimeOnly(tomorrowTimes[index]);
            tomorrowIndicator.textContent = 'غداً';
            tomorrowIndicator.style.display = 'block';
        } else {
            timeElement.innerHTML = formatTimeOnly(times[index]);
            tomorrowIndicator.style.display = 'none';
        }
    });
}

function updateAthanIndicators() {
    const prayers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
    prayers.forEach(prayer => {
        const indicator = document.getElementById(`${prayer}-athan`);
        if (indicator) indicator.style.display = settings.prayers[prayer].athan ? 'block' : 'none';
    });
}

function updatePrayerCardStates(now, times) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const prayers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
    let nextPrayer = null;
    
    prayers.forEach((prayer, index) => {
        const card = document.querySelector(`[data-prayer="${prayer}"]`);
        const [hours, minutes] = times[index].split(':').map(Number);
        const prayerMinutes = hours * 60 + minutes;
        
        card.classList.remove('passed', 'active', 'next');
        
        if (currentMinutes >= prayerMinutes) {
            card.classList.add('passed');
        } else if (nextPrayer === null) {
            nextPrayer = prayer;
            card.classList.add('next');
        }
    });
    
    // After Isha, Fajr is next
    if (!nextPrayer) {
        nextPrayer = 'fajr';
        document.querySelector('[data-prayer="fajr"]').classList.remove('passed');
        document.querySelector('[data-prayer="fajr"]').classList.add('next');
    }
    document.getElementById('next-prayer-label').textContent = `${PRAYER_NAMES[nextPrayer]} بعد`;
}

async function updateCountdown() {
    const now = new Date();
    const times = await getPrayerTimesAsync(now);
    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    
    const prayers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
    let nextPrayerSeconds = null;
    let nextPrayerName = null;
    
    for (let i = 0; i < prayers.length; i++) {
        const [hours, minutes] = times[i].split(':').map(Number);
        const prayerSeconds = hours * 3600 + minutes * 60;
        
        if (currentSeconds < prayerSeconds) {
            nextPrayerSeconds = prayerSeconds;
            nextPrayerName = prayers[i];
            break;
        }
    }
    
    if (nextPrayerSeconds === null) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowTimes = await getPrayerTimesAsync(tomorrow);
        const [hours, minutes] = tomorrowTimes[0].split(':').map(Number);
        nextPrayerSeconds = (24 * 3600) + hours * 3600 + minutes * 60;
        nextPrayerName = 'fajr';
    }
    
    const diffSeconds = nextPrayerSeconds - currentSeconds;
    const hours = Math.floor(diffSeconds / 3600);
    const mins = Math.floor((diffSeconds % 3600) / 60);
    const secs = diffSeconds % 60;

    let countdownText;
    if (diffSeconds <= 300) {
        // Under 5 minutes: show MM:SS
        const totalMins = Math.floor(diffSeconds / 60);
        countdownText = `${String(totalMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
        // Over 5 minutes: show HH:MM (no seconds, no م/ص)
        countdownText = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    }
    document.getElementById('countdown-timer').textContent = countdownText;
    document.getElementById('next-prayer-label').textContent = `${PRAYER_NAMES[nextPrayerName]} بعد`;
    
    if (settings.ramadanMode && settings.showIftarCountdown) {
        updateIftarCountdown(now, times);
    }
}

function updateIftarCountdown(now, times) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [maghribHours, maghribMins] = times[4].split(':').map(Number);
    const maghribMinutes = maghribHours * 60 + maghribMins;
    
    if (currentMinutes < maghribMinutes) {
        const diff = maghribMinutes - currentMinutes;
        document.getElementById('iftar-countdown').textContent = `الإفطار بعد ${Math.floor(diff / 60)}:${String(diff % 60).padStart(2, '0')}`;
    } else {
        document.getElementById('iftar-countdown').textContent = 'حان وقت الإفطار';
    }
}

function updateRamadanDisplay(now, times) {
    // Banner removed - using background theme instead
    const banner = document.getElementById('ramadan-banner');
    if (banner) banner.style.display = 'none';
}

function updateEidDisplay(now) {
    // Banner removed - using background theme instead
    const banner = document.getElementById('eid-banner');
    if (banner) banner.style.display = 'none';
}

async function updateCalendar() {
    const monthName = ARABIC_MONTHS[currentCalendarMonth];
    document.getElementById('calendar-month-name').textContent = `${monthName} ${currentCalendarYear}`;
    
    const tbody = document.getElementById('calendar-body');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;">جاري التحميل...</td></tr>';
    
    const daysInMonth = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
    const today = new Date();
    
    tbody.innerHTML = '';
    
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(currentCalendarYear, currentCalendarMonth, day);
        const times = await getPrayerTimesAsync(date);
        const hijriInfo = getHijriInfo(date, settings.hijriOffset);
        
        const row = document.createElement('tr');
        const isToday = date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
        
        if (isToday) row.classList.add('today');
        if (hijriInfo.isRamadan) row.classList.add('ramadan-day');
        if (hijriInfo.isEidFitr || hijriInfo.isEidAdha) row.classList.add('eid-day');
        
        row.innerHTML = `<td>${day}</td><td>${times[0]}</td><td>${times[1]}</td><td>${times[2]}</td><td>${times[3]}</td><td>${times[4]}</td><td>${times[5]}</td>`;
        tbody.appendChild(row);
    }
}

async function applyTheme() {
    const mode = settings.themeMode || 'auto';
    
    if (mode === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else if (mode === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else if (mode === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else if (mode === 'auto') {
        // Dark from Maghrib to Sunrise, Light from Sunrise to Maghrib
        const now = new Date();
        const times = await getPrayerTimesAsync(now);
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        
        const [sunriseH, sunriseM] = times[1].split(':').map(Number); // Sunrise
        const [maghribH, maghribM] = times[4].split(':').map(Number); // Maghrib
        
        const sunriseMinutes = sunriseH * 60 + sunriseM;
        const maghribMinutes = maghribH * 60 + maghribM;
        
        const isDay = currentMinutes >= sunriseMinutes && currentMinutes < maghribMinutes;
        document.documentElement.setAttribute('data-theme', isDay ? 'light' : 'dark');
    }
}

function applySpecialTheme(date) {
    // Remove all special themes first
    document.body.classList.remove('theme-ramadan', 'theme-eid-fitr', 'theme-eid-adha');
    
    const eidInfo = getEidInfo(date, settings.hijriOffset);

    if (eidInfo.isEid) {
        if (eidInfo.type === 'fitr') {
            document.body.classList.add('theme-eid-fitr');
        } else if (eidInfo.type === 'adha') {
            document.body.classList.add('theme-eid-adha');
        }
    } else if (isRamadan(date, settings.hijriOffset)) {
        document.body.classList.add('theme-ramadan');
    }
}

async function checkAthanTime() {
    // Prevent concurrent execution
    if (isCheckingAthan) return;
    isCheckingAthan = true;

    try {
        const now = new Date();
        const times = await getPrayerTimesAsync(now);
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const currentTime = `${h}:${m}`;

        // Reset lastAthanTime at midnight
        if (currentTime === '00:00' && lastAthanTime !== '00:00') {
            lastAthanTime = null;
            lastReminderTime = {};
        }

        const prayers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

        for (const [index, prayer] of prayers.entries()) {
            const prayerTime = times[index];
            const prayerSettings = settings.prayers[prayer];

            if (currentTime === prayerTime && lastAthanTime !== currentTime) {
                if (prayerSettings.athan && prayer !== 'sunrise') {
                    // Set lastAthanTime FIRST to prevent duplicate triggers
                    lastAthanTime = currentTime;

                    // Vibrate once (200ms)
                    if (navigator.vibrate) navigator.vibrate(200);

                    // Show notification (skip in Capacitor - native handles it)
                    if (!window.isCapacitorNative) {
                        showAthanNotification(prayer);
                    }

                    // Play audio
                    playAthan(prayer);
                }
            }
        
        if (prayerSettings.preEnabled && prayerSettings.preBefore > 0) {
            const [pHours, pMins] = prayerTime.split(':').map(Number);
            let reminderMins = pMins - prayerSettings.preBefore;
            let reminderHours = pHours;
            if (reminderMins < 0) { reminderMins += 60; reminderHours--; }
            if (reminderHours < 0) { reminderHours += 24; }
            const reminderH = String(reminderHours).padStart(2, '0');
            const reminderM = String(reminderMins).padStart(2, '0');
            const reminderTime = `${reminderH}:${reminderM}`;
            const reminderKey = `pre-${prayer}`;

            if (currentTime === reminderTime && lastReminderTime[reminderKey] !== currentTime) {
                playReminder();
                lastReminderTime[reminderKey] = currentTime;
            }
        }

        if (prayerSettings.postEnabled && prayerSettings.postAfter > 0) {
            const [pHours, pMins] = prayerTime.split(':').map(Number);
            let reminderMins = pMins + prayerSettings.postAfter;
            let reminderHours = pHours;
            if (reminderMins >= 60) { reminderMins -= 60; reminderHours++; }
            if (reminderHours >= 24) { reminderHours -= 24; }
            const reminderH = String(reminderHours).padStart(2, '0');
            const reminderM = String(reminderMins).padStart(2, '0');
            const reminderTime = `${reminderH}:${reminderM}`;
            const reminderKey = `post-${prayer}`;

            if (currentTime === reminderTime && lastReminderTime[reminderKey] !== currentTime) {
                playReminder();
                lastReminderTime[reminderKey] = currentTime;
            }
        }
    }
    } finally {
        isCheckingAthan = false;
    }
}

async function playAthan(prayer) {
    console.log('=== playAthan called for', prayer, 'at', new Date().toLocaleTimeString(), '===');
    
    const audio = document.getElementById('athan-audio');
    const prayerSettings = settings.prayers[prayer];
    const soundId = prayerSettings.sound;

    // Resume AudioContext if suspended (important for Android)
    if (audioContext) {
        console.log('AudioContext state before resume:', audioContext.state);
        if (audioContext.state === 'suspended') {
            try { 
                await audioContext.resume(); 
                console.log('AudioContext resumed successfully');
            } catch (e) {
                console.log('AudioContext resume failed:', e);
            }
        }
    } else {
        console.log('WARNING: No AudioContext!');
    }

    // Revoke previous object URL to prevent memory leak
    if (currentAthanObjectUrl) {
        URL.revokeObjectURL(currentAthanObjectUrl);
        currentAthanObjectUrl = null;
    }

    const tryPlayAudio = () => {
        audio.volume = prayerSettings.volume / 100;
        audio.currentTime = 0;

        const playWhenReady = () => {
            audio.play().then(() => {
                console.log('Athan playing successfully');
            }).catch((err) => {
                console.log('Audio play failed:', err);
                // Show visual indicator that audio failed
                showAudioFailedIndicator();
            });
        };

        if (audio.readyState >= 3) {
            playWhenReady();
        } else {
            audio.addEventListener('canplaythrough', playWhenReady, { once: true });
            audio.load();
        }
    };

    // Set source
    if (soundId.startsWith('custom-')) {
        getCustomAthan(soundId).then(customAthan => {
            if (customAthan && customAthan.audio) {
                currentAthanObjectUrl = URL.createObjectURL(customAthan.audio);
                audio.src = currentAthanObjectUrl;
            } else {
                audio.src = Object.values(BUILTIN_ATHAN)[0]?.src || 'audio/ناجي قزاز.mp3';
            }
            tryPlayAudio();
        }).catch(() => {
            audio.src = Object.values(BUILTIN_ATHAN)[0]?.src || 'audio/ناجي قزاز.mp3';
            tryPlayAudio();
        });
    } else {
        audio.src = BUILTIN_ATHAN[soundId]?.src || Object.values(BUILTIN_ATHAN)[0]?.src;
        tryPlayAudio();
    }
}

function showAudioFailedIndicator() {
    // Check if indicator already exists
    if (document.getElementById('audio-failed-toast')) return;
    
    const toast = document.createElement('div');
    toast.id = 'audio-failed-toast';
    toast.innerHTML = `
        <div style="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
            background:rgba(220,38,38,0.95);color:white;padding:12px 20px;
            border-radius:12px;z-index:9999;text-align:center;font-size:14px;
            box-shadow:0 4px 12px rgba(0,0,0,0.3);max-width:90%;cursor:pointer;">
            <div>⚠️ اضغط هنا لتشغيل الأذان</div>
            <div style="font-size:12px;opacity:0.8;margin-top:4px;">المتصفح يحتاج تفاعل لتشغيل الصوت</div>
        </div>
    `;
    
    toast.addEventListener('click', async () => {
        // Try to resume and play
        if (audioContext && audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        const audio = document.getElementById('athan-audio');
        if (audio.src) {
            audio.play().catch(() => {});
        }
        toast.remove();
    });
    
    document.body.appendChild(toast);
    
    // Auto-remove after 30 seconds
    setTimeout(() => toast.remove(), 30000);
}

async function showAthanNotification(prayer) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'denied') return;

    if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
    }

    const prayerName = PRAYER_NAMES[prayer];

    // Use Service Worker for notifications (required on Android)
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_ATHAN_NOTIFICATION',
            prayer,
            prayerName
        });
    } else {
        // Fallback for desktop or if SW not ready
        try {
            const notification = new Notification('حان وقت الصلاة', {
                body: `حان الآن وقت صلاة ${prayerName}`,
                icon: 'icons/icon-192.png',
                tag: 'athan-' + prayer,
                silent: true
            });
            notification.onclick = () => {
                window.focus();
                playAthan(prayer);
                notification.close();
            };
        } catch (e) {
            // Notification failed
        }
    }
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

async function testAthan(prayer) {
    const audio = document.getElementById('athan-audio');
    const prayerSettings = settings.prayers[prayer];
    const soundId = prayerSettings.sound;

    // If already playing, stop it
    if (!audio.paused) {
        audio.pause();
        audio.currentTime = 0;
        return;
    }

    // Revoke previous object URL to prevent memory leak
    if (currentAthanObjectUrl) {
        URL.revokeObjectURL(currentAthanObjectUrl);
        currentAthanObjectUrl = null;
    }

    if (soundId.startsWith('custom-')) {
        try {
            const customAthan = await getCustomAthan(soundId);
            if (customAthan && customAthan.audio) {
                currentAthanObjectUrl = URL.createObjectURL(customAthan.audio);
                audio.src = currentAthanObjectUrl;
            }
        } catch (e) {
            audio.src = Object.values(BUILTIN_ATHAN)[0]?.src || 'audio/athan.mp3';
        }
    } else {
        audio.src = BUILTIN_ATHAN[soundId]?.src || Object.values(BUILTIN_ATHAN)[0]?.src;
    }

    audio.volume = prayerSettings.volume / 100;
    audio.currentTime = 0;
    audio.play().catch(err => alert('فشل تشغيل الأذان'));
}

function playReminder() {
    const audio = document.getElementById('reminder-audio');
    audio.src = 'audio/reminder.mp3';
    audio.volume = 0.5;
    audio.play().catch(err => {});
}

function initQiblaCompass() {
    // Use coordinates based on selected city
    const cityCoords = {
        berlin: { lat: 52.52, lng: 13.405 },
        damascus: { lat: 33.5138, lng: 36.2765 }
    };
    const coords = cityCoords[settings.location] || cityCoords.berlin;
    const kaabaLat = 21.4225, kaabaLng = 39.8262;
    const qiblaDirection = calculateQibla(coords.lat, coords.lng, kaabaLat, kaabaLng);

    const needle = document.getElementById('qibla-needle');
    const compass = document.getElementById('qibla-compass');
    needle.style.transform = `rotate(${qiblaDirection}deg)`;

    const handler = (e) => {
        let heading = null;
        if (e.webkitCompassHeading !== undefined) {
            // iOS provides compass heading directly
            heading = e.webkitCompassHeading;
        } else if (e.alpha !== null) {
            // Android: alpha is degrees from north (when using absolute event)
            heading = 360 - e.alpha;
        }
        if (heading !== null) {
            needle.style.transform = `rotate(${qiblaDirection - heading}deg)`;
            compass.style.transform = `rotate(${-heading}deg)`;
        }
    };

    // Prefer deviceorientationabsolute (Android, gives true north)
    if ('ondeviceorientationabsolute' in window) {
        window.addEventListener('deviceorientationabsolute', handler);
    } else if (window.DeviceOrientationEvent) {
        // iOS or fallback
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS 13+ requires permission
            DeviceOrientationEvent.requestPermission().then(response => {
                if (response === 'granted') {
                    window.addEventListener('deviceorientation', handler);
                }
            }).catch(() => {});
        } else {
            window.addEventListener('deviceorientation', handler);
        }
    }
}

function calculateQibla(lat1, lng1, lat2, lng2) {
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;
    const x = Math.sin(Δλ);
    const y = Math.cos(φ1) * Math.tan(φ2) - Math.sin(φ1) * Math.cos(Δλ);
    return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}

async function initSettings() {
    const locationSelect = document.getElementById('location-select');
    CITIES.forEach(city => {
        const option = document.createElement('option');
        option.value = city.id;
        option.textContent = city.name;
        locationSelect.appendChild(option);
    });
    locationSelect.value = settings.location;
    
    locationSelect.addEventListener('change', async (e) => {
        settings.location = e.target.value;
        document.getElementById('custom-location-fields').style.display = e.target.value === 'custom' ? 'block' : 'none';
        document.getElementById('berlin-api-fields').style.display = e.target.value === 'berlin' ? 'block' : 'none';
        saveSettings();
        await updateDisplay();
    });
    
    document.getElementById('berlin-source').addEventListener('change', async (e) => {
        settings.berlinUseApi = e.target.value === 'api';
        saveSettings();
        await updateDisplay();
    });
    
    document.getElementById('custom-city').addEventListener('change', (e) => {
        settings.customCity = e.target.value;
        saveSettings();
        updateDisplay();
    });
    
    document.getElementById('custom-country').addEventListener('change', (e) => {
        settings.customCountry = e.target.value;
        saveSettings();
        updateDisplay();
    });
    
    // Show relevant fields based on current location
    if (settings.location === 'custom') {
        document.getElementById('custom-location-fields').style.display = 'block';
        document.getElementById('custom-city').value = settings.customCity || '';
        document.getElementById('custom-country').value = settings.customCountry || '';
    }
    if (settings.location === 'berlin') {
        document.getElementById('berlin-api-fields').style.display = 'block';
        document.getElementById('berlin-source').value = settings.berlinUseApi ? 'api' : 'fixed';
    }
    
    document.getElementById('custom-athan-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('audio/')) {
            const id = 'custom-' + Date.now();
            const name = file.name.replace(/\.[^/.]+$/, '');
            try {
                await saveCustomAthan(id, name, file);
                await generatePrayerSettings();
                alert('تم إضافة الأذان المخصص بنجاح');
            } catch (err) {
                alert('فشل حفظ الأذان');
            }
        }
        e.target.value = '';
    });
    
    // Test auto athan (simulates what happens at prayer time)
    document.getElementById('test-auto-athan').addEventListener('click', () => {
        if (navigator.vibrate) navigator.vibrate([200]);
        showAthanNotification('fajr');
        playAthan('fajr');
    });
    
    // Enable notifications button
    document.getElementById('enable-notifications').addEventListener('click', () => {
        if ('Notification' in window) {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    alert('تم تفعيل الإشعارات بنجاح');
                    new Notification('أوقات الصلاة', {
                        body: 'تم تفعيل إشعارات الأذان',
                        icon: 'icons/icon-192.png'
                    });
                } else {
                    alert('لم يتم السماح بالإشعارات');
                }
            });
        } else {
            alert('المتصفح لا يدعم الإشعارات');
        }
    });
    
    await generatePrayerSettings();
    
    document.getElementById('auto-ramadan').addEventListener('change', (e) => { settings.autoRamadan = e.target.checked; saveSettings(); updateDisplay(); });
    document.getElementById('ramadan-mode').addEventListener('change', (e) => { settings.ramadanMode = e.target.checked; saveSettings(); updateDisplay(); });
    document.getElementById('show-imsak').addEventListener('change', (e) => { settings.showImsak = e.target.checked; saveSettings(); updateDisplay(); });
    document.getElementById('show-iftar-countdown').addEventListener('change', (e) => { settings.showIftarCountdown = e.target.checked; saveSettings(); });
    document.getElementById('suhoor-reminder').addEventListener('change', (e) => { settings.suhoorReminder = e.target.checked; saveSettings(); });
    document.getElementById('imsak-minutes').addEventListener('change', (e) => { settings.imsakMinutes = parseInt(e.target.value) || 10; saveSettings(); updateDisplay(); });
    document.getElementById('theme-mode').addEventListener('change', (e) => { settings.themeMode = e.target.value; saveSettings(); applyTheme(); });
    document.getElementById('time-format').addEventListener('change', (e) => { 
        settings.timeFormat = e.target.value; 
        saveSettings(); 
        document.body.classList.toggle('format-12h', e.target.value === '12');
        updateDisplay(); 
    });
    document.getElementById('show-tomorrow-times').addEventListener('change', (e) => { settings.showTomorrowTimes = e.target.checked; saveSettings(); updateDisplay(); });
    document.getElementById('fullscreen-mode').addEventListener('change', (e) => {
        settings.fullscreenMode = e.target.checked;
        saveSettings();
        if (!window.isCapacitorNative) {
            if (e.target.checked) { document.body.classList.add('fullscreen'); document.documentElement.requestFullscreen?.(); }
            else { document.body.classList.remove('fullscreen'); document.exitFullscreen?.(); }
        }
    });
    document.getElementById('screen-awake').addEventListener('change', (e) => {
        settings.screenAwake = e.target.checked;
        saveSettings();
        if (e.target.checked) requestWakeLock(); else releaseWakeLock();
    });
    document.getElementById('dst-offset').addEventListener('change', (e) => { settings.dstOffset = parseInt(e.target.value); saveSettings(); updateDisplay(); });
    document.getElementById('hijri-offset').addEventListener('change', (e) => { settings.hijriOffset = parseInt(e.target.value); saveSettings(); updateDisplay(); });

    loadSettingsToUI();
}

async function generatePrayerSettings() {
    const container = document.getElementById('prayer-athan-settings');
    container.innerHTML = '';
    
    const prayers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
    const customAthans = await getAllCustomAthans();
    
    prayers.forEach(prayer => {
        const prayerName = PRAYER_NAMES[prayer];
        const prayerSettings = settings.prayers[prayer];
        
        let soundOptions = Object.entries(BUILTIN_ATHAN).map(([id, data]) => 
            `<option value="${id}" ${prayerSettings.sound === id ? 'selected' : ''}>${data.name}</option>`
        ).join('');
        
        customAthans.forEach(ca => {
            soundOptions += `<option value="${ca.id}" ${prayerSettings.sound === ca.id ? 'selected' : ''}>${ca.name} (مخصص)</option>`;
        });
        
        const html = `
            <div class="prayer-setting-item" data-prayer="${prayer}">
                <div class="prayer-setting-header">
                    <span class="prayer-setting-name">${prayerName}</span>
                    <label class="toggle-switch">
                        <input type="checkbox" class="athan-toggle" ${prayerSettings.athan ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>
                <div class="prayer-setting-controls">
                    <div class="prayer-control-row">
                        <span>صوت الأذان</span>
                        <select class="sound-select">${soundOptions}</select>
                    </div>
                    <div class="prayer-control-row">
                        <span>مستوى الصوت</span>
                        <input type="range" class="volume-slider" min="0" max="100" value="${prayerSettings.volume}">
                    </div>
                    <div class="prayer-control-row">
                        <span>اختبار</span>
                        <button class="test-btn" type="button">▶</button>
                    </div>
                    <div class="prayer-control-row">
                        <span>تذكير قبل (دقيقة)</span>
                        <div class="reminder-inputs">
                            <input type="checkbox" class="pre-enabled" ${prayerSettings.preEnabled ? 'checked' : ''}>
                            <input type="number" class="pre-before" min="0" max="60" value="${prayerSettings.preBefore}">
                        </div>
                    </div>
                    <div class="prayer-control-row">
                        <span>تذكير بعد (دقيقة)</span>
                        <div class="reminder-inputs">
                            <input type="checkbox" class="post-enabled" ${prayerSettings.postEnabled ? 'checked' : ''}>
                            <input type="number" class="post-after" min="0" max="60" value="${prayerSettings.postAfter}">
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);
    });
    
    container.querySelectorAll('.prayer-setting-item').forEach(item => {
        const prayer = item.dataset.prayer;
        
        item.querySelector('.athan-toggle').addEventListener('change', (e) => { settings.prayers[prayer].athan = e.target.checked; saveSettings(); updateAthanIndicators(); });
        item.querySelector('.sound-select').addEventListener('change', (e) => { settings.prayers[prayer].sound = e.target.value; saveSettings(); });
        item.querySelector('.volume-slider').addEventListener('input', (e) => { settings.prayers[prayer].volume = parseInt(e.target.value); saveSettings(); });
        item.querySelector('.test-btn').addEventListener('click', () => testAthan(prayer));
        item.querySelector('.pre-enabled').addEventListener('change', (e) => { settings.prayers[prayer].preEnabled = e.target.checked; saveSettings(); });
        item.querySelector('.pre-before').addEventListener('change', (e) => { settings.prayers[prayer].preBefore = parseInt(e.target.value) || 0; saveSettings(); });
        item.querySelector('.post-enabled').addEventListener('change', (e) => { settings.prayers[prayer].postEnabled = e.target.checked; saveSettings(); });
        item.querySelector('.post-after').addEventListener('change', (e) => { settings.prayers[prayer].postAfter = parseInt(e.target.value) || 0; saveSettings(); });
    });
}

function loadSettingsToUI() {
    document.getElementById('location-select').value = settings.location;
    document.getElementById('auto-ramadan').checked = settings.autoRamadan;
    document.getElementById('ramadan-mode').checked = settings.ramadanMode;
    document.getElementById('show-imsak').checked = settings.showImsak;
    document.getElementById('show-iftar-countdown').checked = settings.showIftarCountdown;
    document.getElementById('suhoor-reminder').checked = settings.suhoorReminder;
    document.getElementById('imsak-minutes').value = settings.imsakMinutes;
    document.getElementById('theme-mode').value = settings.themeMode || 'auto';
    document.getElementById('time-format').value = settings.timeFormat;
    document.getElementById('show-tomorrow-times').checked = settings.showTomorrowTimes;
    document.getElementById('fullscreen-mode').checked = settings.fullscreenMode;
    document.getElementById('screen-awake').checked = settings.screenAwake;
    document.getElementById('dst-offset').value = settings.dstOffset;
    document.getElementById('hijri-offset').value = settings.hijriOffset || 0;

    document.body.classList.toggle('format-12h', settings.timeFormat === '12');
    
    if (settings.location === 'berlin') {
        document.getElementById('berlin-api-fields').style.display = 'block';
        document.getElementById('berlin-source').value = settings.berlinUseApi ? 'api' : 'fixed';
    }
    if (settings.location === 'custom') {
        document.getElementById('custom-location-fields').style.display = 'block';
        document.getElementById('custom-city').value = settings.customCity || '';
        document.getElementById('custom-country').value = settings.customCountry || '';
    }
}

function saveSettings() {
    localStorage.setItem('prayerSettings', JSON.stringify(settings));
    // Reschedule native notifications when settings change
    if (window.CapacitorBridge && window.CapacitorBridge.isNative) {
        window.CapacitorBridge.scheduleNotifications().catch(e =>
            console.error('Reschedule failed:', e)
        );
    }
}

function loadSettings() {
    const saved = localStorage.getItem('prayerSettings');
    if (saved) {
        const parsed = JSON.parse(saved);
        settings = { ...settings, ...parsed };
        ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
            if (!settings.prayers[p].sound) settings.prayers[p].sound = 'naji';
        });
    }
}

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {}
    }
}

function releaseWakeLock() { if (wakeLock) { wakeLock.release(); wakeLock = null; } }

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        // Resume wake lock
        if (settings.screenAwake) requestWakeLock();
        
        // Resume AudioContext if it was suspended (important for athan)
        if (audioContext && audioContext.state === 'suspended') {
            try {
                await audioContext.resume();
                console.log('AudioContext resumed after visibility change');
            } catch (e) {
                console.log('Failed to resume AudioContext:', e);
            }
        }
    }
});

// Keep AudioContext alive - check every 30 seconds
setInterval(async () => {
    if (audioContext && audioContext.state === 'suspended' && audioUnlocked) {
        try {
            await audioContext.resume();
            console.log('AudioContext keep-alive resumed');
        } catch (e) {}
    }
}, 30000);

setInterval(() => updateDisplay(), 60000);
