// Berlin Prayer Times PWA - Main Application
// ============================================

// Global state
let settings = {
    athanSound: 'makkah',
    dstOffset: 0,
    ramadanMode: false,
    showImsak: true,
    showIftarCountdown: true,
    suhoorReminder: true,
    imsakMinutes: 10,
    autoTheme: true,
    fullscreenMode: false,
    screenAwake: true,
    prayers: {
        fajr: { athan: true, volume: 100, preBefore: 0, preEnabled: false, postAfter: 0, postEnabled: false },
        sunrise: { athan: false, volume: 100, preBefore: 0, preEnabled: false, postAfter: 0, postEnabled: false },
        dhuhr: { athan: true, volume: 100, preBefore: 0, preEnabled: false, postAfter: 0, postEnabled: false },
        asr: { athan: true, volume: 100, preBefore: 0, preEnabled: false, postAfter: 0, postEnabled: false },
        maghrib: { athan: true, volume: 100, preBefore: 0, preEnabled: false, postAfter: 0, postEnabled: false },
        isha: { athan: true, volume: 100, preBefore: 0, preEnabled: false, postAfter: 0, postEnabled: false }
    }
};

let currentCalendarMonth = new Date().getMonth();
let currentCalendarYear = new Date().getFullYear();
let wakeLock = null;
let lastAthanTime = null;
let lastReminderTime = {};
let menuOpen = false;

// Athan audio URLs
const ATHAN_SOURCES = {
    makkah: 'audio/athan-makkah.mp3',
    madinah: 'audio/athan-madinah.mp3',
    mishary: 'audio/athan-mishary.mp3',
    'abdul-basit': 'audio/athan-abdul-basit.mp3'
};

// Format time with Western Arabic numerals
function formatTime(hours, minutes, seconds = null) {
    const h = String(hours).padStart(2, '0');
    const m = String(minutes).padStart(2, '0');
    if (seconds !== null) {
        const s = String(seconds).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }
    return `${h}:${m}`;
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initNavigation();
    initSettings();
    initQiblaCompass();
    updateDisplay();
    startClock();
    applyTheme();
    
    if (settings.screenAwake) {
        requestWakeLock();
    }
    
    // Check for athan every second
    setInterval(checkAthanTime, 1000);
});

// Navigation
function initNavigation() {
    // Menu button
    const menuBtn = document.getElementById('menu-btn');
    const dropdownMenu = document.getElementById('dropdown-menu');
    
    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuOpen = !menuOpen;
        dropdownMenu.classList.toggle('show', menuOpen);
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', () => {
        if (menuOpen) {
            menuOpen = false;
            dropdownMenu.classList.remove('show');
        }
    });
    
    // Menu items
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            showScreen(`${view}-screen`);
            menuOpen = false;
            dropdownMenu.classList.remove('show');
        });
    });
    
    // Back buttons
    document.querySelectorAll('.back-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            showScreen('main-screen');
        });
    });
    
    // Calendar navigation
    document.getElementById('prev-month').addEventListener('click', () => {
        currentCalendarMonth++;
        if (currentCalendarMonth > 11) {
            currentCalendarMonth = 0;
            currentCalendarYear++;
        }
        updateCalendar();
    });
    
    document.getElementById('next-month').addEventListener('click', () => {
        currentCalendarMonth--;
        if (currentCalendarMonth < 0) {
            currentCalendarMonth = 11;
            currentCalendarYear--;
        }
        updateCalendar();
    });
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    
    if (screenId === 'calendar-screen') {
        updateCalendar();
    }
}

// Clock and time updates
function startClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();
    const timeStr = formatTime(now.getHours(), now.getMinutes(), now.getSeconds());
    document.getElementById('current-time').textContent = timeStr;
    
    updateCountdown();
}

