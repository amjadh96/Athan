const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'www');

// Clean www
if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
fs.mkdirSync(dest, { recursive: true });

// Copy web files
const files = [
    'index.html', 'app.js', 'styles.css', 'prayer-data.js', 'hijri.js',
    'sw.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png',
    'capacitor-bridge.js'
];
files.forEach(f => {
    const src = path.join(root, f);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(dest, f));
    }
});

// Copy audio directory recursively
function copyDir(srcDir, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir)) {
        const srcPath = path.join(srcDir, entry);
        const destPath = path.join(destDir, entry);
        if (fs.statSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

const audioSrc = path.join(root, 'audio');
if (fs.existsSync(audioSrc)) {
    copyDir(audioSrc, path.join(dest, 'audio'));
}

console.log('www/ directory prepared successfully.');
