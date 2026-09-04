/**
 * pdf-export.js  –  Native jsPDF vector rendering with Google Font + custom TTF embedding
 * Draws the puzzle grid, letters, clues, and solution outlines directly
 * using jsPDF primitives for sharp, print-ready, high-resolution output.
 *
 * Font embedding priority:
 *   1. User-uploaded custom .ttf (base64 stored in settings.fontXxxCustom)
 *   2. Google Font fetched from Fontsource CDN
 *   3. Fallback: helvetica (always available in jsPDF)
 *   4. Special case: "Arial" → use helvetica directly (system font, not fetchable)
 *
 * Background design image: drawn on puzzle pages only (not solution pages).
 */

function umlautSafe(str) {
    return String(str);
}

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
    // Arial intentionally omitted — it's a system font handled as helvetica
};

function buildFontUrlCandidates(fontName) {
    const slug = FONT_SLUGS[fontName];
    if (!slug) return [];

    const pascal      = fontName.replace(/[^A-Za-z0-9]/g, '');
    const slugCompact = slug.replace(/-/g, '');
    const licenseDirs = ['ofl', 'apache', 'ufl'];

    const urls = [
        `https://cdn.jsdelivr.net/gh/fontsource/font-files@main/fonts/google/${slug}/ttf/${slug}-400-normal.ttf`,
    ];
    licenseDirs.forEach(dir => {
        urls.push(`https://cdn.jsdelivr.net/gh/google/fonts@main/${dir}/${slugCompact}/static/${pascal}-Regular.ttf`);
        urls.push(`https://cdn.jsdelivr.net/gh/google/fonts@main/${dir}/${slugCompact}/${pascal}-Regular.ttf`);
    });
    return urls;
}

// ── Per-session font data cache ───────────────────────────────────────────────
const _fontDataCache = {}; // fontName → { base64, vfsName } | 'failed'

async function fetchGoogleFontBase64(fontName) {
    if (!fontName || fontName === 'Arial') return false; // Arial → use helvetica
    if (_fontDataCache[fontName] === 'failed') return false;
    if (_fontDataCache[fontName]) return true;

    const urls = buildFontUrlCandidates(fontName);
    if (urls.length === 0) {
        console.warn(`[pdf-export] No known TTF source for "${fontName}" – skipping`);
        _fontDataCache[fontName] = 'failed';
        return false;
    }

    for (const url of urls) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) { console.warn(`[pdf-export] HTTP ${resp.status} for "${fontName}" at ${url}`); continue; }
            const buffer = await resp.arrayBuffer();
            if (!buffer || buffer.byteLength < 200) { continue; }

            const uint8 = new Uint8Array(buffer);
            let binary = '';
            const CHUNK = 8192;
            for (let i = 0; i < uint8.length; i += CHUNK) {
                binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
            }
            const vfsName = `${fontName.replace(/ /g, '_')}-Regular.ttf`;
            _fontDataCache[fontName] = { base64: btoa(binary), vfsName };
            console.info(`[pdf-export] ✓ Font embedded: "${fontName}" (${(buffer.byteLength / 1024).toFixed(0)} KB)`);
            return true;
        } catch (err) {
            console.warn(`[pdf-export] Fetch error for "${fontName}" (${url}): ${err.message}`);
        }
    }
    console.warn(`[pdf-export] Could not embed "${fontName}" – falling back to helvetica`);
    _fontDataCache[fontName] = 'failed';
    return false;
}

function registerFontInPdf(pdf, fontName, customPayload) {
    // Custom uploaded TTF takes priority
    if (customPayload && customPayload.base64 && customPayload.vfsName) {
        try {
            pdf.addFileToVFS(customPayload.vfsName, customPayload.base64);
            pdf.addFont(customPayload.vfsName, customPayload.name, 'normal');
            pdf.addFont(customPayload.vfsName, customPayload.name, 'bold');
            return customPayload.name;
        } catch (err) {
            console.warn(`[pdf-export] Could not register custom font: ${err.message}`);
        }
    }

    // Arial → use helvetica (built-in)
    if (!fontName || fontName === 'Arial') return 'helvetica';

    const entry = _fontDataCache[fontName];
    if (!entry || entry === 'failed') return 'helvetica';
    try {
        pdf.addFileToVFS(entry.vfsName, entry.base64);
        pdf.addFont(entry.vfsName, fontName, 'normal');
        pdf.addFont(entry.vfsName, fontName, 'bold');
        return fontName;
    } catch (err) {
        console.warn(`[pdf-export] Could not register "${fontName}": ${err.message}`);
        return 'helvetica';
    }
}