function updateDisplay() {
    const now = new Date();
    
    // Update dates
    document.getElementById('hijri-date').textContent = getHijriDateString(now);
    document.getElementById('gregorian-date').textContent = getGregorianDateString(now);
    
    // Get today's prayer times
    const times = getPrayerTimes(now);
    
    // Update prayer times display
    document.getElementById('fajr-time').textContent = times[0];
    document.getElementById('sunrise-time').textContent = times[1];
    document.getElementById('dhuhr-time').textContent = times[2];
    document.getElementById('asr-time').textContent = times[3];
    document.getElementById('maghrib-time').textContent = times[4];
    document.getElementById('isha-time').textContent = times[5];
    
    // Update prayer card states
    updatePrayerCardStates(now, times);
    
    // Update Ramadan display
    updateRamadanDisplay(now, times);
    
    // Update Eid display
    updateEidDisplay(now);
    
    // Apply theme based on time
    if (settings.autoTheme) {
        applyTheme();
    }
}

function updatePrayerCardStates(now, times) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const prayers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
    
    let nextPrayer = null;
    let nextPrayerIndex = -1;
    
    prayers.forEach((prayer, index) => {
        const card = document.querySelector(`[data-prayer="${prayer}"]`);
        const [hours, minutes] = times[index].split(':').map(Number);
        const prayerMinutes = hours * 60 + minutes;
        
        card.classList.remove('passed', 'active', 'next');
        
        if (currentMinutes > prayerMinutes) {
            card.classList.add('passed');
        } else if (nextPrayer === null) {
            nextPrayer = prayer;
            nextPrayerIndex = index;
            card.classList.add('next');
        }
    });
    
    // If all prayers passed, next is Fajr tomorrow
    if (nextPrayer === null) {
        nextPrayer = 'fajr';
        nextPrayerIndex = 0;
    }
    
    document.getElementById('next-prayer-name').textContent = PRAYER_NAMES[nextPrayer];
}

function updateCountdown() {
    const now = new Date();
    const times = getPrayerTimes(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const currentSeconds = now.getSeconds();
    
    const prayers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
    let nextPrayerTime = null;
    let nextPrayerName = null;
    
    for (let i = 0; i < prayers.length; i++) {
        const [hours, minutes] = times[i].split(':').map(Number);
        const prayerMinutes = hours * 60 + minutes;
        
        if (currentMinutes < prayerMinutes || (currentMinutes === prayerMinutes && currentSeconds < 60)) {
            nextPrayerTime = prayerMinutes;
            nextPrayerName = prayers[i];
            break;
        }
    }
    
    // If no prayer found today, use Fajr tomorrow
    if (nextPrayerTime === null) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowTimes = getPrayerTimes(tomorrow);
        const [hours, minutes] = tomorrowTimes[0].split(':').map(Number);
        nextPrayerTime = (24 * 60) + hours * 60 + minutes;
        nextPrayerName = 'fajr';
    }
    
    const diffMinutes = nextPrayerTime - currentMinutes;
    const diffSeconds = (diffMinutes * 60) - currentSeconds;
    
    const hours = Math.floor(diffSeconds / 3600);
    const mins = Math.floor((diffSeconds % 3600) / 60);
    const secs = diffSeconds % 60;
    
    document.getElementById('countdown-timer').textContent = formatTime(hours, mins, secs);
    document.getElementById('next-prayer-name').textContent = PRAYER_NAMES[nextPrayerName];
    
    // Update Iftar countdown if in Ramadan mode
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
        const hours = Math.floor(diff / 60);
        const mins = diff % 60;
        document.getElementById('iftar-countdown').textContent = 
            `الإفطار بعد ${hours}:${String(mins).padStart(2, '0')}`;
    } else {
        document.getElementById('iftar-countdown').textContent = 'حان وقت الإفطار';
    }
}

