document.addEventListener('DOMContentLoaded', () => {
    const quizForm = document.getElementById('quiz-form');
    const noDataMsg = document.getElementById('no-data-msg');
    const questionLabel = document.getElementById('question-label');
    const questionWord = document.getElementById('question-word');
    const answerInput = document.getElementById('answer');
    const checkBtn = document.getElementById('check-btn');
    const idkBtn = document.getElementById('idk-btn');
    const actionButtons = document.getElementById('action-buttons');
    const statusMessage = document.getElementById('status-message');
    const nextContainer = document.getElementById('next-container');
    const nextBtn = document.getElementById('next-btn');
    const addOnlineBtn = document.getElementById('add-online-btn');
    const newQuestionBtn = document.getElementById('new-question-btn');
    const quizModeSelect = document.getElementById('quiz-mode');
    const quizSourceSelect = document.getElementById('quiz-source');
    const quizLevelSelect = document.getElementById('quiz-level');
    const quizSectionSelect = document.getElementById('quiz-section');
    const quizStatsCard = document.getElementById('quiz-stats-card');
    const quizStatsContent = document.getElementById('quiz-stats-content');

    const ONLINE_WORD_BANK = {
        A1: ['apple', 'bread', 'water', 'house', 'school', 'book', 'family', 'friend', 'day', 'night', 'city', 'food', 'name', 'room', 'table', 'chair', 'milk', 'coffee'],
        A2: ['appointment', 'holiday', 'weather', 'journey', 'market', 'neighbour', 'medicine', 'ticket', 'letter', 'restaurant', 'station', 'question', 'answer', 'birthday', 'kitchen', 'garden'],
        B1: ['experience', 'decision', 'environment', 'education', 'health', 'opinion', 'advantage', 'disadvantage', 'relationship', 'technology', 'conversation', 'permission', 'application', 'improvement'],
        B2: ['achievement', 'requirement', 'responsibility', 'development', 'impression', 'consequence', 'opportunity', 'comparison', 'employment', 'confidence', 'negotiation', 'population'],
        C1: ['assumption', 'awareness', 'commitment', 'controversy', 'implementation', 'interpretation', 'perspective', 'sustainability', 'reliability', 'significance', 'assessment', 'constraint'],
        C2: ['ambiguity', 'comprehension', 'diligence', 'discrepancy', 'elaboration', 'inference', 'mitigation', 'proficiency', 'reconciliation', 'scrutiny', 'sophistication', 'subtlety']
    };

    let vocabData = [];
    let quizProgress = {};
    let currentQuestion = null;
    let currentUser = null;
    let vocabRef = null;
    let progressRef = null;
    let attemptsRef = null;
    let quizStatsRef = null;
    let wrongGroupsRef = null;
    let wrongReviewRef = null;

    let dataLoaded = false;
    let progressLoaded = false;
    let statsLoaded = false;
    let wrongReviewLoaded = false;
    let quizStarted = false;
    let readFailed = false;
    let userStats = getEmptyStats();
    let wrongReviewData = {};
    let loadedWrongGroups = [];
    let loadedWrongGroupKeys = new Set();
    let wrongGroupsCursorRank = null;
    let wrongGroupsHasMore = false;
    let recentQuestionIds = [];
    const sectionSize = 50;
    const wrongReviewTargetStreak = 5;
    const recentQuestionLimit = 3;
    const retryQuestionChance = 0.35;
    const wrongGroupsPageSize = 10;

    loadPreferences();

    initializeAuthUi({
        required: true,
        onSignedIn: (user) => {
            currentUser = user;
            startUserSession(user);
        },
        onSignedOut: () => {
            stopUserSession();
            quizForm.style.display = 'none';
            noDataMsg.style.display = 'block';
            noDataMsg.className = '';
            noDataMsg.textContent = 'Sign in to load your saved progress and answer history.';
        }
    });

    function startUserSession(user) {
        stopUserSession();

        currentUser = user;
        dataLoaded = false;
        progressLoaded = false;
        statsLoaded = false;
        wrongReviewLoaded = false;
        quizStarted = false;
        readFailed = false;
        vocabData = [];
        quizProgress = {};
        wrongReviewData = {};
        userStats = getEmptyStats();
        loadedWrongGroups = [];
        loadedWrongGroupKeys = new Set();
        wrongGroupsCursorRank = null;
        wrongGroupsHasMore = false;
        recentQuestionIds = [];
        quizForm.style.display = 'none';
        if (quizStatsCard) quizStatsCard.style.display = 'none';
        noDataMsg.style.display = 'block';
        noDataMsg.className = '';
        noDataMsg.textContent = 'Loading your vocabulary and quiz progress...';

        vocabRef = database.ref('vocab');
        progressRef = database.ref(`users/${user.uid}/progress`);
        attemptsRef = database.ref(`users/${user.uid}/attempts`);
        quizStatsRef = database.ref(`users/${user.uid}/quizStats`);
        wrongGroupsRef = database.ref(`users/${user.uid}/wrongAnswerGroups`);
        wrongReviewRef = database.ref(`users/${user.uid}/wrongReview`);

        vocabRef.on('value', (snapshot) => {
            const data = snapshot.val();
            vocabData = [];
            if (data) {
                for (const key in data) {
                    vocabData.push({
                        firebaseKey: key,
                        ...data[key]
                    });
                }
            }
            prepareVocabSections();
            updateSectionOptions();
            dataLoaded = true;
            checkAndStart();
        }, (error) => {
            showReadError(`Could not load vocabulary: ${error.message}`);
        });

        progressRef.on('value', (snapshot) => {
            quizProgress = snapshot.val() || {};
            progressLoaded = true;
            checkAndStart();
        }, (error) => {
            showReadError(`Could not load quiz progress: ${error.message}`);
        });

        quizStatsRef.on('value', (snapshot) => {
            userStats = normalizeStoredStats(snapshot.val());
            statsLoaded = true;
            renderUserStats();
            checkAndStart();
        }, (error) => {
            showReadError(`Could not load quiz stats: ${error.message}`);
        });

        wrongReviewRef.on('value', (snapshot) => {
            wrongReviewData = snapshot.val() || {};
            wrongReviewLoaded = true;
            checkAndStart();
        }, (error) => {
            showReadError(`Could not load wrong-answer retry progress: ${error.message}`);
        });

        loadWrongAnswerGroups(true);
    }

    function stopUserSession() {
        if (vocabRef) vocabRef.off();
        if (progressRef) progressRef.off();
        if (quizStatsRef) quizStatsRef.off();
        if (wrongReviewRef) wrongReviewRef.off();
        vocabRef = null;
        progressRef = null;
        attemptsRef = null;
        quizStatsRef = null;
        wrongGroupsRef = null;
        wrongReviewRef = null;
        currentUser = null;
        dataLoaded = false;
        progressLoaded = false;
        statsLoaded = false;
        wrongReviewLoaded = false;
        quizStarted = false;
        readFailed = false;
        vocabData = [];
        quizProgress = {};
        wrongReviewData = {};
        userStats = getEmptyStats();
        loadedWrongGroups = [];
        loadedWrongGroupKeys = new Set();
        wrongGroupsCursorRank = null;
        wrongGroupsHasMore = false;
        recentQuestionIds = [];
        currentQuestion = null;
        if (quizStatsCard) quizStatsCard.style.display = 'none';
    }

    function loadPreferences() {
        try {
            quizModeSelect.value = localStorage.getItem('quizMode') || quizModeSelect.value;
            quizSourceSelect.value = localStorage.getItem('quizSource') || quizSourceSelect.value;
            quizLevelSelect.value = localStorage.getItem('quizLevel') || quizLevelSelect.value;
            if (quizSectionSelect) {
                quizSectionSelect.value = localStorage.getItem('quizSection') || quizSectionSelect.value;
            }
        } catch (e) {
            console.error('Failed to load quiz preferences');
        }

        if (quizSectionSelect) {
            quizSectionSelect.disabled = quizSourceSelect.value === 'online';
        }
    }

    function savePreferences() {
        localStorage.setItem('quizMode', quizModeSelect.value);
        localStorage.setItem('quizSource', quizSourceSelect.value);
        localStorage.setItem('quizLevel', quizLevelSelect.value);
        if (quizSectionSelect) {
            localStorage.setItem('quizSection', quizSectionSelect.value);
        }
    }

    function checkAndStart() {
        if (readFailed || !dataLoaded || !progressLoaded || !statsLoaded || !wrongReviewLoaded || quizStarted) return;

        quizStarted = true;
        loadNextQuestion();
    }

    function showReadError(message) {
        readFailed = true;
        quizStarted = false;
        quizForm.style.display = 'none';
        noDataMsg.style.display = 'block';
        noDataMsg.textContent = message;
        noDataMsg.className = 'status-error';
        if (quizStatsCard) quizStatsCard.style.display = 'none';
        hidePageLoader();
    }

    function buildVocabById() {
        const byId = {};
        vocabData.forEach(item => {
            if (item && item.id !== undefined && item.id !== null) {
                byId[String(item.id)] = item;
            }
        });
        return byId;
    }

    function getVocabSortValue(item) {
        if (item.timestamp) {
            const timestampValue = Date.parse(item.timestamp);
            if (!Number.isNaN(timestampValue)) return timestampValue;
        }

        const numericId = Number(item.id);
        if (!Number.isNaN(numericId)) return numericId;
        return Number.MAX_SAFE_INTEGER;
    }

    function prepareVocabSections() {
        vocabData.sort((a, b) => {
            const sortDiff = getVocabSortValue(a) - getVocabSortValue(b);
            if (sortDiff !== 0) return sortDiff;
            return String(a.firebaseKey || '').localeCompare(String(b.firebaseKey || ''));
        });

        const unsectionedTotal = vocabData.filter(item => !String(item.sectionName || '').trim()).length;
        let unsectionedIndex = 0;
        vocabData.forEach(item => {
            const sectionName = String(item.sectionName || '').trim();
            if (sectionName) {
                item.sectionName = sectionName;
                item.sectionKey = item.sectionKey || createSectionKey(sectionName);
                return;
            }

            item.sectionIndex = Math.floor(unsectionedIndex / sectionSize);
            item.sectionKey = `section-${item.sectionIndex + 1}`;
            item.sectionName = getSectionLabel(item.sectionIndex, unsectionedTotal);
            unsectionedIndex += 1;
        });
    }

    function getSelectedSectionKey() {
        return quizSectionSelect ? quizSectionSelect.value || 'all' : 'all';
    }

    function getSectionLabel(sectionIndex, totalItems) {
        const start = (sectionIndex * sectionSize) + 1;
        const end = Math.min((sectionIndex + 1) * sectionSize, totalItems);
        return `Section ${sectionIndex + 1} (${start}-${end})`;
    }

    function createSectionKey(sectionName) {
        const slug = normalizeText(sectionName)
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        return slug ? `named-section-${slug}` : '';
    }

    function getAvailableSections() {
        const sectionsByKey = new Map();

        vocabData.forEach(item => {
            if (!item.sectionKey) return;

            if (!sectionsByKey.has(item.sectionKey)) {
                sectionsByKey.set(item.sectionKey, {
                    key: item.sectionKey,
                    label: item.sectionName || item.sectionKey,
                    count: 0
                });
            }

            sectionsByKey.get(item.sectionKey).count += 1;
        });

        return Array.from(sectionsByKey.values());
    }

    function updateSectionOptions() {
        if (!quizSectionSelect) return;

        const preferredValue = localStorage.getItem('quizSection') || quizSectionSelect.value || 'all';
        const sections = getAvailableSections();
        quizSectionSelect.innerHTML = '';

        const allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = 'All Sections';
        quizSectionSelect.appendChild(allOption);

        sections.forEach(section => {
            const option = document.createElement('option');
            option.value = section.key;
            option.textContent = `${section.label} (${section.count})`;
            quizSectionSelect.appendChild(option);
        });

        const hasPreferredValue = Array.from(quizSectionSelect.options)
            .some(option => option.value === preferredValue);
        quizSectionSelect.value = hasPreferredValue ? preferredValue : 'all';
    }

    function getSelectedVocabData() {
        const selectedSection = getSelectedSectionKey();
        if (selectedSection === 'all') return vocabData;
        return vocabData.filter(item => item.sectionKey === selectedSection);
    }

    function getAttemptLevel(attempt, vocabById) {
        if (attempt.level) return attempt.level;
        const vocabItem = vocabById[String(attempt.vocabId || '')];
        if (vocabItem && vocabItem.level) return vocabItem.level;
        return attempt.source === 'online' ? 'Online' : 'Saved';
    }

    function getAttemptStats(attempts) {
        const vocabById = buildVocabById();
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

    function getEmptyStats() {
        return {
            total: 0,
            correct: 0,
            wrong: 0,
            byLevel: {},
            wrongGroupTotal: 0
        };
    }

    function normalizeStoredStats(value) {
        if (!value || typeof value !== 'object') return getEmptyStats();
        return {
            total: Number(value.total || 0),
            correct: Number(value.correct || 0),
            wrong: Number(value.wrong || 0),
            byLevel: value.byLevel || {},
            wrongGroupTotal: Number(value.wrongGroupTotal || 0)
        };
    }

    function getWrongGroupKey(attempt) {
        const questionId = attempt.questionId || `${attempt.direction || ''}:${attempt.questionText || ''}`;
        const userAnswer = String(attempt.userAnswer || '').trim() || 'I do not know';
        return [
            questionId,
            normalizeText(userAnswer),
            attempt.correctAnswers || ''
        ].join('|').replace(/[.#$\[\]/]/g, '_');
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
        const groups = loadedWrongGroups;
        const details = document.createElement('details');
        details.className = 'wrong-answer-details';

        const summary = document.createElement('summary');
        summary.textContent = stats.wrongGroupTotal
            ? `Wrong answers (${stats.wrongGroupTotal} repeated answer ${stats.wrongGroupTotal === 1 ? 'group' : 'groups'})`
            : 'Wrong answers';
        details.appendChild(summary);

        if (groups.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = stats.wrongGroupTotal ? 'Loading wrong answers...' : 'No wrong answers recorded.';
            details.appendChild(empty);
            return details;
        }

        const list = document.createElement('div');
        list.className = 'wrong-answer-list';

        groups.forEach(group => {
            list.appendChild(createWrongAnswerItem(group));
        });
        details.appendChild(list);

        if (wrongGroupsHasMore) {
            const loadMore = document.createElement('button');
            loadMore.type = 'button';
            loadMore.className = 'btn-secondary btn-small wrong-answer-load-more';
            loadMore.textContent = 'Load more';
            loadMore.addEventListener('click', async () => {
                loadMore.disabled = true;
                loadMore.textContent = 'Loading...';
                await loadWrongAnswerGroups(false);
            });
            details.appendChild(loadMore);
        }

        return details;
    }

    function createWrongAnswerItem(group) {
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
        return item;
    }

    async function loadWrongAnswerGroups(reset = false) {
        if (!wrongGroupsRef) return;

        if (reset) {
            loadedWrongGroups = [];
            loadedWrongGroupKeys = new Set();
            wrongGroupsCursorRank = null;
        } else {
            wrongGroupsCursorRank = loadedWrongGroups.length
                ? loadedWrongGroups[loadedWrongGroups.length - 1].sortRank
                : null;
        }

        try {
            let query = wrongGroupsRef.orderByChild('sortRank');
            if (wrongGroupsCursorRank !== null && wrongGroupsCursorRank !== undefined) {
                query = query.startAt(wrongGroupsCursorRank);
            }

            const snapshot = await query.limitToFirst(wrongGroupsPageSize + 2).once('value');
            const fetchedGroups = [];
            snapshot.forEach(child => {
                fetchedGroups.push({ firebaseKey: child.key, ...child.val() });
            });

            const newGroups = fetchedGroups.filter(group => !loadedWrongGroupKeys.has(group.firebaseKey));
            wrongGroupsHasMore = newGroups.length > wrongGroupsPageSize;
            newGroups.slice(0, wrongGroupsPageSize).forEach(group => {
                loadedWrongGroups.push(group);
                loadedWrongGroupKeys.add(group.firebaseKey);
            });
            renderUserStats();
        } catch (error) {
            console.error('Failed to load wrong answer groups:', error);
        }
    }

    function renderUserStats() {
        if (!quizStatsCard || !quizStatsContent) return;

        quizStatsContent.innerHTML = '';
        const stats = userStats;

        const statGrid = document.createElement('div');
        statGrid.className = 'learner-stat-grid';
        appendStatPill(statGrid, 'Attempts', stats.total);
        appendStatPill(statGrid, 'Correct', stats.correct, 'stat-success');
        appendStatPill(statGrid, 'Wrong', stats.wrong, 'stat-error');

        quizStatsContent.appendChild(statGrid);
        quizStatsContent.appendChild(renderLevelStats(stats));
        quizStatsContent.appendChild(renderLegacyImportPrompt(stats));
        quizStatsContent.appendChild(renderWrongAnswerDetails(stats));
        quizStatsCard.style.display = 'block';
    }

    function renderLegacyImportPrompt(stats) {
        const wrapper = document.createElement('div');
        wrapper.className = 'legacy-import';

        const text = document.createElement('span');
        text.textContent = stats.total
            ? 'Old attempts may not be included in these grouped stats.'
            : 'Past attempts can be imported once to rebuild these stats.';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-secondary btn-small';
        button.textContent = 'Import old history';
        button.addEventListener('click', async () => {
            button.disabled = true;
            button.textContent = 'Importing...';
            await importLegacyAttempts();
        });

        wrapper.appendChild(text);
        wrapper.appendChild(button);
        return wrapper;
    }

    async function importLegacyAttempts() {
        if (!currentUser || !attemptsRef) return;

        try {
            const snapshot = await attemptsRef.once('value');
            const attempts = snapshot.val() || {};
            const stats = getAttemptStats(attempts);
            const wrongGroups = {};

            Object.values(stats.wrongGroups || {}).forEach(group => {
                const key = getWrongGroupKey(group);
                wrongGroups[key] = {
                    questionText: group.questionText || 'Unknown question',
                    direction: group.direction || 'Unknown direction',
                    userAnswer: group.userAnswer || 'I do not know',
                    correctAnswers: group.correctAnswers || 'Unknown answer',
                    level: group.level || 'Unknown',
                    count: Number(group.count || 0),
                    lastAt: Number(group.lastAt || 0),
                    sortRank: (-Number(group.count || 0) * 10000000000000) - Number(group.lastAt || 0)
                };
            });

            await database.ref(`users/${currentUser.uid}/quizStats`).set({
                total: stats.total,
                correct: stats.correct,
                wrong: stats.wrong,
                byLevel: stats.byLevel,
                wrongGroupTotal: Object.keys(wrongGroups).length
            });
            await database.ref(`users/${currentUser.uid}/wrongAnswerGroups`).set(wrongGroups);
            await loadWrongAnswerGroups(true);
        } catch (error) {
            console.error('Failed to import old attempts:', error);
        }
    }

    [quizModeSelect, quizSourceSelect, quizLevelSelect, quizSectionSelect].forEach(select => {
        if (!select) return;
        select.addEventListener('change', () => {
            if (select === quizSourceSelect && quizSectionSelect) {
                quizSectionSelect.disabled = quizSourceSelect.value === 'online';
            }
            savePreferences();
            loadNextQuestion();
        });
    });

    newQuestionBtn.addEventListener('click', () => {
        loadNextQuestion();
    });

    async function saveProgress() {
        if (!currentUser) return;

        try {
            await database.ref(`users/${currentUser.uid}/progress`).set(quizProgress);
        } catch (error) {
            console.error('Failed to save progress to Firebase:', error);
        }
    }

    async function saveAttempt(isCorrect, normalizedUserAnswer, allValidAnswerStrings) {
        if (!currentUser || !currentQuestion) return;

        const attempt = {
            createdAt: Date.now(),
            createdAtIso: new Date().toISOString(),
            correct: isCorrect,
            questionId: currentQuestion.id,
            vocabId: currentQuestion.vocabItem.id,
            source: currentQuestion.source,
            level: currentQuestion.vocabItem.level || '',
            sectionKey: currentQuestion.vocabItem.sectionKey || '',
            direction: currentQuestion.direction,
            questionText: currentQuestion.questionText,
            userAnswer: answerInput.value.trim(),
            normalizedUserAnswer,
            correctAnswers: Array.from(allValidAnswerStrings).join(' / '),
            streakAfterAnswer: quizProgress[currentQuestion.id]?.streak || 0,
            nextReview: quizProgress[currentQuestion.id]?.nextReview || 0
        };

        try {
            await database.ref(`users/${currentUser.uid}/attempts`).push(attempt);
            await saveQuizStats(attempt);
            if (attempt.correct !== true) {
                await loadWrongAnswerGroups(true);
            }
        } catch (error) {
            console.error('Failed to save answer attempt:', error);
        }
    }

    async function saveQuizStats(attempt) {
        const uid = currentUser.uid;
        const level = attempt.level || (attempt.source === 'online' ? 'Online' : 'Saved');
        let createdWrongGroup = false;

        if (attempt.correct !== true) {
            const wrongKey = getWrongGroupKey(attempt);
            const wrongGroupRef = database.ref(`users/${uid}/wrongAnswerGroups/${wrongKey}`);
            await wrongGroupRef.transaction(current => {
                createdWrongGroup = !current;
                const count = Number(current?.count || 0) + 1;
                const lastAt = Number(attempt.createdAt || Date.now());
                return {
                    questionText: attempt.questionText || 'Unknown question',
                    direction: attempt.direction || 'Unknown direction',
                    userAnswer: String(attempt.userAnswer || '').trim() || 'I do not know',
                    correctAnswers: attempt.correctAnswers || 'Unknown answer',
                    level,
                    count,
                    lastAt,
                    sortRank: (-count * 10000000000000) - lastAt
                };
            });
        }

        await database.ref(`users/${uid}/quizStats`).transaction(current => {
            const stats = normalizeStoredStats(current);
            stats.total += 1;
            if (attempt.correct === true) {
                stats.correct += 1;
            } else {
                stats.wrong += 1;
                if (createdWrongGroup) stats.wrongGroupTotal += 1;
            }

            if (!stats.byLevel[level]) {
                stats.byLevel[level] = { attempts: 0, correct: 0, wrong: 0 };
            }
            stats.byLevel[level].attempts += 1;
            if (attempt.correct === true) {
                stats.byLevel[level].correct += 1;
            } else {
                stats.byLevel[level].wrong += 1;
            }

            return stats;
        });
    }

    function getSafeFirebaseKey(value) {
        return String(value || '').replace(/[.#$\[\]/]/g, '_');
    }

    function getWrongReviewKey(questionId) {
        return getSafeFirebaseKey(questionId);
    }

    function getWrongReviewRecord(questionId) {
        return wrongReviewData[getWrongReviewKey(questionId)] || null;
    }

    function isRecentlyAsked(questionId) {
        return recentQuestionIds.includes(questionId);
    }

    function rememberAnsweredQuestion(questionId) {
        if (!questionId) return;
        recentQuestionIds = recentQuestionIds.filter(id => id !== questionId);
        recentQuestionIds.push(questionId);
        if (recentQuestionIds.length > recentQuestionLimit) {
            recentQuestionIds = recentQuestionIds.slice(-recentQuestionLimit);
        }
    }

    function directionMatchesMode(direction) {
        const mode = quizModeSelect.value;
        return mode === 'mixed'
            || (mode === 'de-to-en' && direction === 'German to English')
            || (mode === 'en-to-de' && direction === 'English to German');
    }

    function getPracticeQuestions(selectedVocab, avoidRecent = true) {
        const questions = [];
        const mode = quizModeSelect.value;

        selectedVocab.forEach(item => {
            if (mode === 'mixed' || mode === 'de-to-en') {
                const id = `${item.id}_de_to_en`;
                if (!avoidRecent || !isRecentlyAsked(id)) {
                    questions.push({ id, vocabItem: item, direction: 'German to English' });
                }
            }

            if (mode === 'mixed' || mode === 'en-to-de') {
                const id = `${item.id}_en_to_de`;
                if (!avoidRecent || !isRecentlyAsked(id)) {
                    questions.push({ id, vocabItem: item, direction: 'English to German' });
                }
            }
        });

        return questions;
    }

    function chooseRandomQuestion(questions) {
        return questions[Math.floor(Math.random() * questions.length)];
    }

    function getWrongReviewQuestions(selectedVocab) {
        const selectedItemsByQuestionId = {};

        selectedVocab.forEach(item => {
            selectedItemsByQuestionId[`${item.id}_de_to_en`] = {
                vocabItem: item,
                direction: 'German to English'
            };
            selectedItemsByQuestionId[`${item.id}_en_to_de`] = {
                vocabItem: item,
                direction: 'English to German'
            };
        });

        return Object.values(wrongReviewData)
            .filter(record => record && Number(record.correctStreak || 0) < wrongReviewTargetStreak)
            .map(record => {
                const question = selectedItemsByQuestionId[record.questionId];
                if (!question || !directionMatchesMode(question.direction)) return null;
                return {
                    id: record.questionId,
                    vocabItem: question.vocabItem,
                    direction: question.direction,
                    correctStreak: Number(record.correctStreak || 0),
                    lastWrongAt: Number(record.lastWrongAt || 0),
                    updatedAt: Number(record.updatedAt || 0)
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.correctStreak - b.correctStreak || b.lastWrongAt - a.lastWrongAt || b.updatedAt - a.updatedAt);
    }

    async function saveWrongReviewState(isCorrect) {
        if (!currentUser || !currentQuestion || currentQuestion.source === 'online') return;

        const key = getWrongReviewKey(currentQuestion.id);
        const existing = getWrongReviewRecord(currentQuestion.id);
        const wrongReviewItemRef = database.ref(`users/${currentUser.uid}/wrongReview/${key}`);
        const now = Date.now();

        if (isCorrect) {
            if (!existing) return;

            const nextStreak = Number(existing.correctStreak || 0) + 1;
            if (nextStreak >= wrongReviewTargetStreak) {
                delete wrongReviewData[key];
                await wrongReviewItemRef.remove();
                return;
            }

            wrongReviewData[key] = {
                ...existing,
                correctStreak: nextStreak,
                updatedAt: now
            };
            await wrongReviewItemRef.update({
                correctStreak: nextStreak,
                updatedAt: now
            });
            return;
        }

        const record = {
            questionId: currentQuestion.id,
            vocabId: currentQuestion.vocabItem.id,
            sectionKey: currentQuestion.vocabItem.sectionKey || 'section-1',
            direction: currentQuestion.direction,
            questionText: currentQuestion.questionText,
            correctStreak: 0,
            lastWrongAt: now,
            updatedAt: now
        };

        wrongReviewData[key] = record;
        await wrongReviewItemRef.set(record);
    }

    function getDueQuestions(selectedVocab = vocabData) {
        const now = Date.now();
        const dueQuestions = [];
        const mode = quizModeSelect.value;

        selectedVocab.forEach(item => {
            const idDeToEn = `${item.id}_de_to_en`;
            const idEnToDe = `${item.id}_en_to_de`;

            const progDeToEn = quizProgress[idDeToEn] || { streak: 0, nextReview: 0 };
            const progEnToDe = quizProgress[idEnToDe] || { streak: 0, nextReview: 0 };

            if ((mode === 'mixed' || mode === 'de-to-en') && progDeToEn.nextReview <= now) {
                dueQuestions.push({
                    id: idDeToEn,
                    vocabItem: item,
                    direction: 'German to English',
                    streak: progDeToEn.streak
                });
            }

            if ((mode === 'mixed' || mode === 'en-to-de') && progEnToDe.nextReview <= now) {
                dueQuestions.push({
                    id: idEnToDe,
                    vocabItem: item,
                    direction: 'English to German',
                    streak: progEnToDe.streak
                });
            }
        });

        return dueQuestions;
    }

    function chooseDirection() {
        const mode = quizModeSelect.value;
        if (mode === 'de-to-en') return 'German to English';
        if (mode === 'en-to-de') return 'English to German';
        return Math.random() > 0.5 ? 'German to English' : 'English to German';
    }

    function getGermanArticleFromTranslateData(data) {
        if (!data || !data[1]) return '';

        for (const posGroup of data[1]) {
            const groupings = posGroup[2] || [];
            for (const group of groupings) {
                const article = group[4];
                if (article === 'der' || article === 'die' || article === 'das') {
                    return `${article} `;
                }
            }
        }

        return '';
    }

    function hasGermanArticle(word) {
        const lower = word.trim().toLowerCase();
        return lower.startsWith('der ') || lower.startsWith('die ') || lower.startsWith('das ');
    }

    function removeGermanArticle(word) {
        return word.trim().replace(/^(der|die|das)\s+/i, '');
    }

    function normalizeText(value) {
        return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function normalizeGermanAnswer(value) {
        return normalizeText(removeGermanArticle(value || ''));
    }

    function getGermanAnswers(item) {
        const answers = [item.german, ...(Array.isArray(item.synonyms) ? item.synonyms : [])];
        return answers.filter(answer => answer && answer.trim());
    }

    function normalizeAnswer(answer, isGermanAnswer) {
        const normalized = answer.trim().toLowerCase();
        return isGermanAnswer ? normalizeGermanAnswer(normalized) : normalizeText(normalized);
    }

    function splitAnswerAlternatives(answer) {
        return answer
            .split(/[,/]/)
            .map(token => token.trim())
            .filter(Boolean);
    }

    async function translateEnglishToGerman(english) {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=de&dt=t&dt=bd&q=${encodeURIComponent(english)}`;
        const response = await fetch(url);
        const data = await response.json();
        let german = data && data[0] ? data[0].map(part => part[0]).join('') : '';
        const article = getGermanArticleFromTranslateData(data);

        if (article && !hasGermanArticle(german)) {
            german = article + german;
        }

        return german;
    }

    async function getOnlineVocabItem() {
        const level = quizLevelSelect.value;
        const words = ONLINE_WORD_BANK[level] || ONLINE_WORD_BANK.A1;
        const english = words[Math.floor(Math.random() * words.length)];
        const german = await translateEnglishToGerman(english);

        return {
            id: `online_${level}_${english.replace(/\s+/g, '_')}`,
            german,
            english,
            synonyms: [],
            level,
            source: 'online'
        };
    }

    function setQuestionFromItem(vocabItem, direction, labelSuffix = '') {
        if (direction === 'German to English') {
            currentQuestion = {
                id: `${vocabItem.id}_de_to_en`,
                vocabItem,
                questionText: vocabItem.german,
                correctAnswers: vocabItem.english,
                direction,
                synonyms: vocabItem.synonyms || [],
                source: vocabItem.source || 'saved'
            };
            questionLabel.textContent = `Translate to English${labelSuffix}:`;
        } else {
            currentQuestion = {
                id: `${vocabItem.id}_en_to_de`,
                vocabItem,
                questionText: vocabItem.english,
                correctAnswers: vocabItem.german,
                direction,
                synonyms: vocabItem.synonyms || [],
                source: vocabItem.source || 'saved'
            };
            questionLabel.textContent = `Translate to German${labelSuffix}:`;
        }

        questionWord.textContent = currentQuestion.questionText;
    }

    function resetQuestionUi() {
        answerInput.value = '';
        answerInput.disabled = false;
        if (actionButtons) actionButtons.style.display = 'flex';
        checkBtn.style.display = 'flex';
        checkBtn.disabled = false;
        checkBtn.classList.remove('success');
        nextContainer.style.display = 'none';
        addOnlineBtn.style.display = 'none';
        addOnlineBtn.disabled = false;
        addOnlineBtn.textContent = 'Add Online Word to DB';
        statusMessage.textContent = '';
        statusMessage.className = '';
        noDataMsg.style.display = 'none';
        noDataMsg.className = '';
    }

    async function loadNextQuestion() {
        resetQuestionUi();
        hidePageLoader();

        if (!currentUser) {
            quizForm.style.display = 'none';
            noDataMsg.style.display = 'block';
            noDataMsg.textContent = 'Sign in to start the quiz.';
            return;
        }

        if (quizSourceSelect.value === 'online') {
            quizForm.style.display = 'block';
            questionLabel.textContent = `Loading ${quizLevelSelect.value} online word...`;
            questionWord.textContent = '';
            answerInput.disabled = true;
            checkBtn.disabled = true;

            try {
                const onlineItem = await getOnlineVocabItem();
                setQuestionFromItem(onlineItem, chooseDirection(), ` (${quizLevelSelect.value} Online)`);
                answerInput.disabled = false;
                checkBtn.disabled = false;
                answerInput.focus();
            } catch (error) {
                console.error('Failed to load online question:', error);
                quizForm.style.display = 'none';
                noDataMsg.style.display = 'block';
                noDataMsg.textContent = 'Could not load an online question. Check your internet connection and try again.';
            }
            return;
        }

        if (vocabData.length === 0) {
            quizForm.style.display = 'none';
            noDataMsg.style.display = 'block';
            noDataMsg.textContent = 'No saved vocabulary yet. Change Source to Online Words or add words from Home first.';
            return;
        }

        const selectedVocab = getSelectedVocabData();
        if (selectedVocab.length === 0) {
            quizForm.style.display = 'none';
            noDataMsg.style.display = 'block';
            noDataMsg.textContent = 'No vocabulary found in the selected section.';
            return;
        }

        quizForm.style.display = 'block';
        const wrongReviewQuestions = getWrongReviewQuestions(selectedVocab)
            .filter(question => !isRecentlyAsked(question.id));
        const dueQuestions = getDueQuestions(selectedVocab)
            .filter(question => !isRecentlyAsked(question.id));
        const shouldAskRetry = wrongReviewQuestions.length > 0
            && (dueQuestions.length === 0 || Math.random() < retryQuestionChance);

        if (shouldAskRetry) {
            const poolSize = Math.max(1, Math.min(5, wrongReviewQuestions.length));
            const selected = chooseRandomQuestion(wrongReviewQuestions.slice(0, poolSize));
            setQuestionFromItem(selected.vocabItem, selected.direction, ` (Retry ${selected.correctStreak}/${wrongReviewTargetStreak})`);
        } else if (dueQuestions.length > 0) {
            dueQuestions.sort((a, b) => a.streak - b.streak);
            const poolSize = Math.max(1, Math.floor(dueQuestions.length / 2));
            const selected = chooseRandomQuestion(dueQuestions.slice(0, poolSize));
            setQuestionFromItem(selected.vocabItem, selected.direction);
        } else {
            const practiceQuestions = getPracticeQuestions(selectedVocab, true);
            const practicePool = practiceQuestions.length > 0
                ? practiceQuestions
                : getPracticeQuestions(selectedVocab, false);
            const selected = chooseRandomQuestion(practicePool);
            setQuestionFromItem(selected.vocabItem, selected.direction, ' (Practice)');
        }

        answerInput.focus();
    }

    function collectValidAnswers(isDeToEn) {
        const matchingItems = currentQuestion.source === 'online'
            ? [currentQuestion.vocabItem]
            : vocabData.filter(item => {
                const itemQuestionText = isDeToEn ? item.german : item.english;
                return itemQuestionText.trim().toLowerCase() === currentQuestion.questionText.toLowerCase();
            });

        const allValidAnswerStrings = new Set();
        const validAnswerTokens = new Set();
        const questionSynonyms = [];
        const addAnswer = (answer) => {
            if (!answer) return;
            allValidAnswerStrings.add(answer.trim());
            splitAnswerAlternatives(answer).forEach(cleanToken => {
                validAnswerTokens.add(normalizeAnswer(cleanToken, !isDeToEn));
            });
        };

        matchingItems.forEach(item => {
            addAnswer(isDeToEn ? item.english : item.german);

            if (!isDeToEn && item.synonyms && Array.isArray(item.synonyms)) {
                item.synonyms.forEach(addAnswer);
            }

            if (item.synonyms && Array.isArray(item.synonyms)) {
                item.synonyms.forEach(syn => {
                    const trimmed = syn.trim();
                    if (trimmed && !questionSynonyms.includes(trimmed)) {
                        questionSynonyms.push(trimmed);
                    }
                });
            }
        });

        addAnswer(currentQuestion.correctAnswers);

        if (!isDeToEn && currentQuestion.synonyms && Array.isArray(currentQuestion.synonyms)) {
            currentQuestion.synonyms.forEach(addAnswer);
        }

        return { allValidAnswerStrings, validAnswerTokens, questionSynonyms };
    }

    function handleAnswerSubmission(userRawAnswer, isIdk = false) {
        const isDeToEn = currentQuestion.direction === 'German to English';
        
        let userAnswer = '';
        if (!isIdk) {
            userAnswer = normalizeAnswer(userRawAnswer, !isDeToEn);
            if (!userAnswer) return;
        }

        const { allValidAnswerStrings, validAnswerTokens, questionSynonyms } = collectValidAnswers(isDeToEn);

        if (!quizProgress[currentQuestion.id]) {
            quizProgress[currentQuestion.id] = { streak: 0, nextReview: 0 };
        }

        const prog = quizProgress[currentQuestion.id];
        const now = Date.now();

        const isCorrect = !isIdk && validAnswerTokens.has(userAnswer);
        rememberAnsweredQuestion(currentQuestion.id);

        if (isCorrect) {
            checkBtn.classList.add('success');

            const otherValidStrings = Array.from(allValidAnswerStrings).filter(str => {
                const tokens = splitAnswerAlternatives(str).map(s => normalizeAnswer(s, !isDeToEn));
                return !tokens.includes(userAnswer);
            });

            let msg = 'Correct! Great job!';
            if (otherValidStrings.length > 0) {
                msg += `<br><span style="font-size: 0.9em; color: var(--text-secondary); display: block; margin-top: 0.5rem;">Also correct: <strong>${otherValidStrings.join(' / ')}</strong></span>`;
            }

            const synonymsToShow = questionSynonyms.filter(syn => !otherValidStrings.includes(syn) && normalizeAnswer(syn, !isDeToEn) !== userAnswer);
            if (synonymsToShow.length > 0) {
                msg += `<br><span style="font-size: 0.9em; color: var(--text-secondary); display: block; margin-top: 0.5rem;">Synonyms: <strong>${synonymsToShow.join(' / ')}</strong></span>`;
            }

            statusMessage.innerHTML = msg;
            statusMessage.className = 'status-success';

            prog.streak += 1;

            let interval = 0;
            switch (prog.streak) {
                case 1: interval = 10 * 60 * 1000; break;
                case 2: interval = 12 * 60 * 60 * 1000; break;
                case 3: interval = 3 * 24 * 60 * 60 * 1000; break;
                default: interval = 7 * 24 * 60 * 60 * 1000; break;
            }

            prog.nextReview = now + interval;
        } else {
            const allCorrectAnswersJoined = Array.from(allValidAnswerStrings).join(' / ');
            let msg = isIdk ? `The correct answer is:<br><strong>${allCorrectAnswersJoined}</strong>` : `Incorrect. Valid answers are:<br><strong>${allCorrectAnswersJoined}</strong>`;

            const synonymsToShow = questionSynonyms.filter(syn => !allValidAnswerStrings.has(syn));
            if (synonymsToShow.length > 0) {
                msg += `<br><span style="font-size: 0.9em; color: var(--text-secondary); display: block; margin-top: 0.5rem;">Synonyms: <strong>${synonymsToShow.join(' / ')}</strong></span>`;
            }

            statusMessage.innerHTML = msg;
            statusMessage.className = 'status-error';

            prog.streak = 0;
            prog.nextReview = now + (60 * 1000);
        }

        if (currentQuestion.source !== 'online') {
            saveProgress();
            saveWrongReviewState(isCorrect).catch(error => {
                console.error('Failed to save wrong-answer retry progress:', error);
            });
        }

        saveAttempt(isCorrect, userAnswer, allValidAnswerStrings);

        answerInput.disabled = true;
        if (actionButtons) actionButtons.style.display = 'none';
        else checkBtn.style.display = 'none';
        
        nextContainer.style.display = 'block';
        addOnlineBtn.style.display = quizSourceSelect.value === 'online' ? 'block' : 'none';
        nextBtn.focus();
    }

    quizForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleAnswerSubmission(answerInput.value, false);
    });

    if (idkBtn) {
        idkBtn.addEventListener('click', () => {
            handleAnswerSubmission('', true);
        });
    }

    addOnlineBtn.addEventListener('click', async () => {
        if (!currentQuestion || currentQuestion.source !== 'online') return;

        addOnlineBtn.disabled = true;
        addOnlineBtn.textContent = 'Adding...';

        try {
            const existingItem = vocabData.find(item => {
                const sameEnglish = normalizeText(item.english) === normalizeText(currentQuestion.vocabItem.english);
                const sameGermanAnswer = getGermanAnswers(item).some(answer => {
                    return normalizeGermanAnswer(answer) === normalizeGermanAnswer(currentQuestion.vocabItem.german);
                });
                return sameEnglish && sameGermanAnswer;
            });

            if (existingItem) {
                addOnlineBtn.textContent = 'Already in DB';
                return;
            }

            await database.ref('vocab').push({
                id: Date.now(),
                german: currentQuestion.vocabItem.german,
                english: currentQuestion.vocabItem.english,
                synonyms: [],
                level: currentQuestion.vocabItem.level,
                source: 'online',
                timestamp: new Date().toISOString()
            });
            addOnlineBtn.textContent = 'Added to DB';
        } catch (error) {
            console.error('Failed to add online word:', error);
            addOnlineBtn.disabled = false;
            addOnlineBtn.textContent = 'Add failed - try again';
        }
    });

    nextBtn.addEventListener('click', () => {
        loadNextQuestion();
    });
});