function safeSetFont(pdf, fontName, style) {
    style = style || 'normal';
    let available = {};
    try { available = pdf.getFontList() || {}; } catch (_) {}

    if (available[fontName] && available[fontName].includes(style)) { pdf.setFont(fontName, style); return; }
    if (available[fontName] && available[fontName].includes('normal')) { pdf.setFont(fontName, 'normal'); return; }
    pdf.setFont('helvetica', 'normal');
}

// ── Convert a data-URL to a base64 string + mimeType ─────────────────────────
function parseDataUrl(dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return { mime: match[1], base64: match[2] };
}

// ── Main export entry point ───────────────────────────────────────────────────
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

    // ── Use the user-selected margin (default 0.375") ─────────────────────────
    const MARGIN  = (typeof pageMargin === 'number' && pageMargin > 0) ? pageMargin : 0.375;
    const usableW = W - 2 * MARGIN;
    const usableH = H - 2 * MARGIN;

    // ── Collect unique Google Font names needed (excluding custom + Arial) ────
    const googleFontsNeeded = new Set();
    puzzlesData.forEach(pd => {
        const s = pd.settings;
        // Only fetch from Google if no custom upload AND not Arial
        if (!s.fontTitleCustom && s.fontTitleDropdown && s.fontTitleDropdown !== 'Arial') googleFontsNeeded.add(s.fontTitleDropdown);
        if (!s.fontCluesCustom && s.fontCluesDropdown && s.fontCluesDropdown !== 'Arial') googleFontsNeeded.add(s.fontCluesDropdown);
        if (!s.fontGridCustom  && s.fontGridDropdown  && s.fontGridDropdown  !== 'Arial') googleFontsNeeded.add(s.fontGridDropdown);
    });

    // Phase 1: fetch all Google Font TTF binaries in parallel
    await Promise.all([...googleFontsNeeded].map(name => fetchGoogleFontBase64(name)));

    // Phase 2: register fonts (custom payload takes priority)
    // We derive one representative settings object for the title/clues/grid slots
    // (assumes all puzzles use the same fonts — which is the normal case)
    const refSettings = puzzlesData[0]?.settings || {};
    const fontNameMap = {};

    function registerSlot(dropdownName, customPayload) {
        const key = customPayload ? customPayload.name : (dropdownName || 'Arial');
        if (fontNameMap[key] !== undefined) return fontNameMap[key]; // already registered
        const resolved = registerFontInPdf(pdf, dropdownName, customPayload);
        fontNameMap[key] = resolved;
        return resolved;
    }

    const titleFontResolved = registerSlot(refSettings.fontTitleDropdown, refSettings.fontTitleCustom);
    const cluesFontResolved = registerSlot(refSettings.fontCluesDropdown, refSettings.fontCluesCustom);
    const gridFontResolved  = registerSlot(refSettings.fontGridDropdown,  refSettings.fontGridCustom);

    // ── Helper: draw a single full puzzle page ────────────────────────────────
    function drawPuzzlePage(puzzleData, puzzleNum, isSolution) {
        const s      = puzzleData.settings;
        const result = puzzleData.result;
        const grid   = result.grid;
        const rows   = s.rows;
        const cols   = s.cols;

        const titleFont = titleFontResolved;
        const cluesFont = cluesFontResolved;
        const gridFont  = gridFontResolved;

        const LANG_LABELS_PDF = {
            en: { puzzle: 'Puzzle',        solution: 'Solution' },
            fr: { puzzle: 'Casse-tête',    solution: 'Solution' },
            de: { puzzle: 'Rätsel',        solution: 'Lösung'   }
        };
        const lang   = s.language || 'en';
        const labels = LANG_LABELS_PDF[lang] || LANG_LABELS_PDF.en;

        // ── Background image (puzzle pages only) ──────────────────────────────
        if (!isSolution && s.bgImageData) {
            try {
                const parsed = parseDataUrl(s.bgImageData);
                if (parsed) {
                    const fmt = parsed.mime.includes('jpeg') || parsed.mime.includes('jpg') ? 'JPEG' : 'PNG';
                    // 1. Draw background full-bleed
                    pdf.addImage(parsed.base64, fmt, 0, 0, W, H);
                }
            } catch (err) {
                console.warn('[pdf-export] Could not draw background image:', err.message);
            }
        }

        // ── Title ─────────────────────────────────────────────────────────────
        let titleText;
        if (isSolution) {
            titleText = `${labels.solution} #${puzzleNum}`;
        } else if (s.showTitle === false) {
            titleText = null;
        } else if (s.titleManuallyEdited && s.title) {
            titleText = s.title;
        } else {
            titleText = `${labels.puzzle} #${puzzleNum}`;
        }

        // ── Grid geometry — computed BEFORE drawing anything ──────────────────
        const contentScale  = (s.contentScale !== undefined && s.contentScale > 0) ? s.contentScale : 1;
        const panelInset    = 1.0;          // 1 inch breathing room on each side (matches CSS)
        const panelX        = panelInset;
        const panelY        = panelInset;
        const panelW        = W - 2 * panelInset;
        const panelH        = H - 2 * panelInset;

        // Usable area inside the panel (panel has its own inner margin equal to MARGIN)
        const innerPad    = MARGIN;
        const usablePanelW = panelW - 2 * innerPad;
        const usablePanelH = panelH - 2 * innerPad;

        const titleH         = titleText !== null ? 0.5 : 0;
        const clueAreaHeight = (() => {
            const nWords   = result.placedWords.length;
            const nRows    = Math.ceil(nWords / s.clueCols);
            const lh       = 11 / 72 + 0.12;
            return 0.35 + nRows * lh + 0.2;
        })();

        // Scale down the content so it fits and respects the user's content-scale
        const availableContentH = usablePanelH * contentScale;
        const availableContentW = usablePanelW * contentScale;
        const maxGridH = availableContentH - titleH - clueAreaHeight;
        const maxGridW = availableContentW;

        const cellSize = Math.min(maxGridW / cols, maxGridH / rows);
        const gridW    = cellSize * cols;
        const gridH    = cellSize * rows;

        // Total content height: title + grid + gap + clues
        const contentH = titleH + gridH + clueAreaHeight;
        // Centre the content block within the white panel's usable area
        const blockTopY = panelY + innerPad + (usablePanelH - contentH) / 2;

        const titleY = blockTopY + (titleText !== null ? 0.3 : 0);
        const gridY  = blockTopY + titleH;
        const gridX  = panelX + innerPad + (usablePanelW - gridW) / 2;

        // ── 2. White rounded panel — full page minus 1" inset ────────────────
        if (!isSolution && s.bgImageData) {
            const panelRadius = 0.15;
            const whiteOp = (s.bgOpacity !== undefined && s.bgOpacity !== null) ? Math.max(0, Math.min(1, s.bgOpacity)) : 0.94;

            try {
                pdf.setFillColor(255, 255, 255);
                pdf.setDrawColor(255, 255, 255);
                pdf.setGState(pdf.GState({ opacity: whiteOp }));
                pdf.roundedRect(panelX, panelY, panelW, panelH, panelRadius, panelRadius, 'F');
                pdf.setGState(pdf.GState({ opacity: 1.0 }));
            } catch (_) { /* GState may not be available in all jsPDF builds */ }
        }

        // ── 3. Title ──────────────────────────────────────────────────────────
        let titleX, titleAlign;
        if (s.titlePlacement === 'left')      { titleX = panelX + innerPad;           titleAlign = 'left';   }
        else if (s.titlePlacement === 'right') { titleX = panelX + panelW - innerPad; titleAlign = 'right';  }
        else                                   { titleX = panelX + panelW / 2;        titleAlign = 'center'; }

        if (titleText !== null) {
            safeSetFont(pdf, titleFont, 'bold');
            pdf.setFontSize(22);
            pdf.setTextColor(0, 0, 0);
            pdf.text(titleText, titleX, titleY, { align: titleAlign });
        }

        // ── 4. Grid border ────────────────────────────────────────────────────
        if (s.showBorder) {
            pdf.setDrawColor(0, 0, 0);
            pdf.setLineWidth(0.02);
            pdf.rect(gridX, gridY, gridW, gridH);
        }

        // ── 5. Grid letters ───────────────────────────────────────────────────
        const letterFontSize = Math.min(cellSize * 72 * 0.55, 18);
        safeSetFont(pdf, gridFont, 'normal');
        pdf.setFontSize(letterFontSize);
        pdf.setTextColor(0, 0, 0);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cx = gridX + c * cellSize + cellSize / 2;
                const cy = gridY + r * cellSize + cellSize / 2 + (letterFontSize / 72) * 0.35;
                pdf.text(umlautSafe(grid[r][c]), cx, cy, { align: 'center' });
            }
        }

        // ── 6. Solution outlines ──────────────────────────────────────────────
        if (isSolution) {
            pdf.setDrawColor(0, 0, 0);
            pdf.setLineWidth(0.018);
            pdf.setFillColor(255, 255, 255);

            result.placedWords.forEach(pw => {
                const path = pw.path;
                if (path.length === 0) return;

                const startR = path[0][0],             startC = path[0][1];
                const endR   = path[path.length-1][0], endC   = path[path.length-1][1];

                const x1 = gridX + startC * cellSize + cellSize / 2;
                const y1 = gridY + startR * cellSize + cellSize / 2;
                const x2 = gridX + endC   * cellSize + cellSize / 2;
                const y2 = gridY + endR   * cellSize + cellSize / 2;

                const mx      = (x1 + x2) / 2;
                const my      = (y1 + y2) / 2;
                const dx      = x2 - x1;
                const dy      = y2 - y1;
                const wordLen = Math.sqrt(dx * dx + dy * dy) + cellSize * 0.9;
                const angle   = Math.atan2(dy, dx);

                drawRotatedRoundedRect(pdf, mx, my, wordLen, cellSize * 0.84, cellSize * 0.42, angle);
            });
        }

        // ── 7. Clues ──────────────────────────────────────────────────────────
        const clueStartY   = gridY + gridH + 0.35;
        const clueFontSize = 11;
        safeSetFont(pdf, cluesFont, 'normal');
        pdf.setFontSize(clueFontSize);
        pdf.setTextColor(0, 0, 0);

        const sortedWords = result.placedWords.map(p => p.word).sort();
        const colWidth    = usablePanelW / s.clueCols;
        const lineHeight  = clueFontSize / 72 + 0.12;

        sortedWords.forEach((word, idx) => {
            const col = idx % s.clueCols;
            const row = Math.floor(idx / s.clueCols);
            const cx  = panelX + innerPad + col * colWidth + colWidth / 2;
            const cy  = clueStartY + row * lineHeight;
            if (cy < panelY + panelH - innerPad) {
                pdf.text(umlautSafe(word), cx, cy, { align: 'center' });
            }
        });
    }

    // ── Rotated pill outline helper ────────────────────────────────────────────
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

        doc.setLineWidth(0.018);
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

        const LANG_LABELS_MINI = {
            en: { solution: 'Solution' },
            fr: { solution: 'Solution' },
            de: { solution: 'Lösung'   }
        };
        const miniLang   = s.language || 'en';
        const miniLabels = LANG_LABELS_MINI[miniLang] || LANG_LABELS_MINI.en;

        safeSetFont(pdf, titleFontResolved, 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(0, 0, 0);
        pdf.text(`${miniLabels.solution} #${puzzleNum}`, ox + boxW / 2, oy + 0.18, { align: 'center' });

        const innerMargin = 0.1;
        const gridTopY    = oy + 0.25;
        const availW      = boxW - 2 * innerMargin;
        const availH      = boxH - 0.35;
        const cellSize    = Math.min(availW / cols, availH / rows);
        const gridW       = cellSize * cols;
        const gridH       = cellSize * rows;
        const gridX       = ox + (boxW - gridW) / 2;
        const gridY       = gridTopY;

        pdf.setDrawColor(0, 0, 0);
        pdf.setLineWidth(0.025);
        pdf.rect(gridX, gridY, gridW, gridH);

        const fontSize = Math.max(5, Math.min(cellSize * 72 * 0.55, 10));
        safeSetFont(pdf, gridFontResolved, 'normal');
        pdf.setFontSize(fontSize);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cx = gridX + c * cellSize + cellSize / 2;
                const cy = gridY + r * cellSize + cellSize / 2 + (fontSize / 72) * 0.35;
                pdf.text(umlautSafe(grid[r][c]), cx, cy, { align: 'center' });
            }
        }

        pdf.setDrawColor(0, 0, 0);
        pdf.setLineWidth(0.012);

        result.placedWords.forEach(pw => {
            const path = pw.path;
            if (path.length === 0) return;

            const startR = path[0][0],             startC = path[0][1];
            const endR   = path[path.length-1][0], endC   = path[path.length-1][1];

            const x1 = gridX + startC * cellSize + cellSize / 2;
            const y1 = gridY + startR * cellSize + cellSize / 2;
            const x2 = gridX + endC   * cellSize + cellSize / 2;
            const y2 = gridY + endR   * cellSize + cellSize / 2;

            const mx      = (x1 + x2) / 2;
            const my      = (y1 + y2) / 2;
            const dx      = x2 - x1;
            const dy      = y2 - y1;
            const wordLen = Math.sqrt(dx * dx + dy * dy) + cellSize * 0.85;
            const ang     = Math.atan2(dy, dx);

            drawRotatedRoundedRect(pdf, mx, my, wordLen, cellSize * 0.78, cellSize * 0.39, ang);
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
            const startY = MARGIN;

            for (let slot = 0; slot < solutionsPerPage && idx < puzzlesData.length; slot++) {
                const col = slot % solCols;
                const row = Math.floor(slot / solCols);
                drawMiniSolution(puzzlesData[idx], idx + 1,
                    MARGIN + col * boxW, startY + row * boxH, boxW, boxH);
                idx++;
            }
        }
    }

    pdf.save('WordSearch_PuzzleBook.pdf');
}
