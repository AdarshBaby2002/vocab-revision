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
        learnerCount.textContent = '...';
        wordCount.textContent = '...';
        usersList.innerHTML = '';
        usersList.appendChild(emptyState('Loading admin data...'));
        showImportStatus('Loading admin data...', '');
        if (refreshBtn) refreshBtn.disabled = true;

        try {
            const [usersSnapshot, vocabSnapshot] = await Promise.all([
                database.ref('users').once('value'),
                database.ref('vocab').once('value')
            ]);

            usersCache = usersSnapshot.val() || {};
            vocabCache = vocabSnapshot.val() || {};

            learnerCount.textContent = Object.keys(usersCache).length;
            wordCount.textContent = Object.keys(vocabCache).length;

            renderUsers();
            showImportStatus('', '');
        } catch (error) {
            console.error('Failed to load admin data:', error);
            learnerCount.textContent = '!';
            wordCount.textContent = '!';
            usersList.innerHTML = '';
            usersList.appendChild(emptyState('Could not load learners. Check database access and try again.'));
            showImportStatus('Could not load admin data: ' + error.message, 'error');
        } finally {
            if (refreshBtn) refreshBtn.disabled = false;
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

    function buildVocabById() {
        const byId = {};
        Object.values(vocabCache).forEach(item => {
            if (item && item.id !== undefined && item.id !== null) {
                byId[String(item.id)] = item;
            }
        });
        return byId;
    }

    function getAttemptLevel(attempt, vocabById) {
        if (attempt.level) return attempt.level;
        const vocabItem = vocabById[String(attempt.vocabId || '')];
        if (vocabItem && vocabItem.level) return vocabItem.level;
        return attempt.source === 'online' ? 'Online' : 'Saved';
    }

    function getAttemptStats(attempts, vocabById) {
        const values = Object.values(attempts || {}).filter(attempt => attempt && typeof attempt === 'object');
        const stats = {
            total: values.length,
            correct: values.filter(attempt => attempt.correct === true).length,
            wrong: values.filter(attempt => attempt.correct !== true).length,
            byLevel: {},
            wrongGroups: {}
        };

        values.forEach(attempt => {
            const level = getAttemptLevel(attempt, vocabById);
            if (!stats.byLevel[level]) {
                stats.byLevel[level] = { attempts: 0, correct: 0, wrong: 0 };
            }

            stats.byLevel[level].attempts += 1;
            if (attempt.correct === true) {
                stats.byLevel[level].correct += 1;
                return;
            }

            stats.byLevel[level].wrong += 1;

            const questionId = attempt.questionId || `${attempt.direction || ''}:${attempt.questionText || ''}`;
            const userAnswer = String(attempt.userAnswer || '').trim() || 'I do not know';
            const wrongKey = [
                questionId,
                normalizeText(userAnswer),
                attempt.correctAnswers || ''
            ].join('|');

            if (!stats.wrongGroups[wrongKey]) {
                stats.wrongGroups[wrongKey] = {
                    questionText: attempt.questionText || 'Unknown question',
                    direction: attempt.direction || 'Unknown direction',
                    userAnswer,
                    correctAnswers: attempt.correctAnswers || 'Unknown answer',
                    level,
                    count: 0,
                    lastAt: 0
                };
            }

            stats.wrongGroups[wrongKey].count += 1;
            stats.wrongGroups[wrongKey].lastAt = Math.max(
                stats.wrongGroups[wrongKey].lastAt,
                Number(attempt.createdAt || 0)
            );
        });

        return stats;
    }

    function appendStatPill(container, label, value, className = '') {
        const pill = document.createElement('span');
        pill.className = className ? `stat-pill ${className}` : 'stat-pill';

        const pillLabel = document.createElement('span');
        pillLabel.textContent = label;

        const pillValue = document.createElement('strong');
        pillValue.textContent = value;

        pill.appendChild(pillLabel);
        pill.appendChild(pillValue);
        container.appendChild(pill);
    }

    function renderLevelStats(stats) {
        const wrapper = document.createElement('div');
        wrapper.className = 'level-stats';

        Object.entries(stats.byLevel)
            .sort(([levelA], [levelB]) => levelA.localeCompare(levelB))
            .forEach(([level, levelStats]) => {
                const row = document.createElement('div');
                row.className = 'level-stat-row';

                const label = document.createElement('strong');
                label.textContent = level;

                const values = document.createElement('span');
                values.textContent = `${levelStats.attempts} attempts | ${levelStats.correct} correct | ${levelStats.wrong} wrong`;

                row.appendChild(label);
                row.appendChild(values);
                wrapper.appendChild(row);
            });

        if (!wrapper.children.length) {
            const empty = document.createElement('span');
            empty.className = 'empty-inline';
            empty.textContent = 'No attempts yet.';
            wrapper.appendChild(empty);
        }

        return wrapper;
    }

    function renderWrongAnswerDetails(stats) {
        const groups = Object.values(stats.wrongGroups)
            .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);

        const details = document.createElement('details');
        details.className = 'wrong-answer-details';

        const summary = document.createElement('summary');
        summary.textContent = groups.length
            ? `Wrong answers (${groups.length} repeated answer ${groups.length === 1 ? 'group' : 'groups'})`
            : 'Wrong answers';
        details.appendChild(summary);

        if (groups.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'No wrong answers recorded.';
            details.appendChild(empty);
            return details;
        }

        const list = document.createElement('div');
        list.className = 'wrong-answer-list';

        groups.forEach(group => {
            const item = document.createElement('article');
            item.className = 'wrong-answer-item';

            const header = document.createElement('div');
            header.className = 'wrong-answer-header';

            const question = document.createElement('strong');
            question.textContent = group.questionText;

            const count = document.createElement('span');
            count.className = 'wrong-count';
            count.textContent = `${group.count}x`;

            header.appendChild(question);
            header.appendChild(count);

            const meta = document.createElement('small');
            meta.textContent = `${group.level} | ${group.direction}`;

            const answer = document.createElement('span');
            answer.textContent = `Wrong answer: ${group.userAnswer}`;

            const correct = document.createElement('span');
            correct.textContent = `Correct: ${group.correctAnswers}`;

            item.appendChild(header);
            item.appendChild(meta);
            item.appendChild(answer);
            item.appendChild(correct);
            list.appendChild(item);
        });

        details.appendChild(list);
        return details;
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
        const vocabById = buildVocabById();

        if (entries.length === 0) {
            usersList.appendChild(emptyState('No learners yet.'));
            return;
        }

        entries.forEach(([uid, userData]) => {
            const profile = userData.profile || {};
            const progress = userData.progress || {};
            const attempts = userData.attempts || {};
            const stats = getAttemptStats(attempts, vocabById);

            const row = document.createElement('article');
            row.className = 'admin-row';

            const title = document.createElement('strong');
            title.textContent = profile.email || uid;

            const meta = document.createElement('span');
            meta.textContent = `${Object.keys(progress).length} progress items`;

            const statGrid = document.createElement('div');
            statGrid.className = 'learner-stat-grid';
            appendStatPill(statGrid, 'Attempts', stats.total);
            appendStatPill(statGrid, 'Correct', stats.correct, 'stat-success');
            appendStatPill(statGrid, 'Wrong', stats.wrong, 'stat-error');

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
            row.appendChild(statGrid);
            row.appendChild(renderLevelStats(stats));
            row.appendChild(renderWrongAnswerDetails(stats));
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
