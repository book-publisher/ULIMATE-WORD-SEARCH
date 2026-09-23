/**
 * pdf-export.js  –  Text-to-Outlines PDF rendering (Book Bolt / Canva style)
 *
 * ALL text (title, grid letters, clue words) is converted to vector bezier paths
 * before being written to the PDF — exactly like Book Bolt Studio, Canva, and KDP
 * web builders do. This means:
 *   - NO font resources are embedded in the PDF
 *   - NO font-not-found errors on any PDF viewer or print shop
 *   - Text is 100% portable, print-ready, and cannot reflow
 *
 * How it works:
 *   1. opentype.js parses the TTF binary (from CDN or custom upload).
 *  2. otFont.getPath(text, x, y, size) returns raw glyph bezier contours
 *      (M/L/C/Q/Z commands in point coordinates).
 *  3. We write those commands to the PDF stream using jsPDF's internal API,
 *      using the NONZERO winding fill rule (f) so glyph holes (O, B, R, etc.)
 *      render correctly AND overlapping contours (Bebas/Anton-style display
 *      fonts) stay solid with no white gaps.
 *
 * Fallback: Arial / helvetica → jsPDF native pdf.text() (always-present built-in).
 *
 * Font loading priority:
 *   1. User-uploaded custom .ttf (base64 in settings.fontXxxCustom)
 *   2. Google Font fetched from Fontsource CDN → parsed by opentype.js
 *   3. Fallback: helvetica built-in (Arial or any unfetchable font)
 */

// ── Direct TTF source map – Fontsource font-files repo via jsDelivr CDN ───────
const FONT_SLUGS = {
    'Roboto':           'roboto',
    'Open Sans':        'open-sans',
    'Lato':             'lato',
    'Montserrat':       'montserrat',
    'Oswald':           'oswald',
    'Source Sans Pro':  'source-sans-pro',
    'Raleway':          'raleway',
    'PT Sans':          'pt-sans',
    'Merriweather':     'merriweather',
    'Nunito':           'nunito',
    'Playfair Display': 'playfair-display',
    'Rubik':            'rubik',
    'Lora':             'lora',
    'Work Sans':        'work-sans',
    'Fira Sans':        'fira-sans',
    'Quicksand':        'quicksand',
    'Inter':            'inter',
    'Outfit':           'outfit',
    'Cabin':            'cabin',
    'Inconsolata':      'inconsolata',
    'Josefin Sans':     'josefin-sans',
    'DM Sans':          'dm-sans',
    'Anton':            'anton',
};

function buildFontUrlCandidates(fontName, weight) {
    // weight: 400 (regular) or 700 (bold)
    const slug = FONT_SLUGS[fontName];
    if (!slug) return [];
    const pascal      = fontName.replace(/[^A-Za-z0-9]/g, '');
    const slugCompact = slug.replace(/-/g, '');
    const licenseDirs = ['ofl', 'apache', 'ufl'];

    const urls = [];

    if (weight === 700) {
        // Bold variants — try all known naming patterns
        urls.push(`https://cdn.jsdelivr.net/gh/fontsource/font-files@main/fonts/google/${slug}/ttf/${slug}-700-normal.ttf`);
        licenseDirs.forEach(dir => {
            urls.push(`https://cdn.jsdelivr.net/gh/google/fonts@main/${dir}/${slugCompact}/static/${pascal}-Bold.ttf`);
            urls.push(`https://cdn.jsdelivr.net/gh/google/fonts@main/${dir}/${slugCompact}/${pascal}-Bold.ttf`);
            urls.push(`https://cdn.jsdelivr.net/gh/google/fonts@main/${dir}/${slugCompact}/static/${pascal}SemiBold.ttf`);
            urls.push(`https://cdn.jsdelivr.net/gh/google/fonts@main/${dir}/${slugCompact}/static/${pascal}-SemiBold.ttf`);
        });
        // Fallback to regular if bold not found
        urls.push(`https://cdn.jsdelivr.net/gh/fontsource/font-files@main/fonts/google/${slug}/ttf/${slug}-400-normal.ttf`);
        licenseDirs.forEach(dir => {
            urls.push(`https://cdn.jsdelivr.net/gh/google/fonts@main/${dir}/${slugCompact}/static/${pascal}-Regular.ttf`);
            urls.push(`https://cdn.jsdelivr.net/gh/google/fonts@main/${dir}/${slugCompact}/${pascal}-Regular.ttf`);
        });
    } else {
        // Regular (400)
        urls.push(`https://cdn.jsdelivr.net/gh/fontsource/font-files@main/fonts/google/${slug}/ttf/${slug}-400-normal.ttf`);
        licenseDirs.forEach(dir => {
            urls.push(`https://cdn.jsdelivr.net/gh/google/fonts@main/${dir}/${slugCompact}/static/${pascal}-Regular.ttf`);
            urls.push(`https://cdn.jsdelivr.net/gh/google/fonts@main/${dir}/${slugCompact}/${pascal}-Regular.ttf`);
        });
    }
    return urls;
}

