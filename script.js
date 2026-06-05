
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('vocab-form');
    const germanInput = document.getElementById('german');
    const englishInput = document.getElementById('english');
    const saveBtn = document.getElementById('save-btn');
    const statusMessage = document.getElementById('status-message');
    const vocabList = document.getElementById('vocab-list');
    const exportBtn = document.getElementById('export-btn');

    let currentVocabData = [];
    let lastEditedLanguage = 'de';

    // Load initial data from Firebase
    const vocabRef = database.ref('vocab');
    vocabRef.on('value', (snapshot) => {
        const data = snapshot.val();
        currentVocabData = [];
        if (data) {
            // Convert object to array and keep Firebase keys
            for (const key in data) {
                currentVocabData.push({
                    firebaseKey: key,
                    ...data[key]
                });
            }
        }
        renderVocab(currentVocabData);
    });

    // Explicit translation functionality with synonyms
    const translateBtn = document.getElementById('translate-btn');
    const clearBtn = document.getElementById('clear-btn');
    const dictionaryContainer = document.getElementById('dictionary-container');
    const dictionaryContent = document.getElementById('dictionary-content');

    germanInput.addEventListener('input', () => {
        lastEditedLanguage = 'de';
    });

    englishInput.addEventListener('input', () => {
        lastEditedLanguage = 'en';
    });

    async function getGermanArticle(word) {
        if (!word) return '';
        try {
            const cleanWord = word.trim().replace(/^(der|die|das)\s+/i, '').split(' ')[0];
            const capitalizedWord = cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1);
            const response = await fetch(`https://de.wiktionary.org/w/api.php?action=query&prop=categories&cllimit=max&titles=${encodeURIComponent(capitalizedWord)}&format=json&origin=*`);
            const data = await response.json();
            
            if (data && data.query && data.query.pages) {
                const pages = data.query.pages;
                const pageId = Object.keys(pages)[0];
                if (pageId !== "-1" && pages[pageId].categories) {
                    const categories = pages[pageId].categories;
                    for (const cat of categories) {
                        if (cat.title === 'Kategorie:Substantiv m (Deutsch)') return 'der ';
                        if (cat.title === 'Kategorie:Substantiv f (Deutsch)') return 'die ';
                        if (cat.title === 'Kategorie:Substantiv n (Deutsch)') return 'das ';
                    }
                }
            }
        } catch (e) {}
        return '';
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

    function getGermanArticlePrefix(word) {
        const match = word.trim().match(/^(der|die|das)\s+/i);
        return match ? `${match[1].toLowerCase()} ` : '';
    }

    function formatGermanWordWithArticle(word, article) {
        if (!article || hasGermanArticle(word)) return word;
        return `${article.trim().toLowerCase()} ${word}`;
    }

    const fetchGoogleTranslate = async (text, sl, tl, targetInput) => {
        try {
            translateBtn.disabled = true;
            const originalText = translateBtn.innerHTML;
            translateBtn.innerHTML = 'Translating...';
            
            const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&dt=bd&q=${encodeURIComponent(text)}`);
            const data = await response.json();
            
            if (data && data[0]) {
                let translatedText = data[0].map(x => x[0]).join('');
                targetInput.value = translatedText;
                
                if (tl === 'de' && !hasGermanArticle(translatedText)) {
                    const article = getGermanArticleFromTranslateData(data) || await getGermanArticle(translatedText);
                    translatedText = article + translatedText;
                    targetInput.value = translatedText;
                }
            }
            
            if (sl === 'de' && !hasGermanArticle(text)) {
                const sourceInput = document.getElementById('german');
                const article = await getGermanArticle(text);
                if (article) {
                    sourceInput.value = article + text;
                }
            }
            
            if (data && data[1]) {
                renderDictionary(data[1], sl);
            }
            
            translateBtn.innerHTML = originalText;
        } catch (error) {
            console.error('Translation error:', error);
            translateBtn.innerHTML = 'Error';
            setTimeout(() => { translateBtn.innerHTML = 'Translate'; }, 2000);
        } finally {
            translateBtn.disabled = false;
        }
    };

    async function addSynonym(word) {
        if (!selectedSynonymsToSave.includes(word)) {
            let processedWord = word;
            if (!hasGermanArticle(word)) {
                const article = await getGermanArticle(word);
                processedWord = article + word;
            }
            if (!selectedSynonymsToSave.includes(processedWord)) {
                selectedSynonymsToSave.push(processedWord);
                renderSelectedSynonyms();
            }
        }
    }

    function renderDictionary(dictData, sl) {
        dictionaryContainer.style.display = 'block';
        dictionaryContent.innerHTML = '';
        
        dictData.forEach(posGroup => {
            const pos = posGroup[0]; 
            const groupings = posGroup[2] || []; 
            
            const posSection = document.createElement('div');
            posSection.style.marginBottom = '1.5rem';
            
            const posLabel = document.createElement('div');
            posLabel.style.fontWeight = 'bold';
            posLabel.style.color = 'var(--text-secondary)';
            posLabel.style.textTransform = 'capitalize';
            posLabel.style.marginBottom = '0.5rem';
            posLabel.style.fontSize = '0.9rem';
            posLabel.style.fontStyle = 'italic';
            posLabel.textContent = pos;
            posSection.appendChild(posLabel);
            
            const table = document.createElement('table');
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';
            table.style.fontSize = '0.9rem';
            
            groupings.forEach(group => {
                const targetWord = group[0];
                const sourceWords = group[1];
                const targetArticle = group[4];
                
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                
                const td1 = document.createElement('td');
                td1.style.padding = '0.75rem 0';
                td1.style.width = '30%';
                td1.style.verticalAlign = 'top';
                
                const td2 = document.createElement('td');
                td2.style.padding = '0.75rem 0';
                td2.style.color = 'var(--text-secondary)';
                
                let germanWords = [];
                let englishWords = [];
                
                if (sl === 'de') {
                    englishWords = [targetWord];
                    germanWords = sourceWords;
                    
                    td1.textContent = targetWord;
                    td1.style.fontWeight = '600';
                    td1.style.color = 'var(--text-primary)';
                    
                    germanWords.forEach(gw => {
                        const inputArticle = getGermanArticlePrefix(germanInput.value);
                        const inputGermanWord = removeGermanArticle(germanInput.value).toLowerCase();
                        const displayGermanWord = inputArticle && removeGermanArticle(gw).toLowerCase() === inputGermanWord
                            ? formatGermanWordWithArticle(gw, inputArticle)
                            : gw;
                        const span = document.createElement('span');
                        span.className = 'synonym-tag';
                        span.textContent = displayGermanWord;
                        span.style.display = 'inline-block';
                        span.style.margin = '0 4px 4px 0';
                        span.addEventListener('click', () => {
                            addSynonym(displayGermanWord);
                        });
                        td2.appendChild(span);
                    });
                } else {
                    germanWords = [targetWord];
                    englishWords = sourceWords;
                    const displayGermanWord = formatGermanWordWithArticle(targetWord, targetArticle);
                    
                    const span = document.createElement('span');
                    span.className = 'synonym-tag';
                    span.textContent = displayGermanWord;
                    span.style.display = 'inline-block';
                    span.style.margin = '0 4px 4px 0';
                    span.style.fontWeight = '600';
                    span.style.color = 'var(--text-primary)';
                    span.addEventListener('click', () => {
                        addSynonym(displayGermanWord);
                    });
                    td1.appendChild(span);
                    
                    td2.textContent = englishWords.join(', ');
                }
                
                tr.appendChild(td1);
                tr.appendChild(td2);
                table.appendChild(tr);
            });
            
            posSection.appendChild(table);
            dictionaryContent.appendChild(posSection);
        });
    }

    let selectedSynonymsToSave = [];
    const selectedSynonymsList = document.getElementById('selected-synonyms-list');

    function renderSelectedSynonyms() {
        selectedSynonymsList.innerHTML = '';
        selectedSynonymsToSave.forEach((syn, index) => {
            const tag = document.createElement('span');
            tag.className = 'synonym-tag';
            tag.style.background = 'rgba(34, 197, 94, 0.2)';
            tag.style.borderColor = 'rgba(34, 197, 94, 0.5)';
            tag.innerHTML = `${syn} <span style="margin-left: 5px; font-weight: bold;">&times;</span>`;
            tag.addEventListener('click', () => {
                selectedSynonymsToSave.splice(index, 1);
                renderSelectedSynonyms();
            });
            selectedSynonymsList.appendChild(tag);
        });
    }

    translateBtn.addEventListener('click', async () => {
        const german = germanInput.value.trim();
        const english = englishInput.value.trim();

        dictionaryContainer.style.display = 'none';
        dictionaryContent.innerHTML = '';
        selectedSynonymsToSave = [];
        renderSelectedSynonyms();

        if (german && !english) {
            await fetchGoogleTranslate(german, 'de', 'en', englishInput);
        } else if (english && !german) {
            await fetchGoogleTranslate(english, 'en', 'de', germanInput);
        } else if (german && english && lastEditedLanguage === 'en') {
            await fetchGoogleTranslate(english, 'en', 'de', germanInput);
        } else if (german) {
            await fetchGoogleTranslate(german, 'de', 'en', englishInput);
        }
    });

    clearBtn.addEventListener('click', () => {
        germanInput.value = '';
        englishInput.value = '';
        dictionaryContainer.style.display = 'none';
        dictionaryContent.innerHTML = '';
        selectedSynonymsToSave = [];
        renderSelectedSynonyms();
        statusMessage.textContent = '';
        lastEditedLanguage = 'de';
        germanInput.focus();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const german = germanInput.value.trim();
        const english = englishInput.value.trim();

        if (!german || !english) return;

        // Visual feedback - saving
        saveBtn.disabled = true;

        try {
            // Add new word to Firebase
            await database.ref('vocab').push({
                id: Date.now(),
                german: german,
                english: english,
                synonyms: selectedSynonymsToSave,
                timestamp: new Date().toISOString()
            });

            // Show success state
            showSuccess();
            
            // Clear inputs and refocus
            germanInput.value = '';
            englishInput.value = '';
            dictionaryContainer.style.display = 'none';
            selectedSynonymsToSave = [];
            renderSelectedSynonyms();
            germanInput.focus();

        } catch (error) {
            showError('Failed to save to Firebase.');
            console.error(error);
        } finally {
            saveBtn.disabled = false;
        }
    });
    
    // Export functionality for static hosting
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentVocabData));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href",     dataStr);
            downloadAnchorNode.setAttribute("download", "vocab.json");
            document.body.appendChild(downloadAnchorNode); // required for firefox
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        });
    }

    function showSuccess() {
        saveBtn.classList.add('success');
        statusMessage.textContent = 'Saved successfully!';
        statusMessage.className = 'status-success';
        
        setTimeout(() => {
            saveBtn.classList.remove('success');
            statusMessage.textContent = '';
        }, 2000);
    }

    function showError(msg) {
        statusMessage.textContent = msg;
        statusMessage.className = 'status-error';
        setTimeout(() => {
            statusMessage.textContent = '';
        }, 3000);
    }

    function renderVocab(vocabArray) {
        vocabList.innerHTML = '';
        
        // Show newest first
        const sortedVocab = [...vocabArray].sort((a, b) => b.id - a.id);
        
        sortedVocab.forEach(item => {
            const li = document.createElement('li');
            li.className = 'vocab-item';
            
            const deSpan = document.createElement('span');
            deSpan.className = 'vocab-german';
            deSpan.textContent = item.german;
            
            const enSpan = document.createElement('span');
            enSpan.className = 'vocab-english';
            enSpan.textContent = item.english;
            
            li.appendChild(deSpan);
            li.appendChild(enSpan);
            
            vocabList.appendChild(li);
        });
    }
});
