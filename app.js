let currentPuzzlesData = [];

// ── Track whether the user has manually edited the title ──────────────────────
let titleManuallyEdited = false;

// ── Background design image (puzzle pages only) ───────────────────────────────
let bgImageData = null; // base64 PNG data-URL string | null

// ── Language labels ───────────────────────────────────────────────────────────
const LANG_LABELS = {
    en: { puzzle: 'Puzzle',        solution: 'Solution' },
    fr: { puzzle: 'Casse-tête',    solution: 'Solution' },
    de: { puzzle: 'Rätsel',        solution: 'Lösung'   }
};

function getLang() {
    const el = document.getElementById('puzzle-language');
    return el ? el.value : 'en';
}

function getPuzzleLabel()   { return (LANG_LABELS[getLang()] || LANG_LABELS.en).puzzle;   }
function getSolutionLabel() { return (LANG_LABELS[getLang()] || LANG_LABELS.en).solution; }

/**
 * Returns the auto-title for the current language and puzzle number.
 * Used to pre-populate the title field when no manual edit has been made.
 */
function getAutoTitle(puzzleNum) {
    return `${getPuzzleLabel()} #${puzzleNum}`;
}

/**
 * Resolve which font family name to use for a given slot.
 * If the user has uploaded a custom TTF it takes priority over the dropdown.
 */
function resolveUIFont(slot) {
    if (typeof customFontData !== 'undefined' && customFontData[slot]) {
        return customFontData[slot].name;
    }
    const pickerId = slot === 'title' ? 'font-title'
                   : slot === 'clues' ? 'font-clues'
                   :                    'font-grid';
    return document.getElementById(pickerId)?.value || 'Arial';
}

function getSettings() {
    const preset = document.getElementById('grid-size-preset').value;
    let cols = 15, rows = 15;
    if (preset === '10x10') { cols = 10; rows = 10; }
    else if (preset === '15x15') { cols = 15; rows = 15; }
    else if (preset === '18x18') { cols = 18; rows = 18; }
    else if (preset === '20x20') { cols = 20; rows = 20; }
    else {
        cols = parseInt(document.getElementById('grid-cols').value) || 15;
        rows = parseInt(document.getElementById('grid-rows').value) || 15;
    }

    const directions = Array.from(document.querySelectorAll('.direction-toggle:checked')).map(cb => cb.value);
    
    // ── Title visibility logic ────────────────────────────────────────────────
    // A title is "hidden" only when the user explicitly types a single space (" ").
    // An empty field means: use the auto-label for the current language.
    const rawTitle  = document.getElementById('puzzle-title').value;
    const isSpaceOnly = rawTitle.length > 0 && rawTitle.trim().length === 0; // only spaces
    const showTitle   = !isSpaceOnly; // false only when user types a space to hide
    const titleText   = rawTitle.trim(); // may be '' — that means use auto-label

    // ── Page margin ───────────────────────────────────────────────────────────
    const pageMargin = parseFloat(document.getElementById('page-margin')?.value) || 0.375;

    return {
        title: titleText,
        showTitle: showTitle,
        titleManuallyEdited,                // carry the flag so PDF export can honour it
        words: document.getElementById('word-list').value.split('\n').map(w => w.trim()).filter(w => w),
        _normalizedWords: document.getElementById('word-list').value.split('\n')
            .map(w => w.trim()).filter(w => w)
            .map(w => w.replace(/ß/g, 'SS').replace(/[äÄ]/g, 'Ä').replace(/[öÖ]/g, 'Ö').replace(/[üÜ]/g, 'Ü')
                        .toUpperCase().replace(/[^A-ZÄÖÜ]/g, '')),
        cols, rows,
        directions,
        allowBackwards: document.getElementById('allow-backwards').checked,
        trimSize:       document.getElementById('trim-size').value,
        pageMargin,
        titlePlacement: 'center',
        cluePlacement:  document.getElementById('clue-placement').value,
        clueCols:       parseInt(document.getElementById('clue-cols').value) || 3,
        clueRows:       parseInt(document.getElementById('clue-rows').value) || 5,
        clueSpacing:    parseInt(document.getElementById('clue-spacing').value) || 10,
        // Font: custom upload takes priority, then dropdown
        fontTitle: resolveUIFont('title'),
        fontClues: resolveUIFont('clues'),
        fontGrid:  resolveUIFont('grid'),
        // Raw font name from dropdown (used by pdf-export for Google Fonts embed)
        fontTitleDropdown: document.getElementById('font-title')?.value || 'Arial',
        fontCluesDropdown: document.getElementById('font-clues')?.value || 'Arial',
        fontGridDropdown:  document.getElementById('font-grid')?.value  || 'Arial',
        // Custom font payloads for PDF embedding
        fontTitleCustom: (typeof customFontData !== 'undefined') ? customFontData.title : null,
        fontCluesCustom: (typeof customFontData !== 'undefined') ? customFontData.clues : null,
        fontGridCustom:  (typeof customFontData !== 'undefined') ? customFontData.grid  : null,
        bgOpacity: document.getElementById('bg-opacity').value / 100,
        contentScale: parseFloat(document.getElementById('content-scale')?.value || 82) / 100,
        showBorder: document.getElementById('grid-border').checked,
        bgImageData,           // base64 data-URL or null
        wordsPerPuzzle: parseInt(document.getElementById('words-per-puzzle').value) || 15,
        puzzleCount:    parseInt(document.getElementById('puzzle-count').value) || 1,
        solutionsPerPage: parseInt(document.getElementById('solutions-per-page').value) || 6,
        language: getLang()
    };
}

