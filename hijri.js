// Hijri Calendar Conversion
// Uses Western Arabic numerals (0-9)

const HIJRI_MONTHS = [
    'محرم', 'صفر', 'ربيع الأول', 'ربيع الثاني',
    'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان',
    'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'
];

function gregorianToHijri(gYear, gMonth, gDay) {
    // Julian Day Number calculation
    let a = Math.floor((14 - gMonth) / 12);
    let y = gYear + 4800 - a;
    let m = gMonth + 12 * a - 3;
    
    let jd = gDay + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
    
    // Hijri calculation
    let l = jd - 1948440 + 10632;
    let n = Math.floor((l - 1) / 10631);
    l = l - 10631 * n + 354;
    
    let j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
    l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
    
    let hMonth = Math.floor((24 * l) / 709);
    let hDay = l - Math.floor((709 * hMonth) / 24);
    let hYear = 30 * n + j - 30;
    
    return {
        year: hYear,
        month: hMonth,
        day: hDay,
        monthName: HIJRI_MONTHS[hMonth - 1]
    };
}

function getHijriDateString(date, offset) {
    const adjusted = new Date(date);
    adjusted.setDate(adjusted.getDate() + (offset || 0));
    const hijri = gregorianToHijri(adjusted.getFullYear(), adjusted.getMonth() + 1, adjusted.getDate());
    return `${hijri.day} ${hijri.monthName} ${hijri.year} هـ`;
}

function getAdjustedHijri(date, offset) {
    const adjusted = new Date(date);
    adjusted.setDate(adjusted.getDate() + (offset || 0));
    return gregorianToHijri(adjusted.getFullYear(), adjusted.getMonth() + 1, adjusted.getDate());
}

function getGregorianDateString(date) {
    const day = date.getDate();
    const month = ARABIC_MONTHS[date.getMonth()];
    const year = date.getFullYear();
    const dayName = ARABIC_DAYS[date.getDay()];
    return `${dayName} ${day} ${month}`;
}
