document.addEventListener('DOMContentLoaded', () => {
    const writingForm = document.getElementById('writing-form');
    const writingLevelSelect = document.getElementById('writing-level');
    const newPromptBtn = document.getElementById('new-writing-prompt-btn');
    const clearWritingBtn = document.getElementById('clear-writing-btn');
    const checkWritingBtn = document.getElementById('check-writing-btn');
    const writingAnswer = document.getElementById('writing-answer');
    const writingLoadStatus = document.getElementById('writing-load-status');
    const writingResult = document.getElementById('writing-result');
    const writingStatsCard = document.getElementById('writing-stats-card');
    const writingStatsContent = document.getElementById('writing-stats-content');
    const writingLevelBadge = document.getElementById('writing-level-badge');
    const writingTargetWord = document.getElementById('writing-target-word');
    const writingTranslation = document.getElementById('writing-translation');
    const writingPromptText = document.getElementById('writing-prompt-text');

    const LEVEL_RULES = {
        A1: {
            minWords: 4,
            minSentences: 1,
            prompt: 'Write one simple German sentence using this word.',
            checks: ['targetWord', 'capitalization', 'punctuation', 'article']
        },
        A2: {
            minWords: 7,
            minSentences: 1,
            prompt: 'Write a daily-life sentence using this word and a time, place, or person.',
            checks: ['targetWord', 'capitalization', 'punctuation', 'article', 'contextDetail']
        },
        B1: {
            minWords: 12,
            minSentences: 2,
            prompt: 'Write two German sentences using this word and give a reason.',
            checks: ['targetWord', 'capitalization', 'punctuation', 'article', 'reasonConnector']
        },
        B2: {
            minWords: 18,
            minSentences: 2,
            prompt: 'Write an opinion or comparison using this word.',
            checks: ['targetWord', 'capitalization', 'punctuation', 'article', 'opinionOrComparison', 'complexConnector']
        },
        C1: {
            minWords: 28,
            minSentences: 2,
            prompt: 'Write a formal or abstract argument using this word.',
            checks: ['targetWord', 'capitalization', 'punctuation', 'article', 'complexConnector', 'formalMarker']
        },
        C2: {
            minWords: 40,
            minSentences: 3,
            prompt: 'Write a nuanced German paragraph using this word precisely.',
            checks: ['targetWord', 'capitalization', 'punctuation', 'article', 'complexConnector', 'formalMarker', 'nuanceMarker']
        }
    };

    const CHECK_LABELS = {
        targetWord: 'Use the target vocabulary word',
        capitalization: 'Start with a capital letter',
        punctuation: 'End with sentence punctuation',
        article: 'Use the saved German article',
        contextDetail: 'Add a time, place, person, or daily-life detail',
        reasonConnector: 'Give a reason with a connector',
        opinionOrComparison: 'Include an opinion or comparison',
        complexConnector: 'Use a more complex connector',
        formalMarker: 'Use formal or abstract language',
        nuanceMarker: 'Add nuance, contrast, or limitation'
    };

    const CONNECTORS = {
        reason: ['weil', 'denn', 'deshalb', 'darum', 'daher', 'wegen'],
        opinion: ['ich denke', 'ich finde', 'meiner meinung', 'besser', 'schlechter', 'als', 'im vergleich', 'vorteil', 'nachteil'],
        complex: ['obwohl', 'während', 'trotzdem', 'einerseits', 'andererseits', 'sowohl', 'als auch', 'jedoch', 'hingegen'],
        formal: ['bezüglich', 'hinsichtlich', 'insbesondere', 'grundsätzlich', 'bedeutung', 'entwicklung', 'gesellschaft', 'situation'],
        nuance: ['allerdings', 'gleichwohl', 'keineswegs', 'insofern', 'differenziert', 'nuance', 'ambivalent', 'präzise', 'kontext']
    };

    const CONTEXT_WORDS = ['heute', 'morgen', 'gestern', 'schule', 'arbeit', 'haus', 'stadt', 'familie', 'freund', 'montag', 'abend', 'morgen'];

    let currentUser = null;
    let vocabRef = null;
    let attemptsRef = null;
    let vocabData = [];
    let writingAttempts = {};
    let vocabLoaded = false;
    let attemptsLoaded = false;
    let currentPrompt = null;

    loadPreference();

    initializeAuthUi({
        required: true,
        onSignedIn: (user) => {
            currentUser = user;
            startWritingSession(user);
        },
        onSignedOut: () => {
            stopWritingSession();
            setLoadStatus('Sign in to practice writing.', 'status-error');
            hidePageLoader();
        }
    });

    writingLevelSelect.addEventListener('change', () => {
        savePreference();
        choosePrompt();
        renderStats();
    });

    newPromptBtn.addEventListener('click', () => {
        choosePrompt();
    });

    clearWritingBtn.addEventListener('click', () => {
        writingAnswer.value = '';
        writingResult.style.display = 'none';
        writingAnswer.focus();
    });

    writingForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await handleWritingSubmit();
    });

    function loadPreference() {
        try {
            writingLevelSelect.value = localStorage.getItem('writingLevel') || writingLevelSelect.value;
        } catch (error) {
            console.error('Failed to load writing preference:', error);
        }
    }

    function savePreference() {
        localStorage.setItem('writingLevel', writingLevelSelect.value);
    }

    function startWritingSession(user) {
        stopWritingSession();

        currentUser = user;
        vocabLoaded = false;
        attemptsLoaded = false;
        vocabData = [];
        writingAttempts = {};
        currentPrompt = null;
        writingForm.style.display = 'none';
        if (writingStatsCard) writingStatsCard.style.display = 'none';
        setLoadStatus('Loading vocabulary and writing history...', '');

        vocabRef = database.ref('vocab');
        attemptsRef = database.ref(`users/${user.uid}/writingAttempts`);

        vocabRef.on('value', (snapshot) => {
            const data = snapshot.val();
            vocabData = [];
            if (data) {
                for (const key in data) {
                    vocabData.push({ firebaseKey: key, ...data[key] });
                }
            }
            vocabLoaded = true;
            checkReady();
        }, (error) => {
            showReadError(`Could not load vocabulary: ${error.message}`);
        });

        attemptsRef.on('value', (snapshot) => {
            writingAttempts = snapshot.val() || {};
            attemptsLoaded = true;
            renderStats();
            checkReady();
        }, (error) => {
            showReadError(`Could not load writing history: ${error.message}`);
        });
    }

    function stopWritingSession() {
        if (vocabRef) vocabRef.off();
        if (attemptsRef) attemptsRef.off();
        vocabRef = null;
        attemptsRef = null;
        currentUser = null;
        vocabLoaded = false;
        attemptsLoaded = false;
        vocabData = [];
        writingAttempts = {};
        currentPrompt = null;
        writingForm.style.display = 'none';
        if (writingStatsCard) writingStatsCard.style.display = 'none';
    }

    function checkReady() {
        if (!vocabLoaded || !attemptsLoaded) return;
        renderStats();
        choosePrompt();
        hidePageLoader();
    }

    function showReadError(message) {
        setLoadStatus(message, 'status-error');
        writingForm.style.display = 'none';
        if (writingStatsCard) writingStatsCard.style.display = 'none';
        hidePageLoader();
    }

    function setLoadStatus(message, className = '') {
        writingLoadStatus.textContent = message;
        writingLoadStatus.className = className ? `list-status ${className}` : 'list-status';
    }

    function choosePrompt() {
        writingResult.style.display = 'none';
        writingAnswer.value = '';

        if (!currentUser) {
            setLoadStatus('Sign in to practice writing.', 'status-error');
            writingForm.style.display = 'none';
            return;
        }

        if (vocabData.length === 0) {
            setLoadStatus('No saved vocabulary yet. Add words on Home first.', '');
            writingForm.style.display = 'none';
            return;
        }

        const level = writingLevelSelect.value;
        const preferred = vocabData.filter(item => item.level === level);
        const pool = preferred.length ? preferred : vocabData;
        const vocabItem = pool[Math.floor(Math.random() * pool.length)];
        currentPrompt = {
            level,
            vocabItem,
            prompt: LEVEL_RULES[level].prompt
        };

        writingLevelBadge.textContent = level;
        writingTargetWord.textContent = vocabItem.german || 'Unknown word';
        writingTranslation.textContent = vocabItem.english ? `English: ${vocabItem.english}` : '';
        writingPromptText.textContent = currentPrompt.prompt;
        writingForm.style.display = 'block';
        setLoadStatus(preferred.length ? '' : `No ${level} saved words found, so this prompt uses your saved vocabulary.`, '');
        writingAnswer.focus();
    }

    function normalizeText(value) {
        return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function removeGermanArticle(word) {
        return (word || '').trim().replace(/^(der|die|das)\s+/i, '');
    }

    function getGermanArticle(word) {
        const match = (word || '').trim().match(/^(der|die|das)\s+/i);
        return match ? match[1].toLowerCase() : '';
    }

    function countWords(text) {
        return (text.match(/[A-Za-zÄÖÜäöüß]+(?:[-'][A-Za-zÄÖÜäöüß]+)*/g) || []).length;
    }

    function countSentences(text) {
        return (text.match(/[.!?]+/g) || []).length;
    }

    function containsAny(text, values) {
        const normalized = normalizeText(text);
        return values.some(value => normalized.includes(value));
    }

    function getCheckResult(id, passed, detail, mistakeType) {
        return {
            id,
            label: CHECK_LABELS[id],
            passed,
            detail,
            mistakeType
        };
    }

    function evaluateWriting(text) {
        const level = currentPrompt.level;
        const rules = LEVEL_RULES[level];
        const targetGerman = currentPrompt.vocabItem.german || '';
        const cleanTarget = normalizeText(removeGermanArticle(targetGerman));
        const article = getGermanArticle(targetGerman);
        const normalized = normalizeText(text);
        const sentenceCount = countSentences(text);
        const wordCount = countWords(text);
        const checks = [];

        checks.push(getCheckResult(
            'targetWord',
            cleanTarget && normalized.includes(cleanTarget),
            `Use "${removeGermanArticle(targetGerman)}" in your writing.`,
            'target-word'
        ));
        checks.push(getCheckResult(
            'capitalization',
            /^[A-ZÄÖÜ]/.test(text.trim()),
            'Start the first sentence with a capital letter.',
            'capitalization'
        ));
        checks.push(getCheckResult(
            'punctuation',
            /[.!?]$/.test(text.trim()),
            'End your writing with ., !, or ?',
            'punctuation'
        ));

        if (rules.checks.includes('article')) {
            checks.push(getCheckResult(
                'article',
                !article || normalized.includes(`${article} ${cleanTarget}`) || normalized.includes(`den ${cleanTarget}`) || normalized.includes(`dem ${cleanTarget}`),
                article ? `Try to use the saved article "${article}" with the noun.` : 'No saved article needed for this word.',
                'article'
            ));
        }

        if (rules.checks.includes('contextDetail')) {
            checks.push(getCheckResult(
                'contextDetail',
                containsAny(text, CONTEXT_WORDS),
                'Add a time, place, person, or daily-life detail.',
                'context-detail'
            ));
        }

        if (rules.checks.includes('reasonConnector')) {
            checks.push(getCheckResult(
                'reasonConnector',
                containsAny(text, CONNECTORS.reason),
                'Use a reason connector such as weil, denn, deshalb, or daher.',
                'connector'
            ));
        }

        if (rules.checks.includes('opinionOrComparison')) {
            checks.push(getCheckResult(
                'opinionOrComparison',
                containsAny(text, CONNECTORS.opinion),
                'Add an opinion or comparison.',
                'opinion-comparison'
            ));
        }

        if (rules.checks.includes('complexConnector')) {
            checks.push(getCheckResult(
                'complexConnector',
                containsAny(text, CONNECTORS.complex),
                'Use a connector such as obwohl, während, trotzdem, jedoch, or einerseits/andererseits.',
                'complex-connector'
            ));
        }

        if (rules.checks.includes('formalMarker')) {
            checks.push(getCheckResult(
                'formalMarker',
                containsAny(text, CONNECTORS.formal),
                'Use more formal or abstract language.',
                'formal-register'
            ));
        }

        if (rules.checks.includes('nuanceMarker')) {
            checks.push(getCheckResult(
                'nuanceMarker',
                containsAny(text, CONNECTORS.nuance),
                'Add nuance, contrast, limitation, or precision.',
                'nuance'
            ));
        }

        checks.push(getCheckResult(
            'length',
            wordCount >= rules.minWords && sentenceCount >= rules.minSentences,
            `Target: at least ${rules.minWords} words and ${rules.minSentences} ${rules.minSentences === 1 ? 'sentence' : 'sentences'}.`,
            'length'
        ));

        const passed = checks.filter(check => check.passed).length;
        const score = Math.round((passed / checks.length) * 100);
        const mistakeTypes = {};
        checks.filter(check => !check.passed).forEach(check => {
            mistakeTypes[check.mistakeType] = (mistakeTypes[check.mistakeType] || 0) + 1;
        });

        return {
            score,
            checksPassed: passed,
            checksTotal: checks.length,
            wordCount,
            sentenceCount,
            checks,
            mistakeTypes
        };
    }

    async function handleWritingSubmit() {
        const text = writingAnswer.value.trim();
        if (!currentUser || !currentPrompt || !text) return;

        checkWritingBtn.disabled = true;
        try {
            const evaluation = evaluateWriting(text);
            await database.ref(`users/${currentUser.uid}/writingAttempts`).push({
                createdAt: Date.now(),
                createdAtIso: new Date().toISOString(),
                level: currentPrompt.level,
                vocabId: currentPrompt.vocabItem.id || '',
                vocabKey: currentPrompt.vocabItem.firebaseKey || '',
                german: currentPrompt.vocabItem.german || '',
                english: currentPrompt.vocabItem.english || '',
                prompt: currentPrompt.prompt,
                userText: text,
                score: evaluation.score,
                checksPassed: evaluation.checksPassed,
                checksTotal: evaluation.checksTotal,
                wordCount: evaluation.wordCount,
                sentenceCount: evaluation.sentenceCount,
                mistakeTypes: evaluation.mistakeTypes
            });
            renderEvaluation(evaluation);
        } catch (error) {
            console.error('Failed to save writing attempt:', error);
            writingResult.style.display = 'block';
            writingResult.className = 'writing-result status-error';
            writingResult.textContent = 'Failed to save writing attempt. Try again.';
        } finally {
            checkWritingBtn.disabled = false;
        }
    }

    function renderEvaluation(evaluation) {
        writingResult.innerHTML = '';
        writingResult.className = evaluation.score >= 70 ? 'writing-result writing-result-good' : 'writing-result writing-result-needs-work';
        writingResult.style.display = 'block';

        const heading = document.createElement('h3');
        heading.textContent = `Score: ${evaluation.score}%`;

        const summary = document.createElement('p');
        summary.textContent = `${evaluation.checksPassed} of ${evaluation.checksTotal} checks passed | ${evaluation.wordCount} words | ${evaluation.sentenceCount} sentences`;

        const list = document.createElement('ul');
        list.className = 'writing-check-list';

        evaluation.checks.forEach(check => {
            const item = document.createElement('li');
            item.className = check.passed ? 'check-passed' : 'check-failed';

            const label = document.createElement('strong');
            label.textContent = check.label;

            const detail = document.createElement('span');
            detail.textContent = check.passed ? 'Passed' : check.detail;

            item.appendChild(label);
            item.appendChild(detail);
            list.appendChild(item);
        });

        writingResult.appendChild(heading);
        writingResult.appendChild(summary);
        writingResult.appendChild(list);
    }

    function getWritingStats() {
        const attempts = Object.values(writingAttempts || {}).filter(item => item && typeof item === 'object');
        const stats = {
            total: attempts.length,
            averageScore: 0,
            byLevel: {},
            mistakes: {}
        };

        attempts.forEach(attempt => {
            const level = attempt.level || 'Unknown';
            if (!stats.byLevel[level]) {
                stats.byLevel[level] = { attempts: 0, scoreTotal: 0, averageScore: 0 };
            }

            const score = Number(attempt.score || 0);
            stats.byLevel[level].attempts += 1;
            stats.byLevel[level].scoreTotal += score;

            Object.entries(attempt.mistakeTypes || {}).forEach(([type, count]) => {
                stats.mistakes[type] = (stats.mistakes[type] || 0) + Number(count || 0);
            });
        });

        const scoreTotal = attempts.reduce((total, attempt) => total + Number(attempt.score || 0), 0);
        stats.averageScore = attempts.length ? Math.round(scoreTotal / attempts.length) : 0;

        Object.values(stats.byLevel).forEach(levelStats => {
            levelStats.averageScore = levelStats.attempts ? Math.round(levelStats.scoreTotal / levelStats.attempts) : 0;
        });

        return stats;
    }

    function renderStats() {
        if (!writingStatsCard || !writingStatsContent) return;

        const stats = getWritingStats();
        writingStatsContent.innerHTML = '';

        const statGrid = document.createElement('div');
        statGrid.className = 'learner-stat-grid';
        appendStatPill(statGrid, 'Attempts', stats.total);
        appendStatPill(statGrid, 'Avg Score', `${stats.averageScore}%`, stats.averageScore >= 70 ? 'stat-success' : 'stat-error');
        appendStatPill(statGrid, 'Levels', Object.keys(stats.byLevel).length);

        const levels = document.createElement('div');
        levels.className = 'level-stats';

        Object.entries(stats.byLevel)
            .sort(([levelA], [levelB]) => levelA.localeCompare(levelB))
            .forEach(([level, levelStats]) => {
                const row = document.createElement('div');
                row.className = 'level-stat-row';

                const label = document.createElement('strong');
                label.textContent = level;

                const values = document.createElement('span');
                values.textContent = `${levelStats.attempts} attempts | ${levelStats.averageScore}% average`;

                row.appendChild(label);
                row.appendChild(values);
                levels.appendChild(row);
            });

        if (!levels.children.length) {
            const empty = document.createElement('span');
            empty.className = 'empty-inline';
            empty.textContent = 'No writing attempts yet.';
            levels.appendChild(empty);
        }

        const mistakes = document.createElement('details');
        mistakes.className = 'wrong-answer-details';
        const summary = document.createElement('summary');
        summary.textContent = 'Repeated writing issues';
        mistakes.appendChild(summary);

        const mistakeList = document.createElement('div');
        mistakeList.className = 'wrong-answer-list';
        const sortedMistakes = Object.entries(stats.mistakes).sort((a, b) => b[1] - a[1]);

        if (sortedMistakes.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'No repeated issues yet.';
            mistakes.appendChild(empty);
        } else {
            sortedMistakes.forEach(([type, count]) => {
                const item = document.createElement('article');
                item.className = 'wrong-answer-item';

                const header = document.createElement('div');
                header.className = 'wrong-answer-header';

                const name = document.createElement('strong');
                name.textContent = type;

                const total = document.createElement('span');
                total.className = 'wrong-count';
                total.textContent = `${count}x`;

                header.appendChild(name);
                header.appendChild(total);
                item.appendChild(header);
                mistakeList.appendChild(item);
            });
            mistakes.appendChild(mistakeList);
        }

        writingStatsContent.appendChild(statGrid);
        writingStatsContent.appendChild(levels);
        writingStatsContent.appendChild(mistakes);
        writingStatsCard.style.display = 'block';
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
});