function renderPuzzleToDOM(puzzleData, puzzleNum, isSolution = false, isSmallMode = false) {
    const s = puzzleData.settings;
    const page = document.createElement('div');
    page.className = 'page';
    
    if (isSmallMode) {
        page.className = 'solution-mini-card';
    } else {
        // Set dimensions based on trim size
        let widthIn = 8.5, heightIn = 11;
        if (s.trimSize === '6x9')     { widthIn = 6;    heightIn = 9;    }
        if (s.trimSize === '8.5x8.5') { widthIn = 8.5;  heightIn = 8.5;  }
        if (s.trimSize === 'A4')      { widthIn = 8.27; heightIn = 11.69; }
        page.style.setProperty('--page-width',  `${widthIn}in`);
        page.style.setProperty('--page-height', `${heightIn}in`);

        // No padding on the outer page — padding goes on the content panel instead
        page.style.padding = '0';
        page.style.boxSizing = 'border-box';
    }

    // ── Background design image (puzzle pages only, not solution, not mini) ──
    const hasBg = !isSolution && !isSmallMode && s.bgImageData;
    if (hasBg) {
        page.classList.add('has-bg');
        page.style.background         = 'none'; // override the white default so bg image shows
        page.style.backgroundImage    = `url('${s.bgImageData}')`;
        page.style.backgroundSize     = 'cover';
        page.style.backgroundPosition = 'center';
        page.style.backgroundRepeat   = 'no-repeat';
    }

    // ── Language labels ────────────────────────────────────────────────────────
    const puzzleLabel   = (LANG_LABELS[s.language] || LANG_LABELS.en).puzzle;
    const solutionLabel = (LANG_LABELS[s.language] || LANG_LABELS.en).solution;

    // ── White content panel (sits over background, behind puzzle elements) ────
    // Always present for full pages. When no background image it's invisible (no shadow).
    let contentPanel;
    if (!isSmallMode) {
        contentPanel = document.createElement('div');
        contentPanel.className = hasBg ? 'content-panel content-panel--bg' : 'content-panel';
        // Apply the user's page margin as padding on the panel
        const marginIn = s.pageMargin || 0.375;
        contentPanel.style.padding = `${marginIn}in`;

        // Apply white panel opacity when bg image is active
        if (hasBg) {
            const op = (s.bgOpacity !== undefined && s.bgOpacity !== null) ? s.bgOpacity : 0.94;
            contentPanel.style.background = `rgba(255,255,255,${op})`;
        }

        page.appendChild(contentPanel);
    }

    // Helper: append children to the panel (if it exists) or directly to page
    const host = contentPanel || page;

    // Apply content scale transform
    if (!isSmallMode && s.contentScale && s.contentScale !== 1) {
        host.style.transformOrigin = 'top center';
        host.style.transform = `scale(${s.contentScale})`;
        // Compensate so the panel still fills its absolute slot
        if (hasBg) {
            host.style.transformOrigin = 'center center';
        }
    }

    // Determine whether to show a header at all
    // showTitle === false only when user deliberately typed spaces to hide
    const shouldShowHeader = isSolution || isSmallMode || s.showTitle !== false;

    if (shouldShowHeader) {
        const header = document.createElement('div');
        header.className = 'page-header';
        const title = document.createElement('h1');
        title.style.fontFamily = `"${s.fontTitle}", Arial, sans-serif`;

        if (isSmallMode) {
            title.className = 'solution-mini-title';
            title.textContent = `${solutionLabel} #${puzzleNum}`;
        } else if (isSolution) {
            title.className = `page-title title-${s.titlePlacement}`;
            title.textContent = `${solutionLabel} #${puzzleNum}`;
        } else {
            title.className = `page-title title-${s.titlePlacement}`;
            // Use custom title if manually edited AND non-empty, else auto-label
            if (s.titleManuallyEdited && s.title) {
                title.textContent = s.title;
            } else {
                title.textContent = `${puzzleLabel} #${puzzleNum}`;
            }
        }

        header.appendChild(title);
        host.appendChild(header);
    }

    // Body layout — appended to panel/host
    const body = document.createElement('div');
    body.className = `page-body layout-${s.cluePlacement}`;

    // Grid container
    const puzzleContainer = document.createElement('div');
    puzzleContainer.className = 'puzzle-container';
    
    const grid = document.createElement('div');
    grid.className = `word-grid ${(s.showBorder || isSmallMode) ? 'show-border' : ''}`;
    grid.style.position = 'relative';
    grid.style.fontFamily = `"${s.fontGrid}", Arial, monospace`;
    
    let baseFontSize = isSmallMode ? 8 : 18;
    if (s.cols > 15) baseFontSize -= 4;
    grid.style.fontSize = `${baseFontSize}px`;

    const cellW = isSmallMode ? 12 : (s.cols > 15 ? 20 : 30);
    grid.style.width  = `${s.cols * cellW}px`;
    grid.style.height = `${s.rows * cellW}px`;

    const cellWidth = `${cellW}px`;
    for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.style.width  = cellWidth;
            cell.style.height = cellWidth;
            cell.textContent  = puzzleData.result.grid[r][c];
            grid.appendChild(cell);
        }
    }
    
    // SVG Overlay for Solutions
    if (isSolution) {
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.style.position = 'absolute';
        svg.style.top = '0'; svg.style.left = '0';
        svg.style.width = '100%'; svg.style.height = '100%';
        svg.style.pointerEvents = 'none';
        svg.setAttribute("viewBox", `0 0 ${s.cols} ${s.rows}`);
        
        puzzleData.result.placedWords.forEach(pw => {
            const path  = pw.path;
            const start = path[0];
            const end   = path[path.length - 1];
            const r1 = start[0], c1 = start[1];
            const r2 = end[0],   c2 = end[1];
            const cx = (c1 + c2) / 2 + 0.5;
            const cy = (r1 + r2) / 2 + 0.5;
            const dx = c2 - c1, dy = r2 - r1;
            const len   = Math.sqrt(dx * dx + dy * dy) + 1;
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const rect  = document.createElementNS(svgNS, "rect");
            const width = len - 0.2;
            const height = 0.8;
            rect.setAttribute("x",      cx - width / 2);
            rect.setAttribute("y",      cy - height / 2);
            rect.setAttribute("width",  width);
            rect.setAttribute("height", height);
            rect.setAttribute("rx", 0.4); rect.setAttribute("ry", 0.4);
            rect.setAttribute("fill",         "none");
            rect.setAttribute("stroke",       "black");
            rect.setAttribute("stroke-width", isSmallMode ? "0.15" : "0.08");
            rect.setAttribute("transform", `rotate(${angle}, ${cx}, ${cy})`);
            svg.appendChild(rect);
        });
        grid.appendChild(svg);
    }
    
    puzzleContainer.appendChild(grid);
    body.appendChild(puzzleContainer);

    // Clues (only if not small mode)
    if (!isSmallMode) {
        const cluesContainer = document.createElement('div');
        cluesContainer.className = 'clues-container';
        const cluesList = document.createElement('ul');
        cluesList.className = 'clues-list';
        cluesList.style.fontFamily = `"${s.fontClues}", Arial, sans-serif`;
        
        if (s.cluePlacement === 'bottom') {
            cluesContainer.style.marginTop = `${s.clueSpacing}px`;
        }

        const sortedPlaced = puzzleData.result.placedWords.map(p => p.word).sort();
        const colPercent   = 100 / s.clueCols;
        
        sortedPlaced.forEach(word => {
            const li = document.createElement('li');
            li.textContent = word;
            if (isSolution) li.classList.add('found');
            li.style.width       = `calc(${colPercent}% - ${s.clueSpacing}px)`;
            li.style.marginRight  = `${s.clueSpacing}px`;
            li.style.marginBottom = `${s.clueSpacing}px`;
            cluesList.appendChild(li);
        });

        cluesContainer.appendChild(cluesList);
        body.appendChild(cluesContainer);
    }

    host.appendChild(body);
    
    // Background opacity overlay — now the white panel handles opacity, this is legacy
    // Keep block but make it a no-op visually (white panel handles it above)
    // Legacy: only add dark overlay if explicitly requested via negative opacity trick (not used)
    // if (s.bgOpacity > 0 && !isSmallMode) { ... }

    return page;
}

