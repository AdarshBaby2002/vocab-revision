function hidePageLoader() {
    const loader = document.getElementById('page-loader');
    if (!loader) return;

    loader.classList.add('is-hidden');
    setTimeout(() => {
        loader.style.display = 'none';
    }, 220);
}

function showPageLoader() {
    const loader = document.getElementById('page-loader');
    if (!loader) return;

    loader.style.display = 'flex';
    loader.classList.remove('is-hidden');
}

function initializeAuthUi(options = {}) {
    const {
        required = true,
        adminOnly = false,
        importerOnly = false,
        onSignedIn = () => {},
        onSignedOut = () => {},
        formAction = 'sign-in'
    } = options;

    const authCard = document.getElementById('auth-card');
    const authForm = document.getElementById('auth-form');
    const authEmail = document.getElementById('auth-email');
    const authPassword = document.getElementById('auth-password');
    const signInBtn = document.getElementById('sign-in-btn');
    const signUpBtn = document.getElementById('sign-up-btn');
    const passwordResetBtn = document.getElementById('password-reset-btn');
    const signOutBtn = document.getElementById('sign-out-btn');
    const authStatus = document.getElementById('auth-status');
    const userBadge = document.getElementById('user-badge');
    const adminLink = document.getElementById('admin-link');
    const importLink = document.getElementById('import-link');

    async function getAdminStatus(user) {
        if (!user) return false;
        if (Array.isArray(ADMIN_UIDS) && ADMIN_UIDS.includes(user.uid)) return true;

        try {
            const snapshot = await database.ref(`admins/${user.uid}`).once('value');
            return snapshot.val() === true;
        } catch (error) {
            return false;
        }
    }

    async function getImporterStatus(user, isAdmin) {
        if (!user) return false;
        if (isAdmin) return true;

        try {
            const snapshot = await database.ref(`importers/${user.uid}`).once('value');
            return snapshot.val() === true;
        } catch (error) {
            return false;
        }
    }

    function setAuthStatus(message, className = '') {
        if (!authStatus) return;
        authStatus.textContent = message;
        authStatus.className = className;
    }

    function setButtonText(button, text) {
        if (!button) return;
        const label = button.querySelector('.btn-text');
        if (label) {
            label.textContent = text;
            return;
        }
        button.textContent = text;
    }

    function getActionButton(action) {
        return action === 'sign-up' ? signUpBtn : signInBtn;
    }

    function getButtonLoadingText(action) {
        return action === 'sign-up' ? 'Creating account...' : 'Signing in...';
    }

    function setBusy(isBusy, activeAction = formAction) {
        [signInBtn, signUpBtn].forEach(btn => {
            if (btn) btn.disabled = isBusy;
        });

        const activeButton = getActionButton(activeAction);
        if (!activeButton) return;

        if (!activeButton.dataset.defaultText) {
            const label = activeButton.querySelector('.btn-text');
            activeButton.dataset.defaultText = label ? label.textContent : activeButton.textContent;
        }

        setButtonText(activeButton, isBusy ? getButtonLoadingText(activeAction) : activeButton.dataset.defaultText);
    }

    async function ensureUserProfile(user, isAdmin) {
        const profileRef = database.ref(`users/${user.uid}/profile`);
        const snapshot = await profileRef.once('value');
        const existing = snapshot.val() || {};

        await profileRef.update({
            email: user.email || existing.email || '',
            displayName: user.displayName || existing.displayName || '',
            role: isAdmin ? 'admin' : (existing.role || 'learner'),
            createdAt: existing.createdAt || new Date().toISOString(),
            lastLoginAt: new Date().toISOString()
        });
    }

    async function handleAuthAction(action) {
        const email = authEmail.value.trim();
        const password = authPassword.value;

        if (!email || !password) {
            setAuthStatus('Enter email and password.', 'status-error');
            return;
        }

        setBusy(true, action);
        setAuthStatus('');

        try {
            if (action === 'sign-up') {
                await auth.createUserWithEmailAndPassword(email, password);
            } else {
                await auth.signInWithEmailAndPassword(email, password);
            }
        } catch (error) {
            setAuthStatus(error.message || 'Authentication failed.', 'status-error');
        } finally {
            setBusy(false, action);
        }
    }

    async function handlePasswordReset() {
        const email = authEmail ? authEmail.value.trim() : '';

        if (!email) {
            setAuthStatus('Enter your email address first.', 'status-error');
            return;
        }

        if (passwordResetBtn) passwordResetBtn.disabled = true;
        setAuthStatus('Sending password reset email...');

        try {
            await auth.sendPasswordResetEmail(email);
            setAuthStatus(`Password reset email sent to ${email}.`, 'status-success');
        } catch (error) {
            setAuthStatus(error.message || 'Failed to send password reset email.', 'status-error');
        } finally {
            if (passwordResetBtn) passwordResetBtn.disabled = false;
        }
    }

    if (authForm && authForm.tagName === 'FORM') {
        authForm.addEventListener('submit', (event) => {
            event.preventDefault();
            handleAuthAction(formAction);
        });
    }

    if (signInBtn) {
        signInBtn.addEventListener('click', () => handleAuthAction('sign-in'));
    }

    if (signUpBtn) {
        signUpBtn.addEventListener('click', () => handleAuthAction('sign-up'));
    }

    if (passwordResetBtn) {
        passwordResetBtn.addEventListener('click', handlePasswordReset);
    }

    if (signOutBtn) {
        signOutBtn.addEventListener('click', () => auth.signOut());
    }

    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            if (required) {
                window.location.href = 'signin.html';
                return;
            }
            if (authCard) authCard.style.display = 'block';
            if (authForm) authForm.style.display = '';
            if (signOutBtn) signOutBtn.style.display = 'none';
            if (adminLink) adminLink.style.display = 'none';
            if (importLink) importLink.style.display = 'none';
            if (userBadge) userBadge.textContent = 'Not signed in';
            setAuthStatus(required ? 'Sign in to save your own progress.' : '');
            onSignedOut();
            hidePageLoader();
            return;
        }

        const isAdmin = await getAdminStatus(user);
        const canImport = await getImporterStatus(user, isAdmin);
        await ensureUserProfile(user, isAdmin);

        if (adminOnly && !isAdmin) {
            if (authCard) authCard.style.display = 'block';
            if (authForm) authForm.style.display = 'none';
            if (signOutBtn) signOutBtn.style.display = 'inline-flex';
            if (adminLink) adminLink.style.display = 'none';
            if (importLink) importLink.style.display = canImport ? 'inline-flex' : 'none';
            if (userBadge) userBadge.textContent = user.email;
            setAuthStatus('This account is signed in, but it is not an admin account.', 'status-error');
            onSignedOut(user);
            hidePageLoader();
            return;
        }

        if (importerOnly && !canImport) {
            if (authCard) authCard.style.display = 'block';
            if (authForm) authForm.style.display = 'none';
            if (signOutBtn) signOutBtn.style.display = 'inline-flex';
            if (adminLink) adminLink.style.display = isAdmin ? 'inline-flex' : 'none';
            if (importLink) importLink.style.display = 'none';
            if (userBadge) userBadge.textContent = user.email;
            setAuthStatus('This account is signed in, but it does not have import access.', 'status-error');
            onSignedOut(user);
            hidePageLoader();
            return;
        }

        if (authCard) authCard.style.display = 'block';
        if (authForm) authForm.style.display = 'none';
        if (signOutBtn) signOutBtn.style.display = 'inline-flex';
        if (adminLink) adminLink.style.display = isAdmin ? 'inline-flex' : 'none';
        if (importLink) importLink.style.display = canImport ? 'inline-flex' : 'none';
        if (userBadge) userBadge.textContent = user.email;
        setAuthStatus(adminOnly ? 'Admin access granted.' : 'Signed in. Your quiz progress is private to this account.', 'status-success');
        onSignedIn(user, { isAdmin, canImport });
    });
}
