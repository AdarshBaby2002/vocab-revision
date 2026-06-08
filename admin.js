document.addEventListener('DOMContentLoaded', () => {
    const adminContent = document.getElementById('admin-content');
    const learnerCount = document.getElementById('learner-count');
    const wordCount = document.getElementById('word-count');
    const usersList = document.getElementById('users-list');
    const refreshBtn = document.getElementById('refresh-admin-btn');
    const importText = document.getElementById('import-text');
    const importBtn = document.getElementById('import-vocab-btn');
    const clearImportBtn = document.getElementById('clear-import-btn');
    const clearVocabBtn = document.getElementById('clear-vocab-btn');
    const importStatus = document.getElementById('import-status');

    let usersCache = {};
    let vocabCache = {};
    let currentUser = null;

    initializeAuthUi({
        required: true,
        adminOnly: true,
        onSignedIn: (user) => {
            currentUser = user;
            adminContent.style.display = 'grid';
            loadAdminData();
        },
        onSignedOut: () => {
            currentUser = null;
            adminContent.style.display = 'none';
        }
    });

    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadAdminData);
    }

    if (importBtn) {
        importBtn.addEventListener('click', handleImportVocab);
    }

    if (clearImportBtn) {
        clearImportBtn.addEventListener('click', () => {
            importText.value = '';
            showImportStatus('', '');
        });
    }

    if (clearVocabBtn) {
        clearVocabBtn.addEventListener('click', handleClearVocabulary);
    }

    async function loadAdminData() {
        const [usersSnapshot, vocabSnapshot] = await Promise.all([
            database.ref('users').once('value'),
            database.ref('vocab').once('value')
        ]);

        usersCache = usersSnapshot.val() || {};
        vocabCache = vocabSnapshot.val() || {};

        learnerCount.textContent = Object.keys(usersCache).length;
        wordCount.textContent = Object.keys(vocabCache).length;

        renderUsers();
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
        const match = line.match(/\s+[–—-]\s+/);
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

    function addImportedEntry(entry, updates, localVocab, stats, timestampBase) {
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
            source: 'admin-import',
            timestamp: new Date().toISOString()
        };

        updates[`vocab/${newKey}`] = newItem;
        localVocab.push({ firebaseKey: newKey, ...newItem });
        stats.created += 1;
    }

    async function handleImportVocab() {
        if (!currentUser) return;

        const text = importText.value.trim();
        if (!text) {
            showImportStatus('Paste vocabulary lines before importing.', 'error');
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
                addImportedEntry(entry, updates, localVocab, stats, timestampBase);
            });

            if (Object.keys(updates).length > 0) {
                await database.ref().update(updates);
            }

            await loadAdminData();
            showImportStatus(`Imported ${stats.created}, merged ${stats.merged}, skipped duplicates ${stats.skippedDuplicates}. Skipped invalid lines ${skipped.length}.`, 'success');
        } catch (error) {
            console.error('Import failed:', error);
            showImportStatus('Import failed: ' + error.message, 'error');
        } finally {
            importBtn.disabled = false;
            importBtn.textContent = 'Import to DB';
        }
    }

    async function handleClearVocabulary() {
        const wordTotal = Object.keys(vocabCache).length;
        if (wordTotal === 0) {
            showImportStatus('There is no vocabulary data to clear.', 'error');
            return;
        }

        const firstConfirm = confirm(`Clear all ${wordTotal} saved vocabulary entries? This cannot be undone.`);
        if (!firstConfirm) return;

        const secondConfirm = prompt('Type CLEAR VOCAB to confirm deleting all saved vocabulary.');
        if (secondConfirm !== 'CLEAR VOCAB') {
            showImportStatus('Clear cancelled.', 'error');
            return;
        }

        clearVocabBtn.disabled = true;
        clearVocabBtn.textContent = 'Clearing...';

        try {
            await database.ref('vocab').remove();
            await loadAdminData();
            showImportStatus('All vocabulary data cleared.', 'success');
        } catch (error) {
            console.error('Failed to clear vocabulary:', error);
            showImportStatus('Failed to clear vocabulary: ' + error.message, 'error');
        } finally {
            clearVocabBtn.disabled = false;
            clearVocabBtn.textContent = 'Clear All Vocabulary';
        }
    }

    function showImportStatus(message, type) {
        importStatus.textContent = message;
        importStatus.className = type ? `admin-status status-${type}` : 'admin-status';
    }



    function renderUsers() {
        usersList.innerHTML = '';
        const entries = Object.entries(usersCache);

        if (entries.length === 0) {
            usersList.appendChild(emptyState('No learners yet.'));
            return;
        }

        entries.forEach(([uid, userData]) => {
            const profile = userData.profile || {};
            const progress = userData.progress || {};
            const attempts = userData.attempts || {};
            const wrongCount = Object.values(attempts).filter(item => !item.correct).length;

            const row = document.createElement('article');
            row.className = 'admin-row';

            const title = document.createElement('strong');
            title.textContent = profile.email || uid;

            const meta = document.createElement('span');
            meta.textContent = `${Object.keys(progress).length} progress items | ${Object.keys(attempts).length} attempts | ${wrongCount} wrong`;

            const small = document.createElement('small');
            small.textContent = `UID: ${uid}`;

            const actions = document.createElement('div');
            actions.className = 'admin-actions';

            const resetBtn = document.createElement('button');
            resetBtn.className = 'btn-secondary btn-small';
            resetBtn.textContent = 'Reset Password';
            resetBtn.onclick = () => handleResetPassword(profile.email);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-danger btn-small';
            deleteBtn.textContent = 'Delete Data';
            deleteBtn.onclick = () => handleDeleteUser(uid, profile.email);

            if (profile.email) actions.appendChild(resetBtn);
            actions.appendChild(deleteBtn);

            row.appendChild(title);
            row.appendChild(meta);
            row.appendChild(small);
            row.appendChild(actions);
            usersList.appendChild(row);
        });
    }



    function emptyState(message) {
        const element = document.createElement('p');
        element.className = 'empty-state';
        element.textContent = message;
        return element;
    }

    async function handleResetPassword(email) {
        if (!email) return;
        if (!confirm(`Send password reset email to ${email}?`)) return;

        try {
            await auth.sendPasswordResetEmail(email);
            alert(`Password reset email sent to ${email}.`);
        } catch (error) {
            console.error('Error sending reset email:', error);
            alert('Failed to send reset email: ' + error.message);
        }
    }

    async function handleDeleteUser(uid, email) {
        if (!confirm(`Are you absolutely sure you want to delete all data for user ${email || uid}? This cannot be undone.`)) return;

        try {
            await database.ref(`users/${uid}`).remove();
            alert('User data deleted successfully.');
            loadAdminData();
        } catch (error) {
            console.error('Error deleting user:', error);
            alert('Failed to delete user data: ' + error.message);
        }
    }
});