function generateBatch() {
    const s = getSettings();
    currentPuzzlesData = [];

    const errorMsg = document.getElementById('error-message');
    errorMsg.style.display = 'none';
    
    const maxDimension = Math.max(s.cols, s.rows);
    const oversized = (s._normalizedWords || s.words).some(w => w.length > maxDimension);
    if (oversized) {
        errorMsg.textContent = "Warning: Some words are longer than the grid size and may not fit!";
        errorMsg.style.display = 'block';
    }

    for (let i = 0; i < s.puzzleCount; i++) {
        let puzzleWords = [];
        if (s.words.length > 0) {
            for (let j = 0; j < s.wordsPerPuzzle; j++) {
                const wordIndex = (i * s.wordsPerPuzzle + j) % s.words.length;
                puzzleWords.push(s.words[wordIndex]);
            }
        }

        const genConfig = {
            rows: s.rows, cols: s.cols,
            words: puzzleWords,
            directions: s.directions,
            allowBackwards: s.allowBackwards
        };
        const generator = new WordSearchGenerator(genConfig);
        const result    = generator.generate();
        
        currentPuzzlesData.push({ settings: s, result });
    }

    updatePreview();
}

function updatePreview() {
    const canvas = document.getElementById('preview-canvas');
    canvas.innerHTML = '';
    if (currentPuzzlesData.length === 0) return;

    const firstPuzzle = currentPuzzlesData[0];
    canvas.appendChild(renderPuzzleToDOM(firstPuzzle, 1, false));
    canvas.appendChild(renderPuzzleToDOM(firstPuzzle, 1, true));
}

