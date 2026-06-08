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

    let dataLoaded = false;
    let progressLoaded = false;
    let quizStarted = false;

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
            noDataMsg.textContent = 'Sign in to load your saved progress and answer history.';
        }
    });

    function startUserSession(user) {
        stopUserSession();

        currentUser = user;
        dataLoaded = false;
        progressLoaded = false;
        quizStarted = false;
        vocabData = [];
        quizProgress = {};

        vocabRef = database.ref('vocab');
        progressRef = database.ref(`users/${user.uid}/progress`);

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
            dataLoaded = true;
            checkAndStart();
        });

        progressRef.on('value', (snapshot) => {
            quizProgress = snapshot.val() || {};
            progressLoaded = true;
            checkAndStart();
        });
    }

    function stopUserSession() {
        if (vocabRef) vocabRef.off();
        if (progressRef) progressRef.off();
        vocabRef = null;
        progressRef = null;
        currentUser = null;
        dataLoaded = false;
        progressLoaded = false;
        quizStarted = false;
        vocabData = [];
        quizProgress = {};
        currentQuestion = null;
    }

    function loadPreferences() {
        try {
            quizModeSelect.value = localStorage.getItem('quizMode') || quizModeSelect.value;
            quizSourceSelect.value = localStorage.getItem('quizSource') || quizSourceSelect.value;
            quizLevelSelect.value = localStorage.getItem('quizLevel') || quizLevelSelect.value;
        } catch (e) {
            console.error('Failed to load quiz preferences');
        }
    }

    function savePreferences() {
        localStorage.setItem('quizMode', quizModeSelect.value);
        localStorage.setItem('quizSource', quizSourceSelect.value);
        localStorage.setItem('quizLevel', quizLevelSelect.value);
    }

    function checkAndStart() {
        if (!dataLoaded || !progressLoaded || quizStarted) return;

        quizStarted = true;
        loadNextQuestion();
    }

    [quizModeSelect, quizSourceSelect, quizLevelSelect].forEach(select => {
        select.addEventListener('change', () => {
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

        try {
            await database.ref(`users/${currentUser.uid}/attempts`).push({
                createdAt: Date.now(),
                createdAtIso: new Date().toISOString(),
                correct: isCorrect,
                questionId: currentQuestion.id,
                vocabId: currentQuestion.vocabItem.id,
                source: currentQuestion.source,
                direction: currentQuestion.direction,
                questionText: currentQuestion.questionText,
                userAnswer: answerInput.value.trim(),
                normalizedUserAnswer,
                correctAnswers: Array.from(allValidAnswerStrings).join(' / '),
                streakAfterAnswer: quizProgress[currentQuestion.id]?.streak || 0,
                nextReview: quizProgress[currentQuestion.id]?.nextReview || 0
            });
        } catch (error) {
            console.error('Failed to save answer attempt:', error);
        }
    }

    function getDueQuestions() {
        const now = Date.now();
        const dueQuestions = [];
        const mode = quizModeSelect.value;

        vocabData.forEach(item => {
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
    }

    async function loadNextQuestion() {
        resetQuestionUi();

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

        quizForm.style.display = 'block';
        const dueQuestions = getDueQuestions();

        if (dueQuestions.length > 0) {
            dueQuestions.sort((a, b) => a.streak - b.streak);
            const poolSize = Math.max(1, Math.floor(dueQuestions.length / 2));
            const selected = dueQuestions[Math.floor(Math.random() * poolSize)];
            setQuestionFromItem(selected.vocabItem, selected.direction);
        } else {
            const vocabItem = vocabData[Math.floor(Math.random() * vocabData.length)];
            setQuestionFromItem(vocabItem, chooseDirection(), ' (Practice)');
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
            answer.split(',').forEach(token => {
                const cleanToken = token.trim();
                if (!cleanToken) return;
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

        if (isCorrect) {
            checkBtn.classList.add('success');

            const otherValidStrings = Array.from(allValidAnswerStrings).filter(str => {
                const tokens = str.split(',').map(s => normalizeAnswer(s, !isDeToEn));
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
