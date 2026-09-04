class WordSearchGenerator {

    /**
     * Normalize a word for use in the grid.
     * - ß  → SS  (as requested: ß always becomes SS)
     * - ä  → Ä,  ö → Ö,  ü → Ü  (Umlauts are uppercased and kept)
     * - Everything else is uppercased, non-letter chars stripped.
     */
    static normalizeWord(w) {
        return w
            .replace(/ß/g, 'SS')          // ß → SS  (before toUpperCase so ß isn't lost)
            .replace(/ä/gi, 'Ä')           // ä / Ä kept
            .replace(/ö/gi, 'Ö')           // ö / Ö kept
            .replace(/ü/gi, 'Ü')           // ü / Ü kept
            .toUpperCase()
            .replace(/[^A-ZÄÖÜ]/g, '');   // strip everything that isn't a letter we support
    }

    constructor(config) {
        this.rows = config.rows || 15;
        this.cols = config.cols || 15;
        // Normalize each word; remember the display form (normalized = grid form = clue form)
        this.words = (config.words || []).map(w => WordSearchGenerator.normalizeWord(w));
        this.directions = config.directions || ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'];
        this.allowBackwards = config.allowBackwards !== false;
        
        this.grid = [];
        this.placedWords = [];
        this.unplacedWords = [];
    }

    // Direction vectors [row_delta, col_delta]
    static DIRS = {
        'N': [-1, 0],
        'S': [1, 0],
        'E': [0, 1],
        'W': [0, -1],
        'NE': [-1, 1],
        'NW': [-1, -1],
        'SE': [1, 1],
        'SW': [1, -1]
    };

    generate() {
        // Initialize empty grid
        for (let r = 0; r < this.rows; r++) {
            this.grid.push(new Array(this.cols).fill(''));
        }

        // Sort words by length descending (longest words are hardest to place)
        const sortedWords = [...this.words].sort((a, b) => b.length - a.length);

        for (const word of sortedWords) {
            if (!this.placeWord(word)) {
                this.unplacedWords.push(word);
            }
        }

        // Fill remaining spaces with random letters
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.grid[r][c] === '') {
                    this.grid[r][c] = alphabet.charAt(Math.floor(Math.random() * alphabet.length));
                }
            }
        }

        return {
            grid: this.grid,
            placedWords: this.placedWords,
            unplacedWords: this.unplacedWords
        };
    }

    placeWord(word) {
        let actualWord = word;
        
        // Randomly decide whether to try it backwards if allowed
        if (this.allowBackwards && Math.random() > 0.5) {
            actualWord = word.split('').reverse().join('');
        }

        const allowedDirs = this.directions;
        if (allowedDirs.length === 0) return false;

        // Create a list of all possible starting positions
        let positions = [];
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                positions.push([r, c]);
            }
        }

        // Shuffle positions
        positions = this.shuffle(positions);

        for (const [r, c] of positions) {
            // Shuffle directions for this position
            const dirs = this.shuffle([...allowedDirs]);
            
            for (const dirName of dirs) {
                const [dr, dc] = WordSearchGenerator.DIRS[dirName];
                
                if (this.canPlace(actualWord, r, c, dr, dc)) {
                    this.doPlace(actualWord, r, c, dr, dc, word); // Pass original word to placedWords
                    return true;
                }
            }
        }

        // If we tried it forwards and failed, and allowBackwards is true, try backwards as fallback
        if (this.allowBackwards && actualWord === word) {
            const backWord = word.split('').reverse().join('');
            for (const [r, c] of positions) {
                const dirs = this.shuffle([...allowedDirs]);
                for (const dirName of dirs) {
                    const [dr, dc] = WordSearchGenerator.DIRS[dirName];
                    if (this.canPlace(backWord, r, c, dr, dc)) {
                        this.doPlace(backWord, r, c, dr, dc, word);
                        return true;
                    }
                }
            }
        }

        return false;
    }

    canPlace(word, r, c, dr, dc) {
        for (let i = 0; i < word.length; i++) {
            const nr = r + i * dr;
            const nc = c + i * dc;
            
            // Check bounds
            if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) {
                return false;
            }
            
            // Check overlap conflict
            const currentCell = this.grid[nr][nc];
            if (currentCell !== '' && currentCell !== word[i]) {
                return false;
            }
        }
        return true;
    }

    doPlace(word, r, c, dr, dc, originalWord) {
        const path = [];
        for (let i = 0; i < word.length; i++) {
            const nr = r + i * dr;
            const nc = c + i * dc;
            this.grid[nr][nc] = word[i];
            path.push([nr, nc]);
        }
        this.placedWords.push({
            word: originalWord,
            path: path
        });
    }

    shuffle(array) {
        let currentIndex = array.length, randomIndex;
        while (currentIndex > 0) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;
            [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
        }
        return array;
    }
}
