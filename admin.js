document.addEventListener('DOMContentLoaded', () => {
    const adminContent = document.getElementById('admin-content');
    const learnerCount = document.getElementById('learner-count');
    const wordCount = document.getElementById('word-count');
    const attemptCount = document.getElementById('attempt-count');
    const usersList = document.getElementById('users-list');
    const attemptsList = document.getElementById('attempts-list');
    const refreshBtn = document.getElementById('refresh-admin-btn');
    const answerFilter = document.getElementById('answer-filter');

    let usersCache = {};
    let attemptsCache = [];
    let vocabCache = {};

    initializeAuthUi({
        required: true,
        adminOnly: true,
        onSignedIn: () => {
            adminContent.style.display = 'grid';
            loadAdminData();
        },
        onSignedOut: () => {
            adminContent.style.display = 'none';
        }
    });

    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadAdminData);
    }

    if (answerFilter) {
        answerFilter.addEventListener('change', renderAttempts);
    }

    async function loadAdminData() {
        const [usersSnapshot, vocabSnapshot] = await Promise.all([
            database.ref('users').once('value'),
            database.ref('vocab').once('value')
        ]);

        usersCache = usersSnapshot.val() || {};
        vocabCache = vocabSnapshot.val() || {};
        attemptsCache = collectAttempts(usersCache);

        learnerCount.textContent = Object.keys(usersCache).length;
        wordCount.textContent = Object.keys(vocabCache).length;
        attemptCount.textContent = attemptsCache.length;

        renderUsers();
        renderAttempts();
    }

    function collectAttempts(users) {
        const attempts = [];

        Object.entries(users).forEach(([uid, userData]) => {
            const profile = userData.profile || {};
            const userAttempts = userData.attempts || {};

            Object.entries(userAttempts).forEach(([attemptId, attempt]) => {
                attempts.push({
                    attemptId,
                    uid,
                    email: profile.email || 'Unknown user',
                    ...attempt
                });
            });
        });

        return attempts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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

            row.appendChild(title);
            row.appendChild(meta);
            row.appendChild(small);
            usersList.appendChild(row);
        });
    }

    function renderAttempts() {
        attemptsList.innerHTML = '';

        const filter = answerFilter.value;
        const attempts = attemptsCache.filter(attempt => {
            if (filter === 'correct') return attempt.correct;
            if (filter === 'wrong') return !attempt.correct;
            return true;
        }).slice(0, 75);

        if (attempts.length === 0) {
            attemptsList.appendChild(emptyState('No matching answers yet.'));
            return;
        }

        attempts.forEach(attempt => {
            const row = document.createElement('article');
            row.className = `admin-row ${attempt.correct ? 'answer-correct' : 'answer-wrong'}`;

            const title = document.createElement('strong');
            title.textContent = `${attempt.email} - ${attempt.correct ? 'Correct' : 'Wrong'}`;

            const question = document.createElement('span');
            question.textContent = `${attempt.direction}: ${attempt.questionText}`;

            const answer = document.createElement('span');
            answer.textContent = `Answered: ${attempt.userAnswer || '(blank)'} | Expected: ${attempt.correctAnswers || ''}`;

            const when = document.createElement('small');
            when.textContent = attempt.createdAt ? new Date(attempt.createdAt).toLocaleString() : '';

            row.appendChild(title);
            row.appendChild(question);
            row.appendChild(answer);
            row.appendChild(when);
            attemptsList.appendChild(row);
        });
    }

    function emptyState(message) {
        const element = document.createElement('p');
        element.className = 'empty-state';
        element.textContent = message;
        return element;
    }
});