// ── Per-session cache: cacheKey → { otFont } | 'failed' ──────────────────────
// cacheKey = fontName + ':' + weight  (e.g. 'Oswald:700', 'Roboto:400')
const _otFontCache = {};

async function fetchAndParseFont(fontName, weight) {
    weight = weight || 400;
    if (!fontName || fontName === 'Arial') return null;
    const cacheKey = `${fontName}:${weight}`;
    if (_otFontCache[cacheKey] === 'failed') return null;
    if (_otFontCache[cacheKey]) return _otFontCache[cacheKey];

    const urls = buildFontUrlCandidates(fontName, weight);
    if (urls.length === 0) {
        _otFontCache[cacheKey] = 'failed';
        return null;
    }
    for (const url of urls) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const buffer = await resp.arrayBuffer();
            if (!buffer || buffer.byteLength < 200) continue;
            const otFont = opentype.parse(buffer);
            _otFontCache[cacheKey] = { otFont };
            console.info(`[pdf-export] Font loaded: "${fontName}" w${weight} (${(buffer.byteLength/1024).toFixed(0)} KB)`);
            return _otFontCache[cacheKey];
        } catch (err) {
            console.warn(`[pdf-export] Failed: "${fontName}" w${weight} from ${url}: ${err.message}`);
        }
    }
    _otFontCache[cacheKey] = 'failed';
    return null;
}

function parseCustomFontOpentype(customPayload) {
    if (!customPayload || !customPayload.base64) return null;
    // Cache by content (vfsName alone collides when the same filename is
    // uploaded to several slots, or when a file is replaced). base64 length
    // + a short prefix hash is enough to disambiguate in-session.
    const b64 = customPayload.base64;
    let prefix = '';
    for (let i = 0; i < Math.min(32, b64.length); i++) prefix += b64[i];
    const cacheKey = '__custom__' + (customPayload.vfsName || 'font')
        + '__' + b64.length + '__' + prefix.length + '_' + prefix.slice(0, 16);
    if (_otFontCache[cacheKey]) return _otFontCache[cacheKey];
    try {
        const binary = atob(b64);
        const buffer = new ArrayBuffer(binary.length);
        const uint8  = new Uint8Array(buffer);
        for (let i = 0; i < binary.length; i++) uint8[i] = binary.charCodeAt(i);
        const otFont = opentype.parse(buffer);
        _otFontCache[cacheKey] = { otFont };
        console.info(`[pdf-export] Custom font parsed: "${customPayload.name || customPayload.vfsName}" (${(buffer.byteLength/1024).toFixed(0)} KB, ${otFont.glyphs.length} glyphs)`);
        return _otFontCache[cacheKey];
    } catch (err) {
        console.warn(`[pdf-export] Could not parse custom font: ${err.message}`);
        return null;
    }
}

// weight: 400 = regular, 700 = bold
async function resolveOTFont(fontName, customPayload, weight) {
    weight = weight || 400;
    if (customPayload && customPayload.base64) {
        // Custom uploaded font — use as-is (single TTF file, weight is baked in)
        const entry = parseCustomFontOpentype(customPayload);
        if (entry) return entry.otFont;
    }
    if (!fontName || fontName === 'Arial') return null;
    const entry = await fetchAndParseFont(fontName, weight);
    return entry ? entry.otFont : null;
}

// ── Convert a data-URL to a base64 string + mimeType ─────────────────────────
function parseDataUrl(dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return { mime: match[1], base64: match[2] };
}

