document.addEventListener('DOMContentLoaded', () => {
    const studySections = document.getElementById('study-sections');
    const studySummary = document.getElementById('study-summary');
    const studyStatus = document.getElementById('study-status');
    const sectionSelect = document.getElementById('section-select');
    const LAST_STUDY_SECTION_KEY = 'lastStudySection';

    let vocabData = [];
    let vocabRef = null;
    let dataLoaded = false;
    let readFailed = false;
    let currentUser = null;
    let preparedSections = [];

    initializeAuthUi({
        required: true,
        onSignedIn: (user) => {
            currentUser = user;
            loadVocabulary();
        },
        onSignedOut: () => {
            currentUser = null;
            vocabData = [];
            preparedSections = [];
            dataLoaded = false;
            renderSections();
        }
    });

    if (sectionSelect) {
        sectionSelect.addEventListener('change', () => {
            saveLastStudySection(sectionSelect.value);
            renderSections();
        });
    }

    function loadVocabulary() {
        if (vocabRef) vocabRef.off();

        setStudyStatus('Loading sections...', '');
        vocabRef = database.ref('vocab');
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
            populateSectionSelect();
            dataLoaded = true;
            readFailed = false;
            renderSections();
            hidePageLoader();
        }, (error) => {
            readFailed = true;
            vocabData = [];
            preparedSections = [];
            dataLoaded = false;
            populateSectionSelect();
            renderSections();
            setStudyStatus(`Could not load vocabulary: ${error.message}`, 'status-error');
            hidePageLoader();
        });
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

    function getVocabSortValue(item) {
        if (item.timestamp) {
            const timestampValue = Date.parse(item.timestamp);
            if (!Number.isNaN(timestampValue)) return timestampValue;
        }

        const numericId = Number(item.id);
        if (!Number.isNaN(numericId)) return numericId;
        return Number.MAX_SAFE_INTEGER;
    }

    function getSectionLabel(sectionIndex, totalItems) {
        const sectionSize = 50;
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

            const sectionSize = 50;
            item.sectionIndex = Math.floor(unsectionedIndex / sectionSize);
            item.sectionKey = `section-${item.sectionIndex + 1}`;
            item.sectionName = getSectionLabel(item.sectionIndex, unsectionedTotal);
            unsectionedIndex += 1;
        });

        const sectionsByKey = new Map();
        vocabData.forEach(item => {
            if (!item.sectionKey) return;

            if (!sectionsByKey.has(item.sectionKey)) {
                sectionsByKey.set(item.sectionKey, {
                    key: item.sectionKey,
                    label: item.sectionName || item.sectionKey,
                    items: []
                });
            }

            sectionsByKey.get(item.sectionKey).items.push(item);
        });

        preparedSections = Array.from(sectionsByKey.values()).sort((a, b) => a.label.localeCompare(b.label));
    }

    function getFilteredSections() {
        const selectedKey = sectionSelect ? sectionSelect.value : '';
        if (!selectedKey) return [];
        return preparedSections.filter(section => section.key === selectedKey);
    }

    function formatEntryLine(item) {
        const germanParts = uniqueGermanAnswers(getGermanAnswers(item));
        const germanLabel = germanParts.join(' / ');
        const englishLabel = String(item.english || '').trim();
        const synonymLabel = Array.isArray(item.synonyms)
            ? item.synonyms.map(value => String(value || '').trim()).filter(Boolean).join(' / ')
            : '';

        return {
            germanLabel,
            englishLabel,
            synonymLabel
        };
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

    function getLastStudySection() {
        try {
            return localStorage.getItem(LAST_STUDY_SECTION_KEY) || '';
        } catch (error) {
            return '';
        }
    }

    function saveLastStudySection(sectionKey) {
        try {
            if (sectionKey) {
                localStorage.setItem(LAST_STUDY_SECTION_KEY, sectionKey);
            }
        } catch (error) {
            // Ignore storage errors so section rendering still works.
        }
    }

    function populateSectionSelect() {
        if (!sectionSelect) return;

        const previousValue = sectionSelect.value || getLastStudySection();
        sectionSelect.innerHTML = '';

        if (preparedSections.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No sections available';
            sectionSelect.appendChild(option);
            sectionSelect.disabled = true;
            return;
        }

        sectionSelect.disabled = false;

        preparedSections.forEach((section, index) => {
            const option = document.createElement('option');
            option.value = section.key;
            option.textContent = `${section.label} (${section.items.length})`;
            sectionSelect.appendChild(option);
            if (index === 0) {
                option.selected = true;
            }
        });

        const hasPrevious = Array.from(sectionSelect.options).some(option => option.value === previousValue);
        if (hasPrevious) {
            sectionSelect.value = previousValue;
        } else if (!sectionSelect.value && preparedSections.length > 0) {
            sectionSelect.value = preparedSections[0].key;
        }

        saveLastStudySection(sectionSelect.value);
    }

    function setStudyStatus(message, className = '') {
        if (!studyStatus) return;
        studyStatus.textContent = message;
        studyStatus.className = className ? `admin-status ${className}` : 'admin-status';
    }

    function renderSections() {
        if (!studySections || !studySummary) return;

        studySections.innerHTML = '';

        if (!dataLoaded) {
            studySummary.textContent = 'Loading sections...';
            if (!readFailed) setStudyStatus('', '');
            return;
        }

        const sections = getFilteredSections();
        const totalWords = preparedSections.reduce((sum, section) => sum + section.items.length, 0);
        const selectedSection = preparedSections.find(section => section.key === (sectionSelect ? sectionSelect.value : ''));

        studySummary.textContent = selectedSection
            ? `${selectedSection.label} • ${selectedSection.items.length} words`
            : `${preparedSections.length} sections, ${totalWords} words`;

        if (preparedSections.length === 0) {
            setStudyStatus('No vocabulary saved yet.', '');
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'Add vocabulary on the Home page to see sections here.';
            studySections.appendChild(empty);
            return;
        }

        if (sections.length === 0) {
            setStudyStatus('Choose a section to view its words.', '');
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'Select a section from the dropdown above.';
            studySections.appendChild(empty);
            return;
        }

        setStudyStatus('', '');

        sections.forEach((section) => {
            const details = document.createElement('details');
            details.className = 'study-section';
            details.open = true;

            const summary = document.createElement('summary');
            summary.className = 'study-section-summary';

            const summaryLeft = document.createElement('div');
            summaryLeft.className = 'study-section-summary-left';

            const title = document.createElement('strong');
            title.textContent = section.label;

            const meta = document.createElement('span');
            meta.textContent = `${section.items.length} ${section.items.length === 1 ? 'word' : 'words'}`;

            summaryLeft.appendChild(title);
            summaryLeft.appendChild(meta);

            const summaryHint = document.createElement('span');
            summaryHint.className = 'panel-note';
            summaryHint.textContent = 'Read first, then quiz';

            summary.appendChild(summaryLeft);
            summary.appendChild(summaryHint);
            details.appendChild(summary);

            const body = document.createElement('div');
            body.className = 'study-section-body';

            const note = document.createElement('p');
            note.className = 'study-section-note';
            note.textContent = 'Use this list to learn the section, then switch to the quiz and write the words from memory.';
            body.appendChild(note);

            const list = document.createElement('div');
            list.className = 'study-word-list';

            section.items.forEach((item, itemIndex) => {
                const row = document.createElement('article');
                row.className = 'study-word-row';

                const index = document.createElement('span');
                index.className = 'study-word-index';
                index.textContent = String(itemIndex + 1).padStart(2, '0');

                const deBlock = document.createElement('div');
                deBlock.className = 'study-word-block';
                const deLabel = document.createElement('span');
                deLabel.className = 'study-word-label';
                deLabel.textContent = 'German';
                const deValue = document.createElement('strong');
                deValue.className = 'study-word-de';
                deValue.textContent = formatEntryLine(item).germanLabel;
                deBlock.appendChild(deLabel);
                deBlock.appendChild(deValue);

                const enBlock = document.createElement('div');
                enBlock.className = 'study-word-block';
                const enLabel = document.createElement('span');
                enLabel.className = 'study-word-label';
                enLabel.textContent = 'English';
                const enValue = document.createElement('strong');
                enValue.className = 'study-word-en';
                enValue.textContent = formatEntryLine(item).englishLabel;
                enBlock.appendChild(enLabel);
                enBlock.appendChild(enValue);

                row.appendChild(index);
                row.appendChild(deBlock);
                row.appendChild(enBlock);

                const synonymLabel = formatEntryLine(item).synonymLabel;
                if (synonymLabel) {
                    const synonyms = document.createElement('div');
                    synonyms.className = 'study-word-synonyms';
                    synonyms.textContent = `Synonyms: ${synonymLabel}`;
                    row.appendChild(synonyms);
                }

                list.appendChild(row);
            });

            body.appendChild(list);

            const footer = document.createElement('div');
            footer.className = 'study-section-footer';

            const practiceBtn = document.createElement('button');
            practiceBtn.type = 'button';
            practiceBtn.className = 'btn-primary';
            practiceBtn.textContent = 'Practice This Section';
            practiceBtn.style.marginTop = '0';
            practiceBtn.addEventListener('click', () => {
                localStorage.setItem('quizSection', section.key);
                localStorage.setItem('quizSource', 'saved');
                window.location.href = 'quiz.html';
            });

            footer.appendChild(practiceBtn);
            body.appendChild(footer);

            details.appendChild(body);
            studySections.appendChild(details);
        });
    }
});
