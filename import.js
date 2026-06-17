document.addEventListener('DOMContentLoaded', () => {
    const importContent = document.getElementById('import-content');
    const importSectionName = document.getElementById('import-section-name');
    const importText = document.getElementById('import-text');
    const importBtn = document.getElementById('import-vocab-btn');
    const clearImportBtn = document.getElementById('clear-import-btn');
    const importStatus = document.getElementById('import-status');

    let vocabCache = {};
    let currentUser = null;

    initializeAuthUi({
        required: true,
        importerOnly: true,
        onSignedIn: (user) => {
            currentUser = user;
            importContent.style.display = 'block';
            loadVocabData();
        },
        onSignedOut: () => {
            currentUser = null;
            importContent.style.display = 'none';
        }
    });

    if (importBtn) {
        importBtn.addEventListener('click', handleImportVocab);
    }

    if (clearImportBtn) {
        clearImportBtn.addEventListener('click', () => {
            importSectionName.value = '';
            importText.value = '';
            showImportStatus('', '');
        });
    }

    async function loadVocabData() {
        showImportStatus('Loading vocabulary...', '');
        importBtn.disabled = true;

        try {
            const snapshot = await database.ref('vocab').once('value');
            vocabCache = snapshot.val() || {};
            showImportStatus('', '');
        } catch (error) {
            console.error('Failed to load vocabulary:', error);
            showImportStatus('Could not load vocabulary: ' + error.message, 'error');
        } finally {
            importBtn.disabled = false;
            hidePageLoader();
        }
    }

    function normalizeText(value) {
        return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function removeGermanArticle(word) {
        return (word || '').trim().replace(/^(der|die|das)\s+/i, '');
    }

    function normalizeGermanAnswer(value) {
        return normalizeText(removeGermanArticle(value || ''));
    }

    function getGermanAnswers(item) {
        const answers = [item.german, ...(Array.isArray(item.synonyms) ? item.synonyms : [])];
        return answers.filter(answer => answer && answer.trim());
    }

    function uniqueGermanAnswers(answers) {
        const seen = new Set();
        return answers.filter(answer => {
            const normalized = normalizeGermanAnswer(answer);
            if (!normalized || seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        });
    }

    function createSectionKey(sectionName) {
        const slug = normalizeText(sectionName)
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        return slug ? `named-section-${slug}` : '';
    }

    function cleanImportLine(line) {
        return line
            .trim()
            .replace(/^[\u2022\*\-]\s*/, '')
            .replace(/^\?\s*/, '')
            .replace(/\s+/g, ' ');
    }

    function shouldSkipImportLine(line) {
        if (!line) return true;
        const lower = line.toLowerCase();
        return lower.includes('thema')
            || lower.includes('verben')
            || lower.includes('nomen')
            || lower.includes('adjektive')
            || lower.includes('click here')
            || lower.includes('all rights reserved')
            || lower.includes('sharing without proper credit');
    }

    function splitImportLine(line) {
        const match = line.match(/\s+(?:-|\u2013|\u2014)\s+/);
        if (!match || typeof match.index !== 'number') return null;

        const german = line.slice(0, match.index).trim();
        const english = line.slice(match.index + match[0].length).trim();
        if (!german || !english) return null;

        return { german, english };
    }

    function splitAlternatives(value) {
        return value
            .split('/')
            .map(part => part.trim())
            .filter(Boolean);
    }

    function parseImportText(text) {
        const entries = [];
        const skipped = [];

        text.split(/\r?\n/).forEach((rawLine, index) => {
            const line = cleanImportLine(rawLine);
            if (shouldSkipImportLine(line)) return;

            const split = splitImportLine(line);
            if (!split) {
                skipped.push(index + 1);
                return;
            }

            const germanParts = splitAlternatives(split.german);
            const englishParts = splitAlternatives(split.english);

            if (germanParts.length > 1 && englishParts.length === germanParts.length) {
                germanParts.forEach((german, partIndex) => {
                    entries.push({ german, english: englishParts[partIndex], synonyms: [] });
                });
                return;
            }

            entries.push({
                german: germanParts[0],
                english: split.english,
                synonyms: germanParts.slice(1)
            });
        });

        return { entries, skipped };
    }

    function buildVocabArray() {
        return Object.entries(vocabCache).map(([firebaseKey, item]) => ({
            firebaseKey,
            ...item
        }));
    }

    function addImportedEntry(entry, updates, localVocab, stats, timestampBase, sectionName, sectionKey) {
        const normalizedEnglish = normalizeText(entry.english);
        const submittedAnswers = uniqueGermanAnswers([entry.german, ...(entry.synonyms || [])]);
        const matchingItems = localVocab.filter(item => normalizeText(item.english) === normalizedEnglish);
        const matchingItem = matchingItems[0];

        if (matchingItem) {
            const existingAnswers = matchingItems.flatMap(getGermanAnswers);
            const existingAnswerKeys = new Set(existingAnswers.map(normalizeGermanAnswer));
            const newAnswers = submittedAnswers.filter(answer => !existingAnswerKeys.has(normalizeGermanAnswer(answer)));

            if (newAnswers.length === 0) {
                stats.skippedDuplicates += 1;
                return;
            }

            const updatedSynonyms = uniqueGermanAnswers([
                ...(Array.isArray(matchingItem.synonyms) ? matchingItem.synonyms : []),
                ...newAnswers
            ]).filter(answer => normalizeGermanAnswer(answer) !== normalizeGermanAnswer(matchingItem.german));

            updates[`vocab/${matchingItem.firebaseKey}/synonyms`] = updatedSynonyms;
            updates[`vocab/${matchingItem.firebaseKey}/updatedAt`] = new Date().toISOString();
            updates[`vocab/${matchingItem.firebaseKey}/updatedBy`] = currentUser.uid;
            updates[`vocab/${matchingItem.firebaseKey}/updatedByEmail`] = currentUser.email || '';

            matchingItem.synonyms = updatedSynonyms;
            if (!matchingItem.sectionName && sectionName) {
                updates[`vocab/${matchingItem.firebaseKey}/sectionName`] = sectionName;
                updates[`vocab/${matchingItem.firebaseKey}/sectionKey`] = sectionKey;
                matchingItem.sectionName = sectionName;
                matchingItem.sectionKey = sectionKey;
            }
            stats.merged += 1;
            return;
        }

        const newKey = database.ref('vocab').push().key;
        const newItem = {
            id: timestampBase + stats.created,
            german: entry.german,
            english: entry.english,
            synonyms: uniqueGermanAnswers(entry.synonyms || [])
                .filter(answer => normalizeGermanAnswer(answer) !== normalizeGermanAnswer(entry.german)),
            createdBy: currentUser.uid,
            createdByEmail: currentUser.email || '',
            source: 'import-page',
            sectionName,
            sectionKey,
            timestamp: new Date().toISOString()
        };

        updates[`vocab/${newKey}`] = newItem;
        localVocab.push({ firebaseKey: newKey, ...newItem });
        stats.created += 1;
    }

    async function handleImportVocab() {
        if (!currentUser) return;

        const text = importText.value.trim();
        const sectionName = importSectionName.value.trim();
        const sectionKey = createSectionKey(sectionName);
        if (!sectionName) {
            showImportStatus('Enter a section name before importing.', 'error');
            importSectionName.focus();
            return;
        }

        if (!text) {
            showImportStatus('Paste vocabulary lines before importing.', 'error');
            importText.focus();
            return;
        }

        const { entries, skipped } = parseImportText(text);
        if (entries.length === 0) {
            showImportStatus('No valid vocabulary lines found.', 'error');
            return;
        }

        importBtn.disabled = true;
        importBtn.textContent = 'Importing...';

        try {
            const updates = {};
            const localVocab = buildVocabArray();
            const stats = { created: 0, merged: 0, skippedDuplicates: 0 };
            const timestampBase = Date.now();

            entries.forEach(entry => {
                addImportedEntry(entry, updates, localVocab, stats, timestampBase, sectionName, sectionKey);
            });

            if (Object.keys(updates).length > 0) {
                await database.ref().update(updates);
            }

            vocabCache = {};
            localVocab.forEach(item => {
                vocabCache[item.firebaseKey] = item;
            });
            showImportStatus(`Imported ${stats.created}, merged ${stats.merged}, skipped duplicates ${stats.skippedDuplicates}. Skipped invalid lines ${skipped.length}.`, 'success');
        } catch (error) {
            console.error('Import failed:', error);
            showImportStatus('Import failed: ' + error.message, 'error');
        } finally {
            importBtn.disabled = false;
            importBtn.textContent = 'Import to DB';
        }
    }

    function showImportStatus(message, type) {
        importStatus.textContent = message;
        importStatus.className = type ? `admin-status status-${type}` : 'admin-status';
    }
});