// ── DOWNLOAD-PHASE display lookup (spaces kept) ──────────────────────────────
// Mirrors generator.js logic locally so export works even if placedWords were
// created by an older session without `display`.
function _pdfGridForm(w) {
    return String(w == null ? '' : w)
        .replace(/ß/g, 'SS')
        .replace(/ä/gi, 'Ä').replace(/ö/gi, 'Ö').replace(/ü/gi, 'Ü')
        .toUpperCase().replace(/[^A-ZÄÖÜ]/g, '');
}
function _pdfDisplayForm(w) {
    let d = String(w == null ? '' : w)
        .replace(/ß/g, 'SS')
        .replace(/ä/gi, 'Ä').replace(/ö/gi, 'Ö').replace(/ü/gi, 'Ü')
        .toUpperCase().replace(/\s+/g, ' ').trim();
    d = d.replace(/[^A-ZÄÖÜ \-']/g, '').replace(/\s+/g, ' ').trim();
    return d || _pdfGridForm(w);
}
function getClueDisplayList(placedWords, settings) {
    // Build grid → display map from the ORIGINAL user list (with spaces)
    const map = {};
    (settings.words || []).forEach(raw => {
        const g = _pdfGridForm(raw);
        if (g && !map[g]) map[g] = _pdfDisplayForm(raw);
    });
    return (placedWords || []).map(p => {
        if (p.display && p.display.trim()) return p.display;
        const g = p.word || '';
        if (map[g]) return map[g];                    // "BALLJOINT" → "BALL JOINT"
        // Fallback: insert nothing — keep grid form rather than blank
        return g;
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CORE: Draw text as vector outlines — the Book Bolt / Canva method
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * drawOutlineText — renders text as filled bezier vector paths into jsPDF.
 *
 * @param {jsPDF}         pdf        – jsPDF document instance
 * @param {opentype.Font} otFont     – parsed opentype.js Font (null → helvetica fallback)
 * @param {string}        text       – string to draw
 * @param {number}        xIn        – x position in inches
 * @param {number}        yIn        – y baseline in inches
 * @param {number}        fontSizePt – font size in PDF points (1pt = 1/72 in)
 * @param {number[]}      fillRGB    – [r, g, b] 0-255
 * @param {string}        align      – 'left' | 'center' | 'right'
 */
function drawOutlineText(pdf, otFont, text, xIn, yIn, fontSizePt, fillRGB, align) {
    if (!text) return;
    fillRGB = fillRGB || [0, 0, 0];

    // Fallback for Arial / unfetchable fonts: use jsPDF's built-in helvetica
    if (!otFont) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(fontSizePt);
        pdf.setTextColor(fillRGB[0], fillRGB[1], fillRGB[2]);
        pdf.text(text, xIn, yIn, { align: align || 'left' });
        return;
    }

    const IN2PT = 72; // 1 inch = 72 points
    const scale = fontSizePt / otFont.unitsPerEm;

    // Measure string width for alignment — use kerning-aware advance width
    // so centered/right text lands exactly where the browser preview puts it.
    let totalWidthIn;
    try {
        const advPt = otFont.getAdvanceWidth(text, fontSizePt); // points, kerning included
        totalWidthIn = advPt / IN2PT;
    } catch (_) {
        const glyphs = otFont.stringToGlyphs(text);
        let totalAdv = 0;
        glyphs.forEach(g => { totalAdv += (g.advanceWidth || 0); });
        totalWidthIn = (totalAdv * scale) / IN2PT;
    }

    let startXIn = xIn;
    if (align === 'center') startXIn = xIn - totalWidthIn / 2;
    else if (align === 'right') startXIn = xIn - totalWidthIn;

    // Get glyph path from opentype.js (coordinates in PDF points)
    const otPath = otFont.getPath(text, startXIn * IN2PT, yIn * IN2PT, fontSizePt);
    if (!otPath || !otPath.commands || otPath.commands.length === 0) return;

    // ── Write path to PDF stream ──────────────────────────────────────────────
    // jsPDF 'in' unit: scaleFactor k = 72 (points per inch)
    // PDF coord system: origin bottom-left, Y up.
    // jsPDF flips Y when you use pdf.text() but NOT for raw stream ops.
    // We flip manually: pdfY = (pageH_in - y_in) * k
    const internal = pdf.internal;
    const k        = internal.scaleFactor;          // = 72 for 'in' unit
    const pageH    = internal.pageSize.getHeight(); // page height in inches

    // RGB colour for fill (0–1 range in PDF)
    const r = (fillRGB[0] / 255).toFixed(4);
    const g = (fillRGB[1] / 255).toFixed(4);
    const b = (fillRGB[2] / 255).toFixed(4);

    // Build the raw PDF path string
    // px/py: convert opentype point-space coords → jsPDF PDF user-space
    // Y-flip: pdfY = (pageH_in - y_pt/72) * k
    const px = v => ((v / IN2PT) * k).toFixed(4);
    const py = v => ((pageH - v / IN2PT) * k).toFixed(4);

    const parts = [];

    // Track pen position for correct quadratic → cubic conversion.
    // TrueType fonts use quadratic splines (Q commands). The correct
    // de Casteljau upgrade from quadratic to cubic requires the START point:
    //   cp1 = penStart + (2/3) * (ctrl - penStart)
    //   cp2 = endPoint + (2/3) * (ctrl - endPoint)
    // The old code used (ctrl, ctrl, end) which is a degenerate cubic
    // that produces self-intersecting paths → white gaps, broken bowls.
    let penX = 0, penY = 0;  // current pen position in opentype point-space

    for (const cmd of otPath.commands) {
        switch (cmd.type) {
            case 'M':
                parts.push(`${px(cmd.x)} ${py(cmd.y)} m`);
                penX = cmd.x;
                penY = cmd.y;
                break;
            case 'L':
                parts.push(`${px(cmd.x)} ${py(cmd.y)} l`);
                penX = cmd.x;
                penY = cmd.y;
                break;
            case 'C':
                parts.push(`${px(cmd.x1)} ${py(cmd.y1)} ${px(cmd.x2)} ${py(cmd.y2)} ${px(cmd.x)} ${py(cmd.y)} c`);
                penX = cmd.x;
                penY = cmd.y;
                break;
            case 'Q': {
                // Correct quadratic (TrueType) → cubic (PDF) conversion via de Casteljau:
                //   cp1 = pen  + (2/3) * (ctrl - pen)
                //   cp2 = end  + (2/3) * (ctrl - end)
                const cp1x = penX + (2 / 3) * (cmd.x1 - penX);
                const cp1y = penY + (2 / 3) * (cmd.y1 - penY);
                const cp2x = cmd.x + (2 / 3) * (cmd.x1 - cmd.x);
                const cp2y = cmd.y + (2 / 3) * (cmd.y1 - cmd.y);
                parts.push(`${px(cp1x)} ${py(cp1y)} ${px(cp2x)} ${py(cp2y)} ${px(cmd.x)} ${py(cmd.y)} c`);
                penX = cmd.x;
                penY = cmd.y;
                break;
            }
            case 'Z':
                parts.push('h');
                // After closepath the pen returns to the start of the current sub-path.
                // opentype.js always follows Z with an M if another sub-path begins,
                // so we don't need to track the sub-path origin separately.
                break;
        }
    }

    if (parts.length === 0) return;

    // NONZERO winding fill (f) — NOT even-odd (f*).
    // Why: display fonts like Bebas Neue / Anton / Oswald build letters from
    // OVERLAPPING contours (stem + bowl overlap). Even-odd un-fills every
    // overlap region, which renders as thin white gaps slicing through D, B,
    // O, Q, K, L, etc. — exactly the "broken letters" bug. Nonzero keeps
    // same-direction overlaps filled while still cutting real counters
    // (holes), because genuine holes are wound opposite to their outer
    // contour in the font file. Y-flip preserves this relative winding
    // (all contours flip together), so `f` is correct for both TTF (Q) and
    // OTF/CFF (C) outlines. This matches Book Bolt / Canva outline export.
    parts.push('f');

    // Wrap in q/Q to isolate graphics state; set fill colour before path
    internal.write(`q ${r} ${g} ${b} rg ${parts.join(' ')} Q`);
}

/**
 * drawClueOutlineWithSpaces — DOWNLOAD PHASE ONLY.
 * After download there is no text anymore, only vectors. A normal space glyph
 * draws NOTHING (no contours) and some display fonts ship a zero-width space,
 * so "BALL JOINT" collapses to "BALLJOINT" in the outline PDF even though the
 * string is correct. Fix: split on spaces and draw each chunk as its own
 * vector group with an explicit, guaranteed gap. Whole clue stays centered.
 */
function drawClueOutlineWithSpaces(pdf, otFont, text, cxIn, cyIn, fontSizePt, fillRGB) {
    if (!text) return;
    // Fallback path (helvetica): real text engine, spaces work natively.
    if (!otFont) {
        drawOutlineText(pdf, null, text, cxIn, cyIn, fontSizePt, fillRGB, 'center');
        return;
    }
    const chunks = String(text).split(' ').filter(ch => ch.length > 0);
    if (chunks.length <= 1) {
        drawOutlineText(pdf, otFont, text, cxIn, cyIn, fontSizePt, fillRGB, 'center');
        return;
    }
    const IN2PT = 72;
    function advPt(str) {
        try {
            const w = otFont.getAdvanceWidth(str, fontSizePt);
            if (w && isFinite(w) && w > 0) return w;
        } catch (_) {}
        // Rough fallback: ~0.6em per character
        return str.length * fontSizePt * 0.6;
    }
    let spacePt = 0;
    try {
        spacePt = otFont.getAdvanceWidth(' ', fontSizePt);
    } catch (_) { spacePt = 0; }
    // Guarantee a VISIBLE gap even if the font's space is missing/zero-width.
    // 0.35em is clearly visible at 11pt yet keeps clues inside their column.
    const minSpacePt = fontSizePt * 0.35;
    if (!spacePt || !isFinite(spacePt) || spacePt < minSpacePt) spacePt = minSpacePt;

    const tokenPts = chunks.map(advPt);
    const totalPt = tokenPts.reduce((a, b) => a + b, 0) + spacePt * (chunks.length - 1);
    let cursorIn = cxIn - (totalPt / IN2PT) / 2;
    chunks.forEach((tok, i) => {
        drawOutlineText(pdf, otFont, tok, cursorIn, cyIn, fontSizePt, fillRGB, 'left');
        cursorIn += tokenPts[i] / IN2PT;
        if (i < chunks.length - 1) cursorIn += spacePt / IN2PT;
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main export entry point
// ═══════════════════════════════════════════════════════════════════════════════
async function generatePDF(puzzlesData, trimSizeStr, solutionsPerPage, pageMargin) {
    const { jsPDF } = window.jspdf;

    let W, H;
    if      (trimSizeStr === '8.5x11')  { W = 8.5;  H = 11;    }
    else if (trimSizeStr === '6x9')     { W = 6;    H = 9;     }
    else if (trimSizeStr === '8.5x8.5') { W = 8.5;  H = 8.5;   }
    else if (trimSizeStr === 'A4')      { W = 8.27; H = 11.69; }
    else                                { W = 8.5;  H = 11;    }

    const pdf = new jsPDF({
        orientation: W > H ? 'landscape' : 'portrait',
        unit: 'in',
        format: [W, H]
    });

    const MARGIN  = (typeof pageMargin === 'number' && pageMargin > 0) ? pageMargin : 0.375;
    const usableW = W - 2 * MARGIN;
    const usableH = H - 2 * MARGIN;

    // ── Collect unique Google Font names to prefetch ───────────────────────────
    const googleFontsNeeded = new Set();
    puzzlesData.forEach(pd => {
        const s = pd.settings;
        if (!s.fontTitleCustom && s.fontTitleDropdown && s.fontTitleDropdown !== 'Arial') googleFontsNeeded.add(s.fontTitleDropdown);
        if (!s.fontCluesCustom && s.fontCluesDropdown && s.fontCluesDropdown !== 'Arial') googleFontsNeeded.add(s.fontCluesDropdown);
        if (!s.fontGridCustom  && s.fontGridDropdown  && s.fontGridDropdown  !== 'Arial') googleFontsNeeded.add(s.fontGridDropdown);
    });

    // Phase 1: fetch & parse all fonts in parallel via opentype.js
    // Title uses Bold (700) — must match browser's font-weight:bold rendering.
    // Grid and Clues use Regular (400) — matches browser's normal weight rendering.
    await Promise.all([
        ...[...googleFontsNeeded].map(name => fetchAndParseFont(name, 400)),
        ...[...googleFontsNeeded].map(name => fetchAndParseFont(name, 700)),
    ]);

    // Phase 2: resolve opentype.Font objects for each slot
    // Title → Bold (700) to match the browser's bold title rendering
    // Clues → Regular (400)
    // Grid  → Regular (400)
    const refSettings = puzzlesData[0]?.settings || {};
    const titleOTFont = await resolveOTFont(refSettings.fontTitleDropdown, refSettings.fontTitleCustom, 700);
    const cluesOTFont = await resolveOTFont(refSettings.fontCluesDropdown, refSettings.fontCluesCustom, 400);
    const gridOTFont  = await resolveOTFont(refSettings.fontGridDropdown,  refSettings.fontGridCustom,  400);

    console.info('[pdf-export] Text-to-Outlines mode active — all text rendered as bezier vector paths.');

    // ── Helper: draw a single full puzzle page ────────────────────────────────
    function drawPuzzlePage(puzzleData, puzzleNum, isSolution) {
        const s      = puzzleData.settings;
        const result = puzzleData.result;
        const grid   = result.grid;
        const rows   = s.rows;
        const cols   = s.cols;

        const LANG_LABELS_PDF = {
            en: { puzzle: 'PUZZLE',      solution: 'SOLUTION' },
            fr: { puzzle: 'CASSE-T\u00CATE', solution: 'SOLUTION' },
            de: { puzzle: 'R\u00C4TSEL',    solution: 'L\u00D6SUNG'  }
        };
        const lang   = s.language || 'en';
        const labels = LANG_LABELS_PDF[lang] || LANG_LABELS_PDF.en;

        // ── Background image (puzzle pages only) ──────────────────────────────
        if (!isSolution && s.bgImageData) {
            try {
                const parsed = parseDataUrl(s.bgImageData);
                if (parsed) {
                    const fmt = parsed.mime.includes('jpeg') || parsed.mime.includes('jpg') ? 'JPEG' : 'PNG';
                    pdf.addImage(parsed.base64, fmt, 0, 0, W, H);
                }
            } catch (err) {
                console.warn('[pdf-export] Could not draw background image:', err.message);
            }
        }

        // ── Title text — always UPPERCASE ─────────────────────────────────────
        let titleText;
        if (isSolution) {
            titleText = `${labels.solution} #${puzzleNum}`;
        } else if (s.showTitle === false) {
            titleText = null;
        } else if (s.titleManuallyEdited && s.title) {
            titleText = s.title.toUpperCase();
        } else {
            titleText = `${labels.puzzle} #${puzzleNum}`;
        }

        // ── Grid geometry ─────────────────────────────────────────────────────
        const contentScale  = (s.contentScale !== undefined && s.contentScale > 0) ? s.contentScale : 1;
        const panelInset    = 1.0;
        const panelX        = panelInset;
        const panelY        = panelInset;
        const panelW        = W - 2 * panelInset;
        const panelH        = H - 2 * panelInset;
        const innerPad      = MARGIN;
        const usablePanelW  = panelW - 2 * innerPad;
        const usablePanelH  = panelH - 2 * innerPad;

        const titleH         = titleText !== null ? 0.5 : 0;
        const clueAreaHeight = (() => {
            const nWords = result.placedWords.length;
            const nRows  = Math.ceil(nWords / s.clueCols);
            const lh     = 11 / 72 + 0.12;
            return 0.35 + nRows * lh + 0.2;
        })();

        const maxGridH = usablePanelH * contentScale - titleH - clueAreaHeight;
        const maxGridW = usablePanelW * contentScale;
        const cellSize = Math.min(maxGridW / cols, maxGridH / rows);
        const gridW    = cellSize * cols;
        const gridH    = cellSize * rows;
        const contentH = titleH + gridH + clueAreaHeight;
        const blockTopY = panelY + innerPad + (usablePanelH - contentH) / 2;
        const titleY    = blockTopY + (titleText !== null ? 0.3 : 0);
        const gridY     = blockTopY + titleH;
        const gridX     = panelX + innerPad + (usablePanelW - gridW) / 2;

        // ── White rounded panel (when background image is set) ────────────────
        if (!isSolution && s.bgImageData) {
            const panelRadius = 0.15;
            const whiteOp = (s.bgOpacity !== undefined && s.bgOpacity !== null)
                ? Math.max(0, Math.min(1, s.bgOpacity)) : 0.94;
            try {
                pdf.setFillColor(255, 255, 255);
                pdf.setDrawColor(255, 255, 255);
                pdf.setGState(pdf.GState({ opacity: whiteOp }));
                pdf.roundedRect(panelX, panelY, panelW, panelH, panelRadius, panelRadius, 'F');
                pdf.setGState(pdf.GState({ opacity: 1.0 }));
            } catch (_) {}
        }

        // ── Title — VECTOR OUTLINES ───────────────────────────────────────────
        if (titleText !== null) {
            let titleX, titleAlign;
            if (s.titlePlacement === 'left')       { titleX = panelX + innerPad;           titleAlign = 'left';   }
            else if (s.titlePlacement === 'right')  { titleX = panelX + panelW - innerPad; titleAlign = 'right';  }
            else                                    { titleX = panelX + panelW / 2;        titleAlign = 'center'; }
            drawOutlineText(pdf, titleOTFont, titleText, titleX, titleY, 22, [0, 0, 0], titleAlign);
        }

        // ── Grid border ───────────────────────────────────────────────────────
        if (s.showBorder) {
            pdf.setDrawColor(0, 0, 0);
            pdf.setLineWidth(0.02);
            pdf.rect(gridX, gridY, gridW, gridH);
        }

        // ── Grid letters — VECTOR OUTLINES ────────────────────────────────────
        const letterFontSize = Math.min(cellSize * 72 * 0.55, 18);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cx = gridX + c * cellSize + cellSize / 2;
                const cy = gridY + r * cellSize + cellSize / 2 + (letterFontSize / 72) * 0.35;
                drawOutlineText(pdf, gridOTFont, String(grid[r][c]), cx, cy, letterFontSize, [0, 0, 0], 'center');
            }
        }

        // ── Solution grid border — 1pt ────────────────────────────────────────
        if (isSolution && s.showBorder) {
            pdf.setDrawColor(0, 0, 0);
            pdf.setLineWidth(1 / 72);   // exactly 1pt
            pdf.rect(gridX, gridY, gridW, gridH);
        }

        // ── Solution word-highlight pills — 0.5pt stroke ──────────────────────
        if (isSolution) {
            pdf.setDrawColor(0, 0, 0);
            pdf.setLineWidth(0.5 / 72);   // exactly 0.5pt
            pdf.setFillColor(255, 255, 255);

            result.placedWords.forEach(pw => {
                const path = pw.path;
                if (path.length === 0) return;
                const startR = path[0][0], startC = path[0][1];
                const endR   = path[path.length-1][0], endC = path[path.length-1][1];
                const x1 = gridX + startC * cellSize + cellSize / 2;
                const y1 = gridY + startR * cellSize + cellSize / 2;
                const x2 = gridX + endC   * cellSize + cellSize / 2;
                const y2 = gridY + endR   * cellSize + cellSize / 2;
                const mx = (x1+x2)/2, my = (y1+y2)/2;
                const wordLen = Math.sqrt((x2-x1)**2 + (y2-y1)**2) + cellSize * 0.9;
                drawRotatedRoundedRect(pdf, mx, my, wordLen, cellSize*0.84, cellSize*0.42, Math.atan2(y2-y1,x2-x1));
            });
        }

        // ── Clue words — VECTOR OUTLINES ─────────────────────────────────────
        // DOWNLOAD PHASE ONLY: always show the ORIGINAL list appearance
        // ("BALL JOINT", not "BALLJOINT"). Preview already does this via
        // p.display — but old sessions / cached puzzles may have placedWords
        // with only {word: "BALLJOINT"}. So reconstruct display from the
        // raw word list (s.words) by matching grid forms. This touches ONLY
        // the export; grid placement is unchanged.
        const clueStartY   = gridY + gridH + 0.35;
        const clueFontSize = 11;
        const sortedWords  = getClueDisplayList(result.placedWords, s)
            .sort((a, b) => a.localeCompare(b));
        const colWidth     = usablePanelW / s.clueCols;
        const lineHeight   = clueFontSize / 72 + 0.12;

        sortedWords.forEach((word, idx) => {
            const col = idx % s.clueCols;
            const row = Math.floor(idx / s.clueCols);
            const cx  = panelX + innerPad + col * colWidth + colWidth / 2;
            const cy  = clueStartY + row * lineHeight;
            if (cy < panelY + panelH - innerPad) {
                // Separated vectors: guarantees the space survives as vectors
                drawClueOutlineWithSpaces(pdf, cluesOTFont, word, cx, cy, clueFontSize, [0, 0, 0]);
            }
        });
    }

    // ── Rotated pill outline helper (stroke weight set by caller) ─────────────
    function drawRotatedRoundedRect(doc, cx, cy, w, h, r, angle) {
        r = Math.min(r, w / 2, h / 2);
        const hw  = w / 2, hh = h / 2;
        const cos = Math.cos(angle), sin = Math.sin(angle);

        function rot(lx, ly) { return [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos]; }

        const corners = [
            { cx: -hw + r, cy: -hh + r },
            { cx:  hw - r, cy: -hh + r },
            { cx:  hw - r, cy:  hh - r },
            { cx: -hw + r, cy:  hh - r },
        ];

        const startP   = rot(-hw + r, -hh);
        const arcSteps = 8;
        const segments = [];

        segments.push(rot(hw - r, -hh));
        for (let i = 1; i <= arcSteps; i++) {
            const t = (i / arcSteps) * Math.PI / 2;
            segments.push(rot(corners[1].cx + r * Math.cos(Math.PI * 1.5 + t), corners[1].cy + r * Math.sin(Math.PI * 1.5 + t)));
        }
        segments.push(rot(hw, hh - r));
        for (let i = 1; i <= arcSteps; i++) {
            const t = (i / arcSteps) * Math.PI / 2;
            segments.push(rot(corners[2].cx + r * Math.cos(t), corners[2].cy + r * Math.sin(t)));
        }
        segments.push(rot(-hw + r, hh));
        for (let i = 1; i <= arcSteps; i++) {
            const t = (i / arcSteps) * Math.PI / 2;
            segments.push(rot(corners[3].cx + r * Math.cos(Math.PI * 0.5 + t), corners[3].cy + r * Math.sin(Math.PI * 0.5 + t)));
        }
        segments.push(rot(-hw, -hh + r));
        for (let i = 1; i <= arcSteps; i++) {
            const t = (i / arcSteps) * Math.PI / 2;
            segments.push(rot(corners[0].cx + r * Math.cos(Math.PI + t), corners[0].cy + r * Math.sin(Math.PI + t)));
        }

        const lineSegments = [];
        for (let i = 0; i < segments.length; i++) {
            const prev = i === 0 ? startP : segments[i - 1];
            lineSegments.push([segments[i][0] - prev[0], segments[i][1] - prev[1]]);
        }

        // Stroke colour set by caller; do NOT override line width here.
        doc.setDrawColor(0, 0, 0);
        doc.lines(lineSegments, startP[0], startP[1], [1, 1], 'S', true);
    }

    // ── Mini solution card (multi-up layout) ───────────────────────────────────
    function drawMiniSolution(puzzleData, puzzleNum, ox, oy, boxW, boxH) {
        const s      = puzzleData.settings;
        const result = puzzleData.result;
        const grid   = result.grid;
        const rows   = s.rows;
        const cols   = s.cols;

        // Title — UPPERCASE, with proper umlaut characters
        const miniLabelMap = { en: 'SOLUTION', fr: 'SOLUTION', de: 'L\u00D6SUNG' };
        const miniLabel = miniLabelMap[s.language || 'en'] || 'SOLUTION';

        // Title — VECTOR OUTLINES
        drawOutlineText(pdf, titleOTFont, `${miniLabel} #${puzzleNum}`,
            ox + boxW / 2, oy + 0.18, 9, [0, 0, 0], 'center');

        const innerMargin = 0.1;
        const gridTopY    = oy + 0.25;
        const cellSize    = Math.min((boxW - 2*innerMargin) / cols, (boxH - 0.35) / rows);
        const gridW       = cellSize * cols;
        const gridH       = cellSize * rows;
        const gridX       = ox + (boxW - gridW) / 2;
        const gridY       = gridTopY;

        // Grid border — 1pt
        pdf.setDrawColor(0, 0, 0);
        pdf.setLineWidth(1 / 72);
        pdf.rect(gridX, gridY, gridW, gridH);

        const fontSize = Math.max(5, Math.min(cellSize * 72 * 0.55, 10));

        // Grid letters — VECTOR OUTLINES
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cx = gridX + c * cellSize + cellSize / 2;
                const cy = gridY + r * cellSize + cellSize / 2 + (fontSize / 72) * 0.35;
                drawOutlineText(pdf, gridOTFont, String(grid[r][c]), cx, cy, fontSize, [0, 0, 0], 'center');
            }
        }

        // Word pills — 0.5pt stroke
        pdf.setDrawColor(0, 0, 0);
        pdf.setLineWidth(0.5 / 72);

        result.placedWords.forEach(pw => {
            const path = pw.path;
            if (path.length === 0) return;
            const startR = path[0][0], startC = path[0][1];
            const endR   = path[path.length-1][0], endC = path[path.length-1][1];
            const x1 = gridX + startC * cellSize + cellSize / 2;
            const y1 = gridY + startR * cellSize + cellSize / 2;
            const x2 = gridX + endC   * cellSize + cellSize / 2;
            const y2 = gridY + endR   * cellSize + cellSize / 2;
            const mx = (x1+x2)/2, my = (y1+y2)/2;
            const wordLen = Math.sqrt((x2-x1)**2 + (y2-y1)**2) + cellSize * 0.85;
            drawRotatedRoundedRect(pdf, mx, my, wordLen, cellSize*0.78, cellSize*0.39, Math.atan2(y2-y1,x2-x1));
        });
    }

    // ══════════════════════════════════════════════════════════════════
    //  RENDER ALL PAGES
    // ══════════════════════════════════════════════════════════════════

    for (let i = 0; i < puzzlesData.length; i++) {
        if (i > 0) pdf.addPage([W, H], W > H ? 'landscape' : 'portrait');
        drawPuzzlePage(puzzlesData[i], i + 1, false);
    }

    if (solutionsPerPage === 1) {
        for (let i = 0; i < puzzlesData.length; i++) {
            pdf.addPage([W, H], W > H ? 'landscape' : 'portrait');
            drawPuzzlePage(puzzlesData[i], i + 1, true);
        }
    } else {
        let solCols, solRows;
        if (solutionsPerPage <= 2)      { solCols = 1; solRows = 2; }
        else if (solutionsPerPage <= 4) { solCols = 2; solRows = 2; }
        else                            { solCols = 2; solRows = 3; }

        const boxW = usableW / solCols;
        const boxH = usableH / solRows;
        let idx = 0;
        while (idx < puzzlesData.length) {
            pdf.addPage([W, H], W > H ? 'landscape' : 'portrait');
            for (let slot = 0; slot < solutionsPerPage && idx < puzzlesData.length; slot++) {
                const col = slot % solCols;
                const row = Math.floor(slot / solCols);
                drawMiniSolution(puzzlesData[idx], idx + 1,
                    MARGIN + col * boxW, MARGIN + row * boxH, boxW, boxH);
                idx++;
            }
        }
    }

    pdf.save('WordSearch_PuzzleBook.pdf');
}
