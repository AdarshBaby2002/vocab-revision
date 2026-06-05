document.addEventListener('DOMContentLoaded', () => {
    const adminContent = document.getElementById('admin-content');
    const learnerCount = document.getElementById('learner-count');
    const wordCount = document.getElementById('word-count');
    const usersList = document.getElementById('users-list');
    const refreshBtn = document.getElementById('refresh-admin-btn');

    let usersCache = {};
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