// ── Event Listeners ────────────────────────────────────────────────────────────
document.getElementById('generate-btn').addEventListener('click', generateBatch);

document.getElementById('export-pdf-btn').addEventListener('click', async () => {
    if (currentPuzzlesData.length === 0) generateBatch();
    const btn = document.getElementById('export-pdf-btn');
    const oldText = btn.textContent;
    btn.textContent = 'Generating PDF… Please wait';
    btn.disabled = true;
    try {
        const s = getSettings();
        await generatePDF(currentPuzzlesData, s.trimSize, s.solutionsPerPage, s.pageMargin);
    } catch (err) {
        console.error(err);
        alert("Error generating PDF. See console.");
    } finally {
        btn.textContent = oldText;
        btn.disabled = false;
    }
});

document.getElementById('grid-size-preset').addEventListener('change', (e) => {
    const custom = document.getElementById('custom-grid-size');
    custom.style.display = e.target.value === 'custom' ? 'flex' : 'none';
});

document.getElementById('shuffle-words').addEventListener('click', () => {
    const ta = document.getElementById('word-list');
    const words = ta.value.split('\n').filter(w => w.trim());
    for (let i = words.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [words[i], words[j]] = [words[j], words[i]];
    }
    ta.value = words.join('\n');
});

document.getElementById('csv-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const text  = ev.target.result;
        const words = text.split(/\r?\n/)
            .map(row => row.split(',')[0].trim())
            .filter(w => w.length > 0);
        if (words.length > 0) {
            document.getElementById('word-list').value = words.join('\n');
            alert(`Loaded ${words.length} words from CSV.`);
        }
    };
    reader.readAsText(file);
});