function updateRamadanDisplay(now, times) {
    const banner = document.getElementById('ramadan-banner');
    
    if (settings.ramadanMode) {
        banner.style.display = 'flex';
        
        const ramadanDay = getRamadanDay(now);
        document.getElementById('fasting-day').textContent = `اليوم ${ramadanDay} من 30`;
        
        if (settings.showImsak) {
            const [fajrHours, fajrMins] = times[0].split(':').map(Number);
            let imsakMins = fajrMins - settings.imsakMinutes;
            let imsakHours = fajrHours;
            if (imsakMins < 0) {
                imsakMins += 60;
                imsakHours--;
            }
            document.getElementById('imsak-time').textContent = formatTime(imsakHours, imsakMins);
            document.getElementById('imsak-display').style.display = 'block';
        } else {
            document.getElementById('imsak-display').style.display = 'none';
        }
    } else {
        banner.style.display = 'none';
    }
}

function updateEidDisplay(now) {
    const eidInfo = getEidInfo(now);
    const banner = document.getElementById('eid-banner');
    
    if (eidInfo.isEid) {
        banner.style.display = 'block';
        document.getElementById('eid-text').textContent = eidInfo.name;
    } else {
        banner.style.display = 'none';
    }
}

// Calendar
function updateCalendar() {
    const monthName = ARABIC_MONTHS[currentCalendarMonth];
    document.getElementById('calendar-month-name').textContent = `${monthName} ${currentCalendarYear}`;
    
    const tbody = document.getElementById('calendar-body');
    tbody.innerHTML = '';
    
    const daysInMonth = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
    const today = new Date();
    
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(currentCalendarYear, currentCalendarMonth, day);
        const times = getPrayerTimes(date);
        
        const row = document.createElement('tr');
        
        const isToday = date.getDate() === today.getDate() && 
                        date.getMonth() === today.getMonth() && 
                        date.getFullYear() === today.getFullYear();
        
        if (isToday) {
            row.classList.add('today');
        }
        
        row.innerHTML = `
            <td>${day}</td>
            <td>${times[0]}</td>
            <td>${times[1]}</td>
            <td>${times[2]}</td>
            <td>${times[3]}</td>
            <td>${times[4]}</td>
            <td>${times[5]}</td>
        `;
        
        tbody.appendChild(row);
    }
}

// Theme
function applyTheme() {
    if (!settings.autoTheme) return;
    
    const now = new Date();
    const hour = now.getHours();
    
    // Day theme between 6 AM and 6 PM
    if (hour >= 6 && hour < 18) {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

// Athan
function checkAthanTime() {
    const now = new Date();
    const times = getPrayerTimes(now);
    const currentTime = formatTime(now.getHours(), now.getMinutes());
    
    const prayers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
    
    prayers.forEach((prayer, index) => {
        const prayerTime = times[index];
        const prayerSettings = settings.prayers[prayer];
        
        // Check if it's time for athan
        if (currentTime === prayerTime && lastAthanTime !== currentTime) {
            if (prayerSettings.athan && prayer !== 'sunrise') {
                playAthan(prayer);
                lastAthanTime = currentTime;
            }
        }
        
        // Check for pre-prayer reminder
        if (prayerSettings.preEnabled && prayerSettings.preBefore > 0) {
            const [pHours, pMins] = prayerTime.split(':').map(Number);
            let reminderMins = pMins - prayerSettings.preBefore;
            let reminderHours = pHours;
            if (reminderMins < 0) {
                reminderMins += 60;
                reminderHours--;
            }
            const reminderTime = formatTime(reminderHours, reminderMins);
            const reminderKey = `pre-${prayer}`;
            
            if (currentTime === reminderTime && lastReminderTime[reminderKey] !== currentTime) {
                playReminder();
                lastReminderTime[reminderKey] = currentTime;
            }
        }
        
        // Check for post-prayer reminder
        if (prayerSettings.postEnabled && prayerSettings.postAfter > 0) {
            const [pHours, pMins] = prayerTime.split(':').map(Number);
            let reminderMins = pMins + prayerSettings.postAfter;
            let reminderHours = pHours;
            if (reminderMins >= 60) {
                reminderMins -= 60;
                reminderHours++;
            }
            const reminderTime = formatTime(reminderHours, reminderMins);
            const reminderKey = `post-${prayer}`;
            
            if (currentTime === reminderTime && lastReminderTime[reminderKey] !== currentTime) {
                playReminder();
                lastReminderTime[reminderKey] = currentTime;
            }
        }
    });
}

function playAthan(prayer) {
    const audio = document.getElementById('athan-audio');
    const prayerSettings = settings.prayers[prayer];
    
    audio.src = ATHAN_SOURCES[settings.athanSound];
    audio.volume = prayerSettings.volume / 100;
    audio.play().catch(err => console.log('Audio play failed:', err));
}

function playReminder() {
    const audio = document.getElementById('reminder-audio');
    audio.src = 'audio/reminder.mp3';
    audio.volume = 0.5;
    audio.play().catch(err => console.log('Reminder play failed:', err));
}

// Qibla Compass
function initQiblaCompass() {
    // Berlin coordinates
    const berlinLat = 52.52;
    const berlinLng = 13.405;
    
    // Kaaba coordinates
    const kaabaLat = 21.4225;
    const kaabaLng = 39.8262;
    
    const qiblaDirection = calculateQibla(berlinLat, berlinLng, kaabaLat, kaabaLng);
    
    // Try to use device orientation
    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', (e) => {
            if (e.alpha !== null) {
                const compass = e.alpha;
                const rotation = qiblaDirection - compass;
                document.getElementById('qibla-needle').style.transform = `rotate(${rotation}deg)`;
            }
        });
    }
    
    // Set initial rotation
    document.getElementById('qibla-needle').style.transform = `rotate(${qiblaDirection}deg)`;
}

