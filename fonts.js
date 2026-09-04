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
/**
 * Reads a 16-bit unsigned integer from a DataView at a given byte offset.
 */
function _ttfUint16(view, offset) {
    return view.getUint16(offset, false); // big-endian
}

/**
 * Extract the font family name (nameId=1) or full name (nameId=4) from
 * a TTF/OTF binary's 'name' table.  Returns the first non-empty match,
 * or null if the table can't be parsed.
 *
 * The name table layout (https://docs.microsoft.com/typography/opentype/spec/name):
 *   Offset table  → list of table directory entries  → 'name' table at its offset.
 */
function extractTTFFamilyName(arrayBuffer) {
    try {
        const view  = new DataView(arrayBuffer);
        const numTables = _ttfUint16(view, 4);

        // Walk the offset table to find the 'name' table
        let nameTableOffset = -1;
        for (let i = 0; i < numTables; i++) {
            const base = 12 + i * 16;
            const tag  = String.fromCharCode(
                view.getUint8(base),   view.getUint8(base+1),
                view.getUint8(base+2), view.getUint8(base+3)
            );
            if (tag === 'name') {
                nameTableOffset = view.getUint32(base + 8, false);
                break;
            }
        }
        if (nameTableOffset < 0) return null;

        // name table header
        const count        = _ttfUint16(view, nameTableOffset + 2);
        const stringOffset = _ttfUint16(view, nameTableOffset + 4);
        const storageBase  = nameTableOffset + stringOffset;

        // Collect nameId 1 (Family) and 4 (Full name) records; prefer Windows/Unicode
        const candidates = {};      // nameId → string
        for (let i = 0; i < count; i++) {
            const rec    = nameTableOffset + 6 + i * 12;
            const platformId = _ttfUint16(view, rec);
            const encodingId = _ttfUint16(view, rec + 2);
            const nameId     = _ttfUint16(view, rec + 6);
            if (nameId !== 1 && nameId !== 4) continue;

            const length = _ttfUint16(view, rec + 8);
            const offset = _ttfUint16(view, rec + 10);
            const abs    = storageBase + offset;

            let str = '';
            // Platform 3 (Windows) uses UTF-16BE; Platform 1 (Mac) uses Latin-1
            if (platformId === 3 && encodingId === 1) {
                for (let b = 0; b < length; b += 2) {
                    str += String.fromCharCode(view.getUint16(abs + b, false));
                }
            } else if (platformId === 1) {
                for (let b = 0; b < length; b++) {
                    str += String.fromCharCode(view.getUint8(abs + b));
                }
            }

            str = str.trim();
            if (str) {
                // Prefer nameId 1 (Family); only use 4 if 1 not found
                if (!candidates[nameId]) candidates[nameId] = str;
            }
        }

        return candidates[1] || candidates[4] || null;
    } catch (_) {
        return null;
    }
}

function loadCustomFont(slot, file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.ttf') &&
        !file.name.toLowerCase().endsWith('.otf')) {
        alert('Please use a .ttf font file.');
        return;
    }

    const reader = new FileReader();
    reader.onload = function (ev) {
        const arrayBuffer = ev.target.result;

        // ── Extract the real font family name from the TTF binary ─────────────
        // This is the name Illustrator / Affinity will recognise.
        const realFamilyName = extractTTFFamilyName(arrayBuffer);

        // Derive base64 from the same ArrayBuffer
        const uint8  = new Uint8Array(arrayBuffer);
        let binary   = '';
        const CHUNK  = 8192;
        for (let i = 0; i < uint8.length; i += CHUNK) {
            binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
        }
        const base64 = btoa(binary);

        const safeName   = file.name.replace(/[^A-Za-z0-9_.\-]/g, '_');
        const vfsName    = safeName;
        // Use the real family name if we could extract it, otherwise a safe fallback
        const cssFamName = realFamilyName || `CustomFont_${slot}_${safeName}`;

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

        // Update dropzone UI — show success state with real font name
        const zone  = document.getElementById(`font-dropzone-${slot}`);
        const label = document.getElementById(`font-upload-label-${slot}`);
        if (zone)  zone.classList.add('has-font');
        const displayName = realFamilyName ? `${file.name} → "${realFamilyName}"` : file.name;
        if (label) label.innerHTML = `✓ <strong>${displayName}</strong>`;

        window.dispatchEvent(new Event('settingsChanged'));
    };
    // Read as ArrayBuffer so we can both parse the name table AND encode to base64
    reader.readAsArrayBuffer(file);
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