// ── Language change ─────────────────────────────────────────────────────────────
document.getElementById('puzzle-language').addEventListener('change', () => {
    // Update the placeholder to show the new auto-label (e.g. Rätsel #1)
    const autoLabel = `${getPuzzleLabel()} #1`;
    document.getElementById('puzzle-title').placeholder = autoLabel;
    // If the user has NOT manually typed a custom title, clear the field
    // so renderPuzzleToDOM uses the auto-label
    if (!titleManuallyEdited) {
        document.getElementById('puzzle-title').value = '';
    }
    generateBatch();
});

// ── Puzzle title: live-update ────────────────────────────────────────────────────
document.getElementById('puzzle-title').addEventListener('input', () => {
    const rawTitle = document.getElementById('puzzle-title').value;
    // Mark as manually edited when user types anything
    if (rawTitle.length > 0) titleManuallyEdited = true;

    // A title is "hidden" only when it's all-spaces
    const isSpaceOnly = rawTitle.length > 0 && rawTitle.trim().length === 0;
    const showTitle   = !isSpaceOnly;
    const titleText   = rawTitle.trim();

    currentPuzzlesData.forEach(pd => {
        pd.settings.title               = titleText;
        pd.settings.showTitle           = showTitle;
        pd.settings.titleManuallyEdited = titleManuallyEdited;
    });

    updatePreview();
});

// ── Background image upload ───────────────────────────────────────────────────
document.getElementById('bg-image-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        bgImageData = ev.target.result; // full data-URL
        document.getElementById('bg-image-upload-label').textContent = `✓ ${file.name}`;
        generateBatch();
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // allow re-upload of same file
});

document.getElementById('bg-image-clear').addEventListener('click', () => {
    bgImageData = null;
    document.getElementById('bg-image-upload-label').textContent = 'Upload PNG';
    generateBatch();
});

// ── Slider live-value badges ──────────────────────────────────────────────────
const bgOpacitySlider  = document.getElementById('bg-opacity');
const bgOpacityBadge   = document.getElementById('bg-opacity-value');
const contentScaleSlider = document.getElementById('content-scale');
const contentScaleBadge  = document.getElementById('content-scale-value');

if (bgOpacitySlider && bgOpacityBadge) {
    bgOpacitySlider.addEventListener('input', () => {
        bgOpacityBadge.textContent = `${bgOpacitySlider.value}%`;
        generateBatch();
    });
}
if (contentScaleSlider && contentScaleBadge) {
    contentScaleSlider.addEventListener('input', () => {
        contentScaleBadge.textContent = `${contentScaleSlider.value}%`;
        generateBatch();
    });
}

// ── Page margin change re-renders preview ─────────────────────────────────────
document.getElementById('page-margin').addEventListener('change', generateBatch);

// ── Initial generation ─────────────────────────────────────────────────────────────
window.addEventListener('settingsChanged', generateBatch);
setTimeout(() => {
    // Set the initial placeholder to reflect the default language (English)
    document.getElementById('puzzle-title').placeholder = `${getPuzzleLabel()} #1`;
    generateBatch();
}, 500); // give fonts a moment to load