function calculateQibla(lat1, lng1, lat2, lng2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;
    
    const x = Math.sin(Δλ);
    const y = Math.cos(φ1) * Math.tan(φ2) - Math.sin(φ1) * Math.cos(Δλ);
    
    let θ = Math.atan2(x, y) * 180 / Math.PI;
    return (θ + 360) % 360;
}

// Settings
function initSettings() {
    // Generate prayer-specific settings
    generatePrayerSettings();
    
    // Athan sound selector
    document.getElementById('athan-sound').addEventListener('change', (e) => {
        settings.athanSound = e.target.value;
        saveSettings();
    });
    
    // Ramadan settings
    document.getElementById('ramadan-mode').addEventListener('change', (e) => {
        settings.ramadanMode = e.target.checked;
        saveSettings();
        updateDisplay();
    });
    
    document.getElementById('show-imsak').addEventListener('change', (e) => {
        settings.showImsak = e.target.checked;
        saveSettings();
        updateDisplay();
    });
    
    document.getElementById('show-iftar-countdown').addEventListener('change', (e) => {
        settings.showIftarCountdown = e.target.checked;
        saveSettings();
    });
    
    document.getElementById('suhoor-reminder').addEventListener('change', (e) => {
        settings.suhoorReminder = e.target.checked;
        saveSettings();
    });
    
    document.getElementById('imsak-minutes').addEventListener('change', (e) => {
        settings.imsakMinutes = parseInt(e.target.value) || 10;
        saveSettings();
        updateDisplay();
    });
    
    // Display settings
    document.getElementById('auto-theme').addEventListener('change', (e) => {
        settings.autoTheme = e.target.checked;
        saveSettings();
        applyTheme();
    });
    
    document.getElementById('fullscreen-mode').addEventListener('change', (e) => {
        settings.fullscreenMode = e.target.checked;
        saveSettings();
        
        if (e.target.checked) {
            document.body.classList.add('fullscreen');
            document.documentElement.requestFullscreen?.();
        } else {
            document.body.classList.remove('fullscreen');
            document.exitFullscreen?.();
        }
    });
    
    document.getElementById('screen-awake').addEventListener('change', (e) => {
        settings.screenAwake = e.target.checked;
        saveSettings();
        
        if (e.target.checked) {
            requestWakeLock();
        } else {
            releaseWakeLock();
        }
    });
    
    // DST offset
    document.getElementById('dst-offset').addEventListener('change', (e) => {
        settings.dstOffset = parseInt(e.target.value);
        saveSettings();
        updateDisplay();
    });
    
    // Load saved values into UI
    loadSettingsToUI();
}

