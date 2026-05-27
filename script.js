const EXAM_CONFIG = {
    examCode: 'aws-mla-c01',
    mockQuestionCount: 65,
    mockDurationMinutes: 130,
    domainWeights: {
        'Data Preparation for Machine Learning (ML)': 28,
        'ML Model Development': 26,
        'Deployment and Orchestration of ML Workflows': 22,
        'ML Solution Monitoring, Maintenance, and Security': 24,
    },
};

const app = {
    allQuestions: [],
    questions: [],
    currentQuestion: 0,
    userAnswers: [],
    score: 0,
    testInProgress: false,
    isReview: false,
    currentFilter: 'all',
    testHistory: [],
    selectedMode: 'all',
    selectedDomain: '',
    examMode: null,
    submittedQuestions: [],
    timerId: null,
    timeRemaining: 0,
};

document.addEventListener('DOMContentLoaded', async () => {
    await loadQuestions();
    setupEventListeners();
    updateHomeScreen();
});

async function loadQuestions() {
    try {
        const uniqueQuestions = await fetchQuestionsFile('unique_questions.json');
        app.allQuestions = dedupeQuestions(uniqueQuestions.map(normalizeUniqueQuestion));
        app.selectedDomain = Object.keys(EXAM_CONFIG.domainWeights)[0];

        document.getElementById('totalQuestions').textContent = app.allQuestions.length;
        populateDomainSelect();
    } catch (error) {
        console.error('Error loading questions:', error);
        showErrorMessage('Failed to load unique_questions.json. Please ensure the file is in the same directory as index.html.');
    }
}

async function fetchQuestionsFile(filename) {
    const response = await fetch(filename);

    if (!response.ok) {
        throw new Error(`Failed to load ${filename}`);
    }

    return response.json();
}

function setupEventListeners() {
    document.getElementById('startBtn').addEventListener('click', startTest);
    document.getElementById('resumeBtn').addEventListener('click', resumeTest);
    document.getElementById('prevBtn').addEventListener('click', previousQuestion);
    document.getElementById('nextBtn').addEventListener('click', nextQuestion);
    document.getElementById('submitBtn').addEventListener('click', submitTest);
    document.getElementById('submitAnswerBtn').addEventListener('click', submitCurrentAnswer);
    document.getElementById('reviewBtn').addEventListener('click', goToReview);
    document.getElementById('restartBtn').addEventListener('click', restartTest);
    document.getElementById('downloadBtn').addEventListener('click', downloadResults);
    document.getElementById('backFromReviewBtn').addEventListener('click', backToResults);
    document.getElementById('domainSelect').addEventListener('change', (event) => {
        app.selectedDomain = event.target.value;
    });
    document.getElementById('feedbackContainer').addEventListener('click', handleExplanationToggle);
    document.getElementById('reviewContainer').addEventListener('click', handleExplanationToggle);

    document.querySelectorAll('.filter-btn').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            document.querySelectorAll('.filter-btn').forEach((filterBtn) => filterBtn.classList.remove('active'));
            event.target.classList.add('active');
            app.currentFilter = event.target.dataset.filter;
            updateReviewScreen();
        });
    });

    document.querySelectorAll('.mode-card').forEach((card) => {
        card.addEventListener('click', () => selectMode(card.dataset.mode));
    });
}

function populateDomainSelect() {
    const domainSelect = document.getElementById('domainSelect');
    domainSelect.innerHTML = '';

    Object.entries(EXAM_CONFIG.domainWeights).forEach(([domain, weight]) => {
        const questionCount = app.allQuestions.filter((question) => question.category === domain).length;
        const option = document.createElement('option');
        option.value = domain;
        option.textContent = `${domain} (${weight}% | ${questionCount} questions)`;
        domainSelect.appendChild(option);
    });

    domainSelect.value = app.selectedDomain;
}

function selectMode(mode) {
    app.selectedMode = mode;

    document.querySelectorAll('.mode-card').forEach((card) => {
        card.classList.toggle('active', card.dataset.mode === mode);
    });

    document.getElementById('domainSelector').classList.toggle('hidden', mode !== 'domain');
}

