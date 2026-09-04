// ── Font catalog – Arial is first (system font, always available) ─────────────
const FONT_CATALOG = [
    "Arial",
    "Roboto",
    "Open Sans",
    "Lato",
    "Montserrat",
    "Oswald",
    "Source Sans Pro",
    "Raleway",
    "PT Sans",
    "Merriweather",
    "Nunito",
    "Playfair Display",
    "Rubik",
    "Lora",
    "Work Sans",
    "Fira Sans",
    "Quicksand",
    "Inter",
    "Outfit",
    "Cabin",
    "Inconsolata",
    "Josefin Sans",
    "DM Sans",
    "Anton"
];

// ── Custom uploaded font data (populated by drag-drop or file picker) ─────────
// Each slot: null | { name: string, base64: string, vfsName: string }
const customFontData = {
    title: null,
    clues: null,
    grid:  null
};

const loadedFonts = new Set();

function loadGoogleFont(fontName) {
    if (!fontName || fontName === 'Arial') return;
    if (loadedFonts.has(fontName)) return;
    const formattedName = fontName.replace(/ /g, '+');
    const link = document.createElement('link');
    link.href = `https://fonts.googleapis.com/css2?family=${formattedName}:wght@400;700&display=swap`;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    loadedFonts.add(fontName);
}

/**
 * Process a dropped or selected .ttf File for a given slot.
 * Injects a @font-face rule for the browser preview and stores the base64
 * payload so pdf-export.js can embed it without a CDN fetch.
 */
function loadCustomFont(slot, file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.ttf')) {
        alert('Please use a .ttf font file.');
        return;
    }

    const reader = new FileReader();
    reader.onload = function (ev) {
        const base64    = ev.target.result.split(',')[1];
        const safeName  = file.name.replace(/[^A-Za-z0-9_.\-]/g, '_');
        const vfsName   = safeName;
        const cssFamName = `CustomFont_${slot}_${safeName}`;

        customFontData[slot] = { name: cssFamName, base64, vfsName };

        // Inject @font-face so the DOM preview updates immediately
        const styleId = `custom-font-face-${slot}`;
        let styleEl = document.getElementById(styleId);
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = `
            @font-face {
                font-family: "${cssFamName}";
                src: url("data:font/truetype;base64,${base64}") format("truetype");
                font-weight: normal;
                font-style: normal;
            }
        `;

        // Update dropzone UI — show success state
        const zone  = document.getElementById(`font-dropzone-${slot}`);
        const label = document.getElementById(`font-upload-label-${slot}`);
        if (zone)  zone.classList.add('has-font');
        if (label) label.innerHTML = `✓ <strong>${file.name}</strong>`;

        window.dispatchEvent(new Event('settingsChanged'));
    };
    reader.readAsDataURL(file);
}

/**
 * Clear the custom font for a slot and reset the dropzone UI.
 */
function clearCustomFont(slot) {
    customFontData[slot] = null;

    const zone  = document.getElementById(`font-dropzone-${slot}`);
    const label = document.getElementById(`font-upload-label-${slot}`);
    const style = document.getElementById(`custom-font-face-${slot}`);

    if (zone)  zone.classList.remove('has-font');
    if (label) label.innerHTML = 'Drop a .ttf here or <u>click to browse</u>';
    if (style) style.textContent = '';

    window.dispatchEvent(new Event('settingsChanged'));
}

/**
 * Wire up a single font dropzone element:
 *   - click anywhere on zone → open hidden file input
 *   - drag .ttf file over → highlight, drop → load font
 *   - × button → clear font
 */
function initDropzone(slot) {
    const zone      = document.getElementById(`font-dropzone-${slot}`);
    const fileInput = document.getElementById(`font-upload-${slot}`);
    const clearBtn  = document.getElementById(`font-upload-clear-${slot}`);

    if (!zone || !fileInput) return;

    // ── Click anywhere on zone (except the clear button) opens file picker ──
    zone.addEventListener('click', (e) => {
        if (e.target === clearBtn || clearBtn.contains(e.target)) return;
        fileInput.click();
    });

    // ── File picker change ──────────────────────────────────────────────────
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadCustomFont(slot, file);
        fileInput.value = ''; // allow re-selecting the same file
    });

    // ── Drag-and-drop events ────────────────────────────────────────────────
    zone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('drag-over');
    });

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', (e) => {
        // Only remove highlight when leaving the zone entirely (not child elements)
        if (!zone.contains(e.relatedTarget)) {
            zone.classList.remove('drag-over');
        }
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            // Accept the first .ttf file dropped
            const ttf = Array.from(files).find(f => f.name.toLowerCase().endsWith('.ttf'));
            if (ttf) {
                loadCustomFont(slot, ttf);
            } else {
                alert('Only .ttf font files are supported. Please drop a .ttf file.');
            }
        }
    });

    // ── Clear button ────────────────────────────────────────────────────────
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // don't trigger zone click → file picker
            clearCustomFont(slot);
        });
    }
}

function initFontPickers() {
    const pickers = document.querySelectorAll('.font-picker');

    pickers.forEach(picker => {
        FONT_CATALOG.forEach(font => {
            const option = document.createElement('option');
            option.value = font;
            option.textContent = font;
            picker.appendChild(option);
        });
        picker.value = 'Arial'; // default

        picker.addEventListener('change', (e) => {
            loadGoogleFont(e.target.value);
            window.dispatchEvent(new Event('settingsChanged'));
        });
    });

    // Wire up all three dropzones
    ['title', 'clues', 'grid'].forEach(slot => initDropzone(slot));
}

document.addEventListener('DOMContentLoaded', initFontPickers);