function generatePrayerSettings() {
    const container = document.getElementById('prayer-athan-settings');
    const prayers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
    
    prayers.forEach(prayer => {
        const prayerName = PRAYER_NAMES[prayer];
        const prayerSettings = settings.prayers[prayer];
        
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
                        <span>مستوى الصوت</span>
                        <input type="range" class="volume-slider" min="0" max="100" value="${prayerSettings.volume}">
                    </div>
                    <div class="prayer-control-row">
                        <span>تذكير قبل (دقيقة)</span>
                        <div style="display:flex;gap:5px;align-items:center;">
                            <input type="checkbox" class="pre-enabled" ${prayerSettings.preEnabled ? 'checked' : ''}>
                            <input type="number" class="pre-before" min="0" max="60" value="${prayerSettings.preBefore}">
                        </div>
                    </div>
                    <div class="prayer-control-row">
                        <span>تذكير بعد (دقيقة)</span>
                        <div style="display:flex;gap:5px;align-items:center;">
                            <input type="checkbox" class="post-enabled" ${prayerSettings.postEnabled ? 'checked' : ''}>
                            <input type="number" class="post-after" min="0" max="60" value="${prayerSettings.postAfter}">
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.insertAdjacentHTML('beforeend', html);
    });
    
    // Add event listeners
    container.querySelectorAll('.prayer-setting-item').forEach(item => {
        const prayer = item.dataset.prayer;
        
        item.querySelector('.athan-toggle').addEventListener('change', (e) => {
            settings.prayers[prayer].athan = e.target.checked;
            saveSettings();
        });
        
        item.querySelector('.volume-slider').addEventListener('input', (e) => {
            settings.prayers[prayer].volume = parseInt(e.target.value);
            saveSettings();
        });
        
        item.querySelector('.pre-enabled').addEventListener('change', (e) => {
            settings.prayers[prayer].preEnabled = e.target.checked;
            saveSettings();
        });
        
        item.querySelector('.pre-before').addEventListener('change', (e) => {
            settings.prayers[prayer].preBefore = parseInt(e.target.value) || 0;
            saveSettings();
        });
        
        item.querySelector('.post-enabled').addEventListener('change', (e) => {
            settings.prayers[prayer].postEnabled = e.target.checked;
            saveSettings();
        });
        
        item.querySelector('.post-after').addEventListener('change', (e) => {
            settings.prayers[prayer].postAfter = parseInt(e.target.value) || 0;
            saveSettings();
        });
    });
}

function loadSettingsToUI() {
    document.getElementById('athan-sound').value = settings.athanSound;
    document.getElementById('ramadan-mode').checked = settings.ramadanMode;
    document.getElementById('show-imsak').checked = settings.showImsak;
    document.getElementById('show-iftar-countdown').checked = settings.showIftarCountdown;
    document.getElementById('suhoor-reminder').checked = settings.suhoorReminder;
    document.getElementById('imsak-minutes').value = settings.imsakMinutes;
    document.getElementById('auto-theme').checked = settings.autoTheme;
    document.getElementById('fullscreen-mode').checked = settings.fullscreenMode;
    document.getElementById('screen-awake').checked = settings.screenAwake;
    document.getElementById('dst-offset').value = settings.dstOffset;
}

// Storage
function saveSettings() {
    localStorage.setItem('prayerSettings', JSON.stringify(settings));
}

function loadSettings() {
    const saved = localStorage.getItem('prayerSettings');
    if (saved) {
        const parsed = JSON.parse(saved);
        settings = { ...settings, ...parsed };
    }
}

// Wake Lock (keep screen on)
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock active');
        } catch (err) {
            console.log('Wake Lock failed:', err);
        }
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
        console.log('Wake Lock released');
    }
}

// Re-acquire wake lock when page becomes visible
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && settings.screenAwake) {
        requestWakeLock();
    }
});

// Refresh display every minute
setInterval(() => {
    updateDisplay();
}, 60000);