function startTest() {
    const sessionQuestions = buildQuestionSet();

    if (!sessionQuestions.length) {
        showErrorMessage('No questions are available for the selected mode.');
        return;
    }

    clearTimer();

    app.questions = sessionQuestions;
    app.currentQuestion = 0;
    app.userAnswers = new Array(app.questions.length).fill(null);
    app.submittedQuestions = new Array(app.questions.length).fill(false);
    app.score = 0;
    app.testInProgress = true;
    app.isReview = false;
    app.examMode = createExamModeConfig();

    if (app.examMode.timed) {
        app.timeRemaining = EXAM_CONFIG.mockDurationMinutes * 60;
        startTimer();
    } else {
        app.timeRemaining = 0;
    }

    showScreen('quizScreen');
    displayQuestion();
    updateHomeScreen();
}

function createExamModeConfig() {
    if (app.selectedMode === 'mock') {
        return {
            id: 'mock',
            title: 'Timed Mock Exam',
            timed: true,
            immediateFeedback: false,
        };
    }

    if (app.selectedMode === 'domain') {
        return {
            id: 'domain',
            title: app.selectedDomain,
            timed: false,
            immediateFeedback: true,
        };
    }

    return {
        id: 'all',
        title: 'All Questions Practice',
        timed: false,
        immediateFeedback: true,
    };
}

function buildQuestionSet() {
    if (app.selectedMode === 'mock') {
        return buildWeightedMockExam();
    }

    if (app.selectedMode === 'domain') {
        return app.allQuestions.filter((question) => question.category === app.selectedDomain);
    }

    return [...app.allQuestions];
}

function buildWeightedMockExam() {
    const exactCounts = Object.entries(EXAM_CONFIG.domainWeights).map(([domain, weight]) => ({
        domain,
        exact: (EXAM_CONFIG.mockQuestionCount * weight) / 100,
    }));

    const counts = {};
    let allocated = 0;

    exactCounts.forEach(({ domain, exact }) => {
        counts[domain] = Math.floor(exact);
        allocated += counts[domain];
    });

    const remainder = EXAM_CONFIG.mockQuestionCount - allocated;
    exactCounts
        .sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))
        .slice(0, remainder)
        .forEach(({ domain }) => {
            counts[domain] += 1;
        });

    const selectedQuestions = [];
    Object.keys(EXAM_CONFIG.domainWeights).forEach((domain) => {
        const domainQuestions = shuffleArray(
            app.allQuestions.filter((question) => question.category === domain)
        );
        selectedQuestions.push(...domainQuestions.slice(0, counts[domain]));
    });

    return shuffleArray(selectedQuestions);
}

function normalizeUniqueQuestion(question) {
    return {
        question: question.question || '',
        options: normalizeOptionsObject(question.mcqs || question.options),
        correct_answer: normalizeAnswerValue(question.answer || question.correct_answer),
        explanation: question.explanation || '',
        category: normalizeCategoryName(question.category),
        source: 'unique_questions.json',
        sourceTopic: question.category || '',
        notes: question.notes || '',
        original_index: question.original_index || '',
    };
}

function normalizeOptionsObject(options) {
    if (Array.isArray(options)) {
        return options;
    }

    if (!options || typeof options !== 'object') {
        return [];
    }

    return Object.keys(options)
        .sort()
        .map((key) => options[key]);
}

