document.addEventListener('DOMContentLoaded', () => {
    const adminContent = document.getElementById('admin-content');
    const learnerCount = document.getElementById('learner-count');
    const wordCount = document.getElementById('word-count');
    const sectionCount = document.getElementById('section-count');
    const usersList = document.getElementById('users-list');
    const refreshBtn = document.getElementById('refresh-admin-btn');
    const importSectionName = document.getElementById('import-section-name');
    const importText = document.getElementById('import-text');
    const importBtn = document.getElementById('import-vocab-btn');
    const clearImportBtn = document.getElementById('clear-import-btn');
    const clearVocabBtn = document.getElementById('clear-vocab-btn');
    const resetAllQuizBtn = document.getElementById('reset-all-quiz-btn');
    const importStatus = document.getElementById('import-status');
    const sectionsList = document.getElementById('sections-list');
    const sectionEditor = document.getElementById('section-editor');
    const sectionEditorHeading = document.getElementById('section-editor-heading');
    const editSectionName = document.getElementById('edit-section-name');
    const editSectionText = document.getElementById('edit-section-text');
    const saveSectionBtn = document.getElementById('save-section-btn');
    const deleteSectionBtn = document.getElementById('delete-section-btn');
    const cancelSectionEditBtn = document.getElementById('cancel-section-edit-btn');
    const sectionEditStatus = document.getElementById('section-edit-status');

    let usersCache = {};
    let vocabCache = {};
    let importersCache = {};
    let currentUser = null;
    let selectedSectionKey = '';

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
            importSectionName.value = '';
            importText.value = '';
            showImportStatus('', '');
        });
    }

    if (clearVocabBtn) {
        clearVocabBtn.addEventListener('click', handleClearVocabulary);
    }

    if (resetAllQuizBtn) {
        resetAllQuizBtn.addEventListener('click', handleResetAllQuizStatus);
    }

    if (saveSectionBtn) {
        saveSectionBtn.addEventListener('click', handleSaveSection);
    }

    if (deleteSectionBtn) {
        deleteSectionBtn.addEventListener('click', handleDeleteSection);
    }

    if (cancelSectionEditBtn) {
        cancelSectionEditBtn.addEventListener('click', () => {
            clearSectionEditor();
            renderSections();
        });
    }

    async function loadAdminData() {
        learnerCount.textContent = '...';
        wordCount.textContent = '...';
        if (sectionCount) sectionCount.textContent = '...';
        usersList.innerHTML = '';
        usersList.appendChild(emptyState('Loading admin data...'));
        if (sectionsList) {
            sectionsList.innerHTML = '';
            sectionsList.appendChild(emptyState('Loading sections...'));
        }
        showImportStatus('Loading admin data...', '');
        showSectionEditStatus('', '');
        if (refreshBtn) refreshBtn.disabled = true;

        try {
            const [usersSnapshot, vocabSnapshot, importersSnapshot] = await Promise.all([
                database.ref('users').once('value'),
                database.ref('vocab').once('value'),
                database.ref('importers').once('value')
            ]);

            usersCache = usersSnapshot.val() || {};
            vocabCache = vocabSnapshot.val() || {};
            importersCache = importersSnapshot.val() || {};

            learnerCount.textContent = Object.keys(usersCache).length;
            wordCount.textContent = Object.keys(vocabCache).length;
            if (sectionCount) sectionCount.textContent = getSectionSummaries().length;

            renderUsers();
            renderSections();
            showImportStatus('', '');
        } catch (error) {
            console.error('Failed to load admin data:', error);
            learnerCount.textContent = '!';
            wordCount.textContent = '!';
            if (sectionCount) sectionCount.textContent = '!';
            usersList.innerHTML = '';
            usersList.appendChild(emptyState('Could not load learners. Check database access and try again.'));
            if (sectionsList) {
                sectionsList.innerHTML = '';
                sectionsList.appendChild(emptyState('Could not load sections.'));
            }
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

    function getItemSectionKey(item) {
        const storedKey = String(item.sectionKey || '').trim();
        if (storedKey) return storedKey;

        const sectionName = String(item.sectionName || '').trim();
        if (sectionName) return createSectionKey(sectionName);

        return 'unsectioned';
    }

    function getSectionSummaries() {
        const sections = new Map();

        buildVocabArray().forEach(item => {
            const key = getItemSectionKey(item);
            const label = String(item.sectionName || '').trim() || 'No section';

            if (!sections.has(key)) {
                sections.set(key, {
                    key,
                    label,
                    count: 0,
                    latestTimestamp: ''
                });
            }

            const section = sections.get(key);
            section.count += 1;
            section.latestTimestamp = [section.latestTimestamp, item.updatedAt, item.timestamp]
                .filter(Boolean)
                .sort()
                .pop() || '';
        });

        return Array.from(sections.values())
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    function getSectionItems(sectionKey) {
        return buildVocabArray()
            .filter(item => getItemSectionKey(item) === sectionKey)
            .sort((a, b) => {
                const idA = Number(a.id || 0);
                const idB = Number(b.id || 0);
                if (idA !== idB) return idA - idB;
                return String(a.firebaseKey).localeCompare(String(b.firebaseKey));
            });
    }

    function formatSectionLine(item) {
        const germanParts = [item.german, ...(Array.isArray(item.synonyms) ? item.synonyms : [])]
            .map(value => String(value || '').trim())
            .filter(Boolean);

        return `${germanParts.join(' / ')} - ${String(item.english || '').trim()}`;
    }

    function renderSections() {
        if (!sectionsList) return;

        sectionsList.innerHTML = '';
        const sections = getSectionSummaries();
        if (sectionCount) sectionCount.textContent = sections.length;

        if (sections.length === 0) {
            sectionsList.appendChild(emptyState('No sections yet.'));
            clearSectionEditor();
            return;
        }

        sections.forEach(section => {
            const row = document.createElement('article');
            row.className = section.key === selectedSectionKey
                ? 'admin-row section-row is-selected'
                : 'admin-row section-row';

            const title = document.createElement('strong');
            title.textContent = section.label;

            const meta = document.createElement('span');
            meta.textContent = `${section.count} ${section.count === 1 ? 'word' : 'words'}`;

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'btn-secondary btn-small';
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => openSectionEditor(section.key));

            row.appendChild(title);
            row.appendChild(meta);
            row.appendChild(editBtn);
            sectionsList.appendChild(row);
        });

        if (selectedSectionKey && !sections.some(section => section.key === selectedSectionKey)) {
            clearSectionEditor();
        }
    }

    function openSectionEditor(sectionKey) {
        const items = getSectionItems(sectionKey);
        if (items.length === 0) {
            clearSectionEditor();
            showSectionEditStatus('That section no longer exists.', 'error');
            return;
        }

        selectedSectionKey = sectionKey;
        const sectionName = String(items[0].sectionName || '').trim() || 'No section';
        editSectionName.value = sectionName === 'No section' ? '' : sectionName;
        editSectionText.value = items.map(formatSectionLine).join('\n');
        sectionEditor.style.display = 'grid';
        sectionEditorHeading.textContent = `${sectionName} (${items.length})`;
        showSectionEditStatus('', '');
        renderSections();
    }

    function clearSectionEditor() {
        selectedSectionKey = '';
        if (editSectionName) editSectionName.value = '';
        if (editSectionText) editSectionText.value = '';
        if (sectionEditor) sectionEditor.style.display = 'none';
        if (sectionEditorHeading) sectionEditorHeading.textContent = 'Select a section to edit it.';
        showSectionEditStatus('', '');
    }

    function showSectionEditStatus(message, type) {
        if (!sectionEditStatus) return;
        sectionEditStatus.textContent = message;
        sectionEditStatus.className = type ? `admin-status status-${type}` : 'admin-status';
    }

    function applyVocabFieldUpdates(updates, firebaseKey, fields) {
        const itemPath = `vocab/${firebaseKey}`;

        if (updates[itemPath]) {
            Object.assign(updates[itemPath], fields);
            return;
        }

        Object.entries(fields).forEach(([field, value]) => {
            updates[`${itemPath}/${field}`] = value;
        });
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
                if (!matchingItem.sectionName && sectionName) {
                    applyVocabFieldUpdates(updates, matchingItem.firebaseKey, {
                        sectionName,
                        sectionKey,
                        updatedAt: new Date().toISOString(),
                        updatedBy: currentUser.uid,
                        updatedByEmail: currentUser.email || ''
                    });
                    matchingItem.sectionName = sectionName;
                    matchingItem.sectionKey = sectionKey;
                    stats.merged += 1;
                    return;
                }

                stats.skippedDuplicates += 1;
                return;
            }

            const updatedSynonyms = uniqueGermanAnswers([
                ...(Array.isArray(matchingItem.synonyms) ? matchingItem.synonyms : []),
                ...newAnswers
            ]).filter(answer => normalizeGermanAnswer(answer) !== normalizeGermanAnswer(matchingItem.german));

            const now = new Date().toISOString();
            const mergedFields = {
                synonyms: updatedSynonyms,
                updatedAt: now,
                updatedBy: currentUser.uid,
                updatedByEmail: currentUser.email || ''
            };

            applyVocabFieldUpdates(updates, matchingItem.firebaseKey, mergedFields);

            matchingItem.synonyms = updatedSynonyms;
            if (!matchingItem.sectionName && sectionName) {
                applyVocabFieldUpdates(updates, matchingItem.firebaseKey, { sectionName, sectionKey });
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
            source: 'admin-import',
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

    async function handleSaveSection() {
        if (!currentUser || !selectedSectionKey) return;

        const sectionName = editSectionName.value.trim();
        const text = editSectionText.value.trim();
        const newSectionKey = createSectionKey(sectionName);

        if (!sectionName) {
            showSectionEditStatus('Enter a section name before saving.', 'error');
            editSectionName.focus();
            return;
        }

        if (!text) {
            showSectionEditStatus('Enter vocabulary lines before saving.', 'error');
            editSectionText.focus();
            return;
        }

        const existingSection = getSectionSummaries()
            .find(section => section.key === newSectionKey && section.key !== selectedSectionKey);
        if (existingSection) {
            showSectionEditStatus(`A section named "${existingSection.label}" already exists. Choose a different name.`, 'error');
            editSectionName.focus();
            return;
        }

        const { entries, skipped } = parseImportText(text);
        if (entries.length === 0) {
            showSectionEditStatus('No valid vocabulary lines found.', 'error');
            return;
        }

        if (skipped.length > 0 && !confirm(`Lines ${skipped.join(', ')} could not be read and will be ignored. Save anyway?`)) {
            return;
        }

        const originalItems = getSectionItems(selectedSectionKey);
        if (originalItems.length === 0) {
            showSectionEditStatus('This section no longer exists. Refresh and try again.', 'error');
            return;
        }

        saveSectionBtn.disabled = true;
        saveSectionBtn.textContent = 'Saving...';
        if (deleteSectionBtn) deleteSectionBtn.disabled = true;

        try {
            const updates = {};
            const now = new Date().toISOString();
            const timestampBase = Date.now();

            entries.forEach((entry, index) => {
                const fields = {
                    german: entry.german,
                    english: entry.english,
                    synonyms: uniqueGermanAnswers(entry.synonyms || [])
                        .filter(answer => normalizeGermanAnswer(answer) !== normalizeGermanAnswer(entry.german)),
                    sectionName,
                    sectionKey: newSectionKey,
                    updatedAt: now,
                    updatedBy: currentUser.uid,
                    updatedByEmail: currentUser.email || ''
                };

                const existingItem = originalItems[index];
                if (existingItem) {
                    applyVocabFieldUpdates(updates, existingItem.firebaseKey, fields);
                    return;
                }

                const newKey = database.ref('vocab').push().key;
                updates[`vocab/${newKey}`] = {
                    id: timestampBase + index,
                    ...fields,
                    createdBy: currentUser.uid,
                    createdByEmail: currentUser.email || '',
                    source: 'admin-section-edit',
                    timestamp: now
                };
            });

            originalItems.slice(entries.length).forEach(item => {
                updates[`vocab/${item.firebaseKey}`] = null;
            });

            await database.ref().update(updates);
            selectedSectionKey = newSectionKey;
            await loadAdminData();
            openSectionEditor(newSectionKey);
            showSectionEditStatus(`Saved ${entries.length} ${entries.length === 1 ? 'word' : 'words'} in "${sectionName}".`, 'success');
        } catch (error) {
            console.error('Failed to save section:', error);
            showSectionEditStatus('Failed to save section: ' + error.message, 'error');
        } finally {
            saveSectionBtn.disabled = false;
            saveSectionBtn.textContent = 'Save Section';
            if (deleteSectionBtn) deleteSectionBtn.disabled = false;
        }
    }

    async function handleDeleteSection() {
        if (!currentUser || !selectedSectionKey) return;

        const items = getSectionItems(selectedSectionKey);
        if (items.length === 0) {
            showSectionEditStatus('This section no longer exists.', 'error');
            return;
        }

        const sectionName = editSectionName.value.trim() || 'this section';
        if (!confirm(`Delete "${sectionName}" and its ${items.length} ${items.length === 1 ? 'word' : 'words'}? This cannot be undone.`)) {
            return;
        }

        deleteSectionBtn.disabled = true;
        deleteSectionBtn.textContent = 'Deleting...';
        if (saveSectionBtn) saveSectionBtn.disabled = true;

        try {
            const updates = {};
            items.forEach(item => {
                updates[`vocab/${item.firebaseKey}`] = null;
            });

            await database.ref().update(updates);
            clearSectionEditor();
            await loadAdminData();
            showImportStatus(`Deleted "${sectionName}".`, 'success');
        } catch (error) {
            console.error('Failed to delete section:', error);
            showSectionEditStatus('Failed to delete section: ' + error.message, 'error');
        } finally {
            deleteSectionBtn.disabled = false;
            deleteSectionBtn.textContent = 'Delete Section';
            if (saveSectionBtn) saveSectionBtn.disabled = false;
        }
    }

    function showImportStatus(message, type) {
        importStatus.textContent = message;
        importStatus.className = type ? `admin-status status-${type}` : 'admin-status';
    }

    function formatLastSeen(value) {
        if (!value) return 'Never recorded';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Never recorded';
        return date.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
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

            const lastSeen = document.createElement('span');
            lastSeen.textContent = `Last active: ${formatLastSeen(profile.lastLoginAt)}`;

            const statGrid = document.createElement('div');
            statGrid.className = 'learner-stat-grid';
            appendStatPill(statGrid, 'Attempts', stats.total);
            appendStatPill(statGrid, 'Correct', stats.correct, 'stat-success');
            appendStatPill(statGrid, 'Wrong', stats.wrong, 'stat-error');

            const small = document.createElement('small');
            small.textContent = `UID: ${uid}`;

            const actions = document.createElement('div');
            actions.className = 'admin-actions';

            const importAccessLabel = document.createElement('label');
            importAccessLabel.className = 'checkbox-row';

            const importAccessCheckbox = document.createElement('input');
            importAccessCheckbox.type = 'checkbox';
            importAccessCheckbox.checked = importersCache[uid] === true;
            importAccessCheckbox.disabled = uid === currentUser.uid;
            importAccessCheckbox.addEventListener('change', () => {
                handleImporterAccessChange(uid, profile.email, importAccessCheckbox.checked, importAccessCheckbox);
            });

            const importAccessText = document.createElement('span');
            importAccessText.textContent = 'Can import vocabulary';

            importAccessLabel.appendChild(importAccessCheckbox);
            importAccessLabel.appendChild(importAccessText);

            const resetBtn = document.createElement('button');
            resetBtn.className = 'btn-secondary btn-small';
            resetBtn.textContent = 'Reset Password';
            resetBtn.onclick = () => handleResetPassword(profile.email);

            const resetQuizBtn = document.createElement('button');
            resetQuizBtn.className = 'btn-secondary btn-small';
            resetQuizBtn.textContent = 'Reset Quiz';
            resetQuizBtn.onclick = () => handleResetQuizStatus(uid, profile.email);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-danger btn-small';
            deleteBtn.textContent = 'Delete Data';
            deleteBtn.onclick = () => handleDeleteUser(uid, profile.email);

            if (profile.email) actions.appendChild(resetBtn);
            actions.appendChild(resetQuizBtn);
            actions.appendChild(deleteBtn);

            row.appendChild(title);
            row.appendChild(meta);
            row.appendChild(lastSeen);
            row.appendChild(statGrid);
            row.appendChild(renderLevelStats(stats));
            row.appendChild(small);
            row.appendChild(importAccessLabel);
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

    async function handleImporterAccessChange(uid, email, canImport, checkbox) {
        const label = email || uid;
        checkbox.disabled = true;

        try {
            await database.ref(`importers/${uid}`).set(canImport ? true : null);
            if (canImport) {
                importersCache[uid] = true;
            } else {
                delete importersCache[uid];
            }
            showImportStatus(`${label} ${canImport ? 'can now import vocabulary.' : 'can no longer import vocabulary.'}`, 'success');
        } catch (error) {
            console.error('Failed to update import access:', error);
            checkbox.checked = !canImport;
            showImportStatus('Failed to update import access: ' + error.message, 'error');
        } finally {
            checkbox.disabled = uid === currentUser.uid;
        }
    }

    async function handleResetQuizStatus(uid, email) {
        const label = email || uid;
        if (!confirm(`Reset quiz status for ${label}? This removes progress, attempts, stats, wrong-answer groups, and retry streaks.`)) return;

        const secondConfirm = prompt(`Type RESET QUIZ to confirm resetting quiz status for ${label}.`);
        if (secondConfirm !== 'RESET QUIZ') return;

        try {
            await database.ref().update({
                [`users/${uid}/progress`]: null,
                [`users/${uid}/attempts`]: null,
                [`users/${uid}/quizStats`]: null,
                [`users/${uid}/wrongAnswerGroups`]: null,
                [`users/${uid}/wrongReview`]: null
            });
            alert('Quiz status reset successfully.');
            loadAdminData();
        } catch (error) {
            console.error('Error resetting quiz status:', error);
            alert('Failed to reset quiz status: ' + error.message);
        }
    }

    async function handleResetAllQuizStatus() {
        const users = Object.keys(usersCache);
        if (users.length === 0) {
            alert('There are no learners to reset.');
            return;
        }

        if (!confirm(`Reset quiz status for all ${users.length} learners? This removes progress, attempts, stats, wrong-answer groups, and retry streaks.`)) return;

        const secondConfirm = prompt('Type RESET ALL QUIZ to confirm resetting every learner quiz status.');
        if (secondConfirm !== 'RESET ALL QUIZ') return;

        resetAllQuizBtn.disabled = true;
        resetAllQuizBtn.textContent = 'Resetting...';

        try {
            const updates = {};
            users.forEach(uid => {
                updates[`users/${uid}/progress`] = null;
                updates[`users/${uid}/attempts`] = null;
                updates[`users/${uid}/quizStats`] = null;
                updates[`users/${uid}/wrongAnswerGroups`] = null;
                updates[`users/${uid}/wrongReview`] = null;
            });

            await database.ref().update(updates);
            alert('All learner quiz statuses reset successfully.');
            loadAdminData();
        } catch (error) {
            console.error('Error resetting all quiz statuses:', error);
            alert('Failed to reset all quiz statuses: ' + error.message);
        } finally {
            resetAllQuizBtn.disabled = false;
            resetAllQuizBtn.textContent = 'Reset All Quiz';
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