function normalizeAnswerValue(answer) {
    if (Array.isArray(answer)) {
        return answer.map((value) => String(value).trim()).filter(Boolean).sort().join(',');
    }

    return String(answer || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .sort()
        .join(',');
}

function normalizeCategoryName(category) {
    const categoryMap = {
        'Data Preparation for ML': 'Data Preparation for Machine Learning (ML)',
        'ML Model Development': 'ML Model Development',
        'Deployment & Orchestration of ML Workflows': 'Deployment and Orchestration of ML Workflows',
        'Deployment and Orchestration of ML Workflows': 'Deployment and Orchestration of ML Workflows',
        'ML Solution Monitoring, Maintenance & Security': 'ML Solution Monitoring, Maintenance, and Security',
        'ML Solution Monitoring, Maintenance, and Security': 'ML Solution Monitoring, Maintenance, and Security',
    };

    return categoryMap[category] || category || 'ML Model Development';
}

function dedupeQuestions(questions) {
    const uniqueQuestions = new Map();

    questions.forEach((question) => {
        const key = question.question.replace(/\s+/g, ' ').trim().toLowerCase();

        if (!uniqueQuestions.has(key)) {
            uniqueQuestions.set(key, question);
        }
    });

    return Array.from(uniqueQuestions.values());
}

function resumeTest() {
    if (!app.testInProgress) {
        return;
    }

    showScreen('quizScreen');
    displayQuestion();
}

function restartTest() {
    clearTimer();
    app.testInProgress = false;
    app.questions = [];
    app.examMode = null;
    showScreen('homeScreen');
    updateHomeScreen();
}

function displayQuestion() {
    if (!app.questions.length) {
        return;
    }

    if (app.currentQuestion >= app.questions.length) {
        submitTest();
        return;
    }

    const question = app.questions[app.currentQuestion];
    const isPracticeMode = app.examMode?.immediateFeedback;
    const isSubmitted = app.submittedQuestions[app.currentQuestion];

    document.getElementById('questionNumber').textContent = `Question ${app.currentQuestion + 1}`;
    document.getElementById('questionText').textContent = question.question;
    document.getElementById('questionCounter').textContent = `${app.currentQuestion + 1} / ${app.questions.length}`;
    document.getElementById('questionType').textContent = isMultipleSelect(question) ? 'Multiple Select' : 'Single Choice';
    document.getElementById('questionCategory').textContent = question.category || '';
    document.getElementById('sessionTitle').textContent = app.examMode?.title || 'Practice Session';

    const timerDisplay = document.getElementById('timerDisplay');
    timerDisplay.style.display = app.examMode?.timed ? 'inline' : 'none';
    if (app.examMode?.timed) {
        updateTimerDisplay();
    }

    const progress = ((app.currentQuestion + 1) / app.questions.length) * 100;
    document.getElementById('progressFill').style.width = `${progress}%`;

    displayOptions(question);
    renderFeedback();

    document.getElementById('prevBtn').disabled = app.currentQuestion === 0;
    document.getElementById('nextBtn').style.display =
        app.currentQuestion === app.questions.length - 1 ? 'none' : 'inline-block';
    document.getElementById('submitBtn').style.display =
        app.currentQuestion === app.questions.length - 1 ? 'inline-block' : 'none';
    document.getElementById('submitAnswerBtn').style.display = isPracticeMode ? 'inline-block' : 'none';
    document.getElementById('submitAnswerBtn').disabled = isSubmitted || !hasAnswer(app.userAnswers[app.currentQuestion]);
    document.getElementById('nextBtn').disabled = isPracticeMode && !isSubmitted;

    updateQuickNavigation();
    updateScoreDisplay();
    scrollToQuestion();
}

function scrollToQuestion() {
    const questionCard = document.querySelector('.question-card');
    if (questionCard) {
        questionCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function displayOptions(question) {
    const container = document.getElementById('optionsContainer');
    container.innerHTML = '';

    const multipleSelect = isMultipleSelect(question);
    const submitted = app.submittedQuestions[app.currentQuestion];
    const userSelections = normalizeAnswerSet(app.userAnswers[app.currentQuestion]);
    const correctSelections = normalizeAnswerSet(question.correct_answer);

    question.options.forEach((option, index) => {
        const optionLetter = String.fromCharCode(65 + index);
        const optionDiv = document.createElement('div');
        optionDiv.className = 'option';

        const input = document.createElement('input');
        input.type = multipleSelect ? 'checkbox' : 'radio';
        input.name = `option-${app.currentQuestion}`;
        input.className = 'option-input';
        input.value = optionLetter;
        input.checked = userSelections.includes(optionLetter);
        input.disabled = submitted;

        const label = document.createElement('label');
        label.className = 'option-label';
        label.innerHTML = `<strong>${optionLetter}.</strong> ${option}`;

        if (input.checked) {
            optionDiv.classList.add('selected');
        }

        if (submitted) {
            if (correctSelections.includes(optionLetter)) {
                optionDiv.classList.add('correct');
            } else if (userSelections.includes(optionLetter)) {
                optionDiv.classList.add('incorrect');
            }
        }

        input.addEventListener('change', () => {
            if (multipleSelect) {
                handleMultipleSelect(optionLetter, input.checked);
            } else {
                handleSingleSelect(optionLetter);
            }

            displayQuestion();
        });

        optionDiv.appendChild(input);
        optionDiv.appendChild(label);

        optionDiv.addEventListener('click', (event) => {
            if (event.target === input) {
                return;
            }

            if (submitted) {
                return;
            }

            if (multipleSelect) {
                input.checked = !input.checked;
            } else {
                input.checked = true;
            }

            input.dispatchEvent(new Event('change'));
        });

        container.appendChild(optionDiv);
    });
}

function handleSingleSelect(value) {
    app.userAnswers[app.currentQuestion] = value;
}

function handleMultipleSelect(value, checked) {
    const currentSelections = normalizeAnswerSet(app.userAnswers[app.currentQuestion]);
    const updatedSelections = checked
        ? [...new Set([...currentSelections, value])]
        : currentSelections.filter((selection) => selection !== value);

    app.userAnswers[app.currentQuestion] = updatedSelections.length ? updatedSelections.sort().join(',') : null;
}

function submitCurrentAnswer() {
    if (!app.examMode?.immediateFeedback) {
        return;
    }

    if (!hasAnswer(app.userAnswers[app.currentQuestion])) {
        showErrorMessage('Please select an answer before submitting this question.');
        return;
    }

    app.submittedQuestions[app.currentQuestion] = true;
    recalculateScore();
    displayQuestion();
}

function previousQuestion() {
    if (app.currentQuestion > 0) {
        app.currentQuestion -= 1;
        displayQuestion();
    }
}

function nextQuestion() {
    if (app.currentQuestion < app.questions.length - 1) {
        if (app.examMode?.immediateFeedback && !app.submittedQuestions[app.currentQuestion]) {
            showErrorMessage('Submit the current question to see the answer before moving on.');
            return;
        }

        app.currentQuestion += 1;
        displayQuestion();
    }
}

function updateQuickNavigation() {
    const container = document.getElementById('quickNavContainer');
    container.innerHTML = '';

    app.questions.forEach((_, index) => {
        const button = document.createElement('button');
        button.className = 'quick-nav-btn';
        button.textContent = index + 1;

        if (index === app.currentQuestion) {
            button.classList.add('active');
        }

        if (hasAnswer(app.userAnswers[index])) {
            button.classList.add('answered');
        } else {
            button.classList.add('unanswered');
        }

        if (app.examMode?.immediateFeedback && app.submittedQuestions[index]) {
            button.classList.add('reviewed');
        }

        button.addEventListener('click', () => {
            app.currentQuestion = index;
            displayQuestion();
        });

        container.appendChild(button);
    });
}

function submitTest() {
    recalculateScore();
    clearTimer();

    const percentage = Math.round((app.score / app.questions.length) * 100);
    app.testHistory.push({
        date: new Date().toISOString(),
        score: app.score,
        total: app.questions.length,
        percentage,
        mode: app.examMode?.title || 'Practice Session',
    });

    localStorage.setItem('testHistory', JSON.stringify(app.testHistory));
    app.testInProgress = false;
    updateHomeScreen();
    showResultsScreen();
}

function recalculateScore() {
    app.score = app.questions.reduce((total, question, index) => {
        return total + (isCorrectAnswer(app.userAnswers[index], question.correct_answer) ? 1 : 0);
    }, 0);
}

function showResultsScreen() {
    const percentage = Math.round((app.score / app.questions.length) * 100);

    document.getElementById('finalScore').textContent = percentage;
    document.getElementById('correctCount').textContent = app.score;
    document.getElementById('totalCount').textContent = app.questions.length;
    document.getElementById('accuracy').textContent = `${percentage}%`;

    const scoreCircle = document.getElementById('scoreCircle');
    if (percentage >= 80) {
        scoreCircle.style.background = 'linear-gradient(135deg, #28a745, #20c997)';
    } else if (percentage >= 60) {
        scoreCircle.style.background = 'linear-gradient(135deg, #ffc107, #ff9800)';
    } else {
        scoreCircle.style.background = 'linear-gradient(135deg, #dc3545, #c82333)';
    }

    showScreen('resultsScreen');
}

function goToReview() {
    app.isReview = true;
    app.currentFilter = 'all';

    document.querySelectorAll('.filter-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.filter === 'all');
    });

    updateReviewScreen();
    showScreen('reviewScreen');
}

function updateReviewScreen() {
    const container = document.getElementById('reviewContainer');
    container.innerHTML = '';

    app.questions.forEach((question, index) => {
        const userAnswer = app.userAnswers[index];
        const correctAnswer = question.correct_answer.trim();
        const isCorrect = isCorrectAnswer(userAnswer, correctAnswer);

        if (app.currentFilter === 'correct' && !isCorrect) {
            return;
        }

        if (app.currentFilter === 'incorrect' && isCorrect) {
            return;
        }

        const reviewItem = document.createElement('div');
        reviewItem.className = `review-item ${isCorrect ? 'correct' : 'incorrect'}`;

        let optionsHTML = '';
        question.options.forEach((option, optionIndex) => {
            const optionLetter = String.fromCharCode(65 + optionIndex);
            const userSelections = normalizeAnswerSet(userAnswer);
            const correctSelections = normalizeAnswerSet(correctAnswer);
            let optionClass = '';

            if (correctSelections.includes(optionLetter)) {
                optionClass = 'correct-answer';
            }

            if (userSelections.includes(optionLetter) && !correctSelections.includes(optionLetter)) {
                optionClass = 'user-answer';
            }

            if (optionClass) {
                optionsHTML += `
                    <div class="review-option ${optionClass}">
                        <strong>${optionLetter}.</strong> ${option}
                    </div>
                `;
            }
        });

        reviewItem.innerHTML = `
            <div class="review-item-header">
                <span class="review-question-num">Question ${index + 1}</span>
                <span class="review-status ${isCorrect ? 'correct' : 'incorrect'}">${isCorrect ? 'Correct' : 'Incorrect'}</span>
            </div>
            <div class="review-question">${question.question}</div>
            <div class="review-category">${question.category || ''}</div>
            <div class="review-options">${optionsHTML}</div>
            <div class="review-item-actions">
                <button class="explanation-toggle" type="button" aria-expanded="false">Show Explanation</button>
            </div>
            <div class="review-explanation hidden"><strong>Explanation:</strong><br>${question.explanation || 'No explanation provided.'}</div>
        `;

        container.appendChild(reviewItem);
    });
}

function backToResults() {
    showScreen('resultsScreen');
}

function downloadResults() {
    let csv = 'Question #,Category,User Answer,Correct Answer,Status,Explanation\n';

    app.questions.forEach((question, index) => {
        const userAnswer = app.userAnswers[index] || 'Not answered';
        const correctAnswer = question.correct_answer;
        const status = isCorrectAnswer(userAnswer, correctAnswer) ? 'Correct' : 'Incorrect';
        const explanation = (question.explanation || '').replace(/"/g, '""');
        const category = (question.category || '').replace(/"/g, '""');

        csv += `"${index + 1}","${category}","${userAnswer}","${correctAnswer}","${status}","${explanation}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `quiz-results-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
}

function renderFeedback() {
    const container = document.getElementById('feedbackContainer');

    if (!app.examMode?.immediateFeedback || !app.submittedQuestions[app.currentQuestion]) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    const question = app.questions[app.currentQuestion];
    const isCorrect = isCorrectAnswer(app.userAnswers[app.currentQuestion], question.correct_answer);

    container.className = `feedback-panel ${isCorrect ? 'correct' : 'incorrect'}`;
    container.style.display = 'block';
    container.innerHTML = `
        <div class="feedback-title">${isCorrect ? 'Correct Answer' : 'Incorrect Answer'}</div>
        <div class="feedback-summary">
            <div class="feedback-answer">Correct option: ${question.correct_answer}</div>
            <button class="explanation-toggle" type="button" aria-expanded="false">Show Explanation</button>
        </div>
        <div class="explanation-content hidden">${question.explanation || 'No explanation provided.'}</div>
    `;
}

function handleExplanationToggle(event) {
    const toggleButton = event.target.closest('.explanation-toggle');
    if (!toggleButton) {
        return;
    }

    const content = toggleButton.parentElement.nextElementSibling;
    if (!content) {
        return;
    }

    const isHidden = content.classList.toggle('hidden');
    toggleButton.textContent = isHidden ? 'Show Explanation' : 'Hide Explanation';
    toggleButton.setAttribute('aria-expanded', String(!isHidden));
}

function updateScoreDisplay() {
    const answeredCount = app.userAnswers.filter((answer) => hasAnswer(answer)).length;
    const suffix = app.examMode?.immediateFeedback ? ` | Reviewed: ${app.submittedQuestions.filter(Boolean).length}` : '';
    document.getElementById('scoreDisplay').textContent = `Score: ${app.score}/${app.questions.length} | Answered: ${answeredCount}/${app.questions.length}${suffix}`;
}

function updateHomeScreen() {
    const history = localStorage.getItem('testHistory');
    if (history) {
        app.testHistory = JSON.parse(history);
        document.getElementById('completedTests').textContent = app.testHistory.length;
        const bestScore = app.testHistory.reduce((max, test) => Math.max(max, test.percentage), 0);
        document.getElementById('bestScore').textContent = `${bestScore}%`;
    }

    document.getElementById('resumeBtn').style.display = app.testInProgress ? 'inline-block' : 'none';
}

function startTimer() {
    updateTimerDisplay();
    app.timerId = window.setInterval(() => {
        app.timeRemaining -= 1;
        updateTimerDisplay();

        if (app.timeRemaining <= 0) {
            clearTimer();
            submitTest();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const minutes = Math.floor(Math.max(app.timeRemaining, 0) / 60);
    const seconds = Math.max(app.timeRemaining, 0) % 60;
    document.getElementById('timerDisplay').textContent = `Time Left: ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function clearTimer() {
    if (app.timerId) {
        window.clearInterval(app.timerId);
        app.timerId = null;
    }
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach((screen) => {
        screen.classList.remove('active');
    });

    document.getElementById(screenId).classList.add('active');
}

function showErrorMessage(message) {
    window.alert(message);
}

function shuffleArray(items) {
    const array = [...items];
    for (let index = array.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [array[index], array[randomIndex]] = [array[randomIndex], array[index]];
    }
    return array;
}

function normalizeAnswerSet(answer) {
    if (!answer) {
        return [];
    }

    return String(answer)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .sort();
}

function isCorrectAnswer(userAnswer, correctAnswer) {
    const normalizedUser = normalizeAnswerSet(userAnswer).join(',');
    const normalizedCorrect = normalizeAnswerSet(correctAnswer).join(',');
    return normalizedUser && normalizedUser === normalizedCorrect;
}

function isMultipleSelect(question) {
    return question.correct_answer.includes(',');
}

function hasAnswer(answer) {
    return normalizeAnswerSet(answer).length > 0;
}

window.addEventListener('beforeunload', (event) => {
    if (app.testInProgress && app.currentQuestion > 0) {
        event.preventDefault();
        event.returnValue = '';
    }
});
