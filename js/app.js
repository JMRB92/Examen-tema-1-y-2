/**
 * app.js
 * Controlador principal de la aplicación web de exámenes tipo test (Versión 1.01).
 * Coordina la identificación del alumno, instrucciones, ejecución del examen,
 * recuperación tras cierre/recarga, resultados, PDF/JSON y Panel del profesor autenticado.
 */

import {
  isStorageAvailable,
  getActiveExam,
  clearActiveExam,
  saveLastResult,
  getLastResult,
  clearLastResult
} from './storage.js';
import { loadQuestionBank } from './questions.js';
import { ExamSession } from './exam.js';
import { evaluateExam, downloadResultJSON } from './results.js';
import { downloadResultPDF } from './pdf.js';
import { TeacherPanelController, verifyTeacherCredentials } from './teacher.js';

export const APP_VERSION = '1.01';
const TEACHER_SESSION_KEY = 'exam_test_teacher_authenticated_v101';

class ExamApplication {
  constructor() {
    this.questionBank = [];
    this.identifiedStudent = null;
    this.session = null;
    this.currentResult = null;
    this.reviewFilter = 'all';
    this.teacherController = new TeacherPanelController();
    this.activeViewId = 'view-identification';
    this.isTeacherAuthenticated = this.readTeacherAuthSession();
  }

  readTeacherAuthSession() {
    try {
      return window.sessionStorage.getItem(TEACHER_SESSION_KEY) === 'true';
    } catch (err) {
      return false;
    }
  }

  writeTeacherAuthSession(isAuth) {
    this.isTeacherAuthenticated = Boolean(isAuth);
    try {
      if (this.isTeacherAuthenticated) {
        window.sessionStorage.setItem(TEACHER_SESSION_KEY, 'true');
      } else {
        window.sessionStorage.removeItem(TEACHER_SESSION_KEY);
      }
    } catch (err) {
      // Ignorar si sessionStorage no está disponible
    }
  }

  async init() {
    this.registerServiceWorker();
    this.setupConnectionIndicator();
    this.bindGlobalNavigation();
    this.bindTeacherLoginEvents();
    this.bindIdentificationEvents();
    this.bindInstructionsEvents();
    this.bindExamEvents();
    this.bindResultsEvents();
    this.bindModalEvents();

    if (!isStorageAvailable()) {
      this.showGlobalBanner(
        'El almacenamiento local (localStorage) está desactivado en tu navegador. ' +
        'El examen funcionará, pero no podrá recuperarse si recargas o cierras la pestaña.',
        'warning'
      );
    }

    try {
      this.questionBank = await loadQuestionBank('./data/questions.json');
      this.session = new ExamSession(this.questionBank);
      this.checkPendingOrRecentState();
    } catch (err) {
      this.showGlobalBanner(err.message, 'danger');
      const acceptBtn = document.getElementById('btn-accept-id');
      if (acceptBtn) acceptBtn.disabled = true;
    }
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('No se pudo registrar el Service Worker:', err);
      });
    }
  }

  setupConnectionIndicator() {
    const badge = document.getElementById('connection-badge');
    const text = document.getElementById('connection-text');
    if (!badge || !text) return;

    const updateStatus = () => {
      if (navigator.onLine) {
        badge.classList.remove('offline');
        text.textContent = 'Listo sin conexión';
      } else {
        badge.classList.add('offline');
        text.textContent = 'Modo sin conexión activo';
      }
    };

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();
  }

  showGlobalBanner(message, type = 'info') {
    const banner = document.getElementById('global-banner');
    if (!banner) return;
    banner.className = `alert alert-${type}`;
    banner.textContent = message;
    banner.classList.remove('hidden');
  }

  hideGlobalBanner() {
    const banner = document.getElementById('global-banner');
    if (banner) banner.classList.add('hidden');
  }

  switchView(viewId) {
    // Impedir acceso al panel del profesor si no hay sesión autenticada
    if (viewId === 'view-teacher' && !this.isTeacherAuthenticated) {
      this.openTeacherLoginModal();
      return;
    }

    const views = [
      'view-identification',
      'view-instructions',
      'view-exam',
      'view-results',
      'view-teacher'
    ];
    views.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.toggle('hidden', id !== viewId);
      }
    });
    this.activeViewId = viewId;

    const btnTeacher = document.getElementById('btn-open-teacher');
    const btnBackStudent = document.getElementById('btn-back-student');
    if (btnTeacher && btnBackStudent) {
      const inTeacher = viewId === 'view-teacher';
      btnTeacher.classList.toggle('hidden', inTeacher);
      btnBackStudent.classList.toggle('hidden', !inTeacher);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  returnToStudentView() {
    if (this.session && this.session.getState()?.status === 'in_progress') {
      this.switchView('view-exam');
    } else if (this.currentResult) {
      this.switchView('view-results');
    } else {
      this.switchView('view-identification');
    }
  }

  bindGlobalNavigation() {
    const btnTeacher = document.getElementById('btn-open-teacher');
    const btnBackStudent = document.getElementById('btn-back-student');
    const btnTeacherLogout = document.getElementById('btn-teacher-logout');

    btnTeacher?.addEventListener('click', () => {
      if (this.session && this.session.getState()?.status === 'in_progress') {
        const proceed = window.confirm(
          'Tienes un examen en curso y el temporizador seguirá contando en tiempo real. ' +
          '¿Seguro que deseas acceder al Panel del profesor?'
        );
        if (!proceed) return;
      }

      if (!this.isTeacherAuthenticated) {
        this.openTeacherLoginModal();
        return;
      }

      this.teacherController.init();
      this.switchView('view-teacher');
    });

    btnBackStudent?.addEventListener('click', () => {
      this.returnToStudentView();
    });

    btnTeacherLogout?.addEventListener('click', () => {
      this.writeTeacherAuthSession(false);
      this.returnToStudentView();
      this.showGlobalBanner('Sesión del Panel del profesor cerrada correctamente.', 'info');
    });
  }

  // =========================================================================
  // AUTENTICACIÓN DEL PANEL DEL PROFESOR
  // =========================================================================
  openTeacherLoginModal() {
    const modal = document.getElementById('modal-teacher-login');
    const form = document.getElementById('teacher-login-form');
    const userInput = document.getElementById('teacher-login-user');
    const passInput = document.getElementById('teacher-login-pass');
    const errBox = document.getElementById('teacher-login-error');

    form?.reset();
    if (passInput) passInput.type = 'password';
    const toggleBtn = document.getElementById('btn-toggle-teacher-pass');
    if (toggleBtn) toggleBtn.textContent = 'Mostrar';
    errBox?.classList.add('hidden');
    modal?.classList.remove('hidden');

    setTimeout(() => {
      userInput?.focus();
    }, 50);
  }

  bindTeacherLoginEvents() {
    const modal = document.getElementById('modal-teacher-login');
    const form = document.getElementById('teacher-login-form');
    const userInput = document.getElementById('teacher-login-user');
    const passInput = document.getElementById('teacher-login-pass');
    const errBox = document.getElementById('teacher-login-error');
    const btnCancel = document.getElementById('btn-cancel-teacher-login');
    const btnTogglePass = document.getElementById('btn-toggle-teacher-pass');

    const hideError = () => errBox?.classList.add('hidden');
    userInput?.addEventListener('input', hideError);
    passInput?.addEventListener('input', hideError);

    btnTogglePass?.addEventListener('click', () => {
      if (!passInput) return;
      const isHidden = passInput.type === 'password';
      passInput.type = isHidden ? 'text' : 'password';
      btnTogglePass.textContent = isHidden ? 'Ocultar' : 'Mostrar';
    });

    btnCancel?.addEventListener('click', () => {
      modal?.classList.add('hidden');
      form?.reset();
      hideError();
    });

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = userInput?.value || '';
      const password = passInput?.value || '';

      if (!verifyTeacherCredentials(username, password)) {
        if (errBox) {
          errBox.textContent = 'Usuario o contraseña incorrectos. Verifica tus credenciales.';
          errBox.classList.remove('hidden');
        }
        passInput?.focus();
        passInput?.select();
        return;
      }

      this.writeTeacherAuthSession(true);
      modal?.classList.add('hidden');
      form.reset();
      hideError();
      this.hideGlobalBanner();
      this.teacherController.init();
      this.switchView('view-teacher');
    });
  }

  /**
   * Comprueba al cargar la página si existe un examen pendiente en curso o un resultado reciente.
   */
  checkPendingOrRecentState() {
    const pendingExam = getActiveExam();

    if (pendingExam) {
      const now = Date.now();
      if (now >= pendingExam.endTime) {
        this.session.restore(pendingExam);
        const finalized = this.session.finalize();
        const evaluated = evaluateExam(finalized, this.questionBank, pendingExam.endTime, 'timeout');
        this.currentResult = evaluated;
        saveLastResult(evaluated);
        this.renderResults(evaluated);
        this.switchView('view-results');
        this.showGlobalBanner(
          'El tiempo máximo de 30 minutos finalizó mientras el navegador estaba cerrado. ' +
          'Tu examen se ha cerrado y evaluado automáticamente con las respuestas guardadas.',
          'warning'
        );
        return;
      }

      const answeredCount = Object.keys(pendingExam.answers || {}).length;
      const remainingFormatted = ExamSession.formatMMSS(pendingExam.endTime - now);
      const detailsEl = document.getElementById('recovery-details');
      if (detailsEl) {
        detailsEl.textContent =
          `Alumno/a: ${pendingExam.student.nombre} ${pendingExam.student.apellidos} ` +
          `(Grupo: ${pendingExam.student.grupo}) · Respondidas: ${answeredCount}/50 · ` +
          `Tiempo restante actual: ${remainingFormatted}.`;
      }

      const modal = document.getElementById('modal-recovery');
      modal?.classList.remove('hidden');

      const btnContinue = document.getElementById('btn-recovery-continue');
      const btnAbandon = document.getElementById('btn-recovery-abandon');

      if (btnContinue) {
        btnContinue.onclick = () => {
          modal?.classList.add('hidden');
          this.resumePendingExam(pendingExam);
        };
      }

      if (btnAbandon) {
        btnAbandon.onclick = () => {
          if (
            window.confirm(
              '¿Seguro que quieres abandonar el examen pendiente? Se perderán todas las respuestas marcadas en ese intento.'
            )
          ) {
            clearActiveExam();
            modal?.classList.add('hidden');
          }
        };
      }
      return;
    }

    const lastResult = getLastResult();
    const recentBanner = document.getElementById('recent-result-banner');
    const recentText = document.getElementById('recent-result-text');
    if (lastResult && recentBanner && recentText) {
      recentText.textContent =
        `Hay un resultado finalizado guardado en este navegador de ` +
        `${lastResult.student.nombre} ${lastResult.student.apellidos} ` +
        `(Nota: ${lastResult.summary.scoreFormatted} / 10).`;
      recentBanner.classList.remove('hidden');

      document.getElementById('btn-view-recent-result').onclick = () => {
        this.currentResult = lastResult;
        this.renderResults(lastResult);
        this.switchView('view-results');
      };

      document.getElementById('btn-dismiss-recent-result').onclick = () => {
        clearLastResult();
        recentBanner.classList.add('hidden');
      };
    }
  }

  resumePendingExam(savedExam) {
    this.identifiedStudent = { ...savedExam.student };
    this.session.restore(savedExam);
    this.startActiveExamUI();
  }

  // =========================================================================
  // 1. IDENTIFICACIÓN DEL ALUMNO
  // =========================================================================
  bindIdentificationEvents() {
    const form = document.getElementById('identification-form');
    const inputNombre = document.getElementById('input-nombre');
    const inputApellidos = document.getElementById('input-apellidos');
    const inputGrupo = document.getElementById('input-grupo');

    const clearFieldError = (input, errorId) => {
      input?.classList.remove('invalid');
      const errEl = document.getElementById(errorId);
      if (errEl) errEl.classList.add('hidden');
    };

    inputNombre?.addEventListener('input', () => clearFieldError(inputNombre, 'error-nombre'));
    inputApellidos?.addEventListener('input', () => clearFieldError(inputApellidos, 'error-apellidos'));
    inputGrupo?.addEventListener('input', () => clearFieldError(inputGrupo, 'error-grupo'));

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Si el banco aún no había terminado de cargar, intentar cargarlo en este momento
      if (!this.questionBank || this.questionBank.length !== 50) {
        try {
          this.questionBank = await loadQuestionBank('./data/questions.json');
          this.session = new ExamSession(this.questionBank);
          this.hideGlobalBanner();
        } catch (err) {
          this.showGlobalBanner(
            'No se puede iniciar porque el banco de preguntas no está disponible: ' + err.message,
            'danger'
          );
          return;
        }
      }

      const nombre = (inputNombre?.value || '').trim();
      const apellidos = (inputApellidos?.value || '').trim();
      const grupo = (inputGrupo?.value || '').trim();

      let valid = true;

      if (!nombre) {
        inputNombre?.classList.add('invalid');
        document.getElementById('error-nombre')?.classList.remove('hidden');
        valid = false;
      }
      if (!apellidos) {
        inputApellidos?.classList.add('invalid');
        document.getElementById('error-apellidos')?.classList.remove('hidden');
        valid = false;
      }
      if (!grupo) {
        inputGrupo?.classList.add('invalid');
        document.getElementById('error-grupo')?.classList.remove('hidden');
        valid = false;
      }

      if (!valid) {
        if (!nombre) inputNombre?.focus();
        else if (!apellidos) inputApellidos?.focus();
        else inputGrupo?.focus();
        return;
      }

      this.identifiedStudent = { nombre, apellidos, grupo };
      const pill = document.getElementById('instructions-student-summary');
      if (pill) {
        pill.textContent = `${nombre} ${apellidos} — Grupo: ${grupo}`;
      }

      this.hideGlobalBanner();
      this.switchView('view-instructions');
    });
  }

  // =========================================================================
  // 2. PANTALLA DE INSTRUCCIONES
  // =========================================================================
  bindInstructionsEvents() {
    const btnEditStudent = document.getElementById('btn-edit-student');
    const btnStartExam = document.getElementById('btn-start-exam');

    btnEditStudent?.addEventListener('click', () => {
      this.switchView('view-identification');
    });

    btnStartExam?.addEventListener('click', async () => {
      if (!this.identifiedStudent) {
        this.switchView('view-identification');
        return;
      }

      if (!this.session || !this.questionBank || this.questionBank.length !== 50) {
        try {
          this.questionBank = await loadQuestionBank('./data/questions.json');
          this.session = new ExamSession(this.questionBank);
        } catch (err) {
          this.showGlobalBanner('Error al cargar el examen: ' + err.message, 'danger');
          return;
        }
      }

      // El temporizador empieza a contar exactamente en este instante
      this.session.startNew(this.identifiedStudent);
      this.startActiveExamUI();
    });
  }

  // =========================================================================
  // 3. INTERFAZ DEL EXAMEN EN CURSO
  // =========================================================================
  startActiveExamUI() {
    this.hideGlobalBanner();
    const state = this.session.getState();
    const studentBar = document.getElementById('exam-student-label');
    if (studentBar && state) {
      studentBar.textContent = `${state.student.nombre} ${state.student.apellidos} · Grupo: ${state.student.grupo}`;
    }

    this.buildQuestionGrid();
    this.renderCurrentQuestion();
    this.switchView('view-exam');

    this.session.startTimer(
      ({ formatted, level }) => this.updateTimerDisplay(formatted, level),
      () => this.completeExam('timeout')
    );
  }

  updateTimerDisplay(formatted, level) {
    const timerBox = document.getElementById('timer-box');
    const timerVal = document.getElementById('timer-value');
    const urgentAlert = document.getElementById('exam-time-alert');

    if (timerVal) timerVal.textContent = formatted;
    if (timerBox) {
      timerBox.classList.remove('warning', 'critical');
      if (level === 'warning') timerBox.classList.add('warning');
      if (level === 'critical') timerBox.classList.add('critical');
    }

    if (urgentAlert) {
      if (level === 'critical') {
        urgentAlert.className = 'alert alert-danger';
        urgentAlert.textContent =
          '¡Atención! Queda menos de 1 minuto. El examen finalizará automáticamente cuando el reloj llegue a 00:00.';
        urgentAlert.classList.remove('hidden');
      } else if (level === 'warning') {
        urgentAlert.className = 'alert alert-warning';
        urgentAlert.textContent =
          'Aviso de tiempo: quedan menos de 5 minutos para finalizar el examen.';
        urgentAlert.classList.remove('hidden');
      } else {
        urgentAlert.classList.add('hidden');
      }
    }
  }

  buildQuestionGrid() {
    const grid = document.getElementById('question-grid');
    if (!grid || !this.session?.getState()) return;

    grid.innerHTML = '';
    const state = this.session.getState();

    state.questionOrder.forEach((planItem, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'grid-num-btn';
      btn.textContent = String(planItem.examPosition);
      btn.setAttribute('data-grid-index', String(idx));
      btn.setAttribute('aria-label', `Ir a la pregunta ${planItem.examPosition}`);
      btn.addEventListener('click', () => {
        if (this.session.goToIndex(idx)) {
          this.renderCurrentQuestion();
        }
      });
      grid.appendChild(btn);
    });
  }

  updateQuestionGridStates() {
    const grid = document.getElementById('question-grid');
    const state = this.session?.getState();
    if (!grid || !state) return;

    const buttons = grid.querySelectorAll('.grid-num-btn');
    buttons.forEach((btn, idx) => {
      const planItem = state.questionOrder[idx];
      const isAnswered = Boolean(state.answers[planItem.questionId]);
      const isCurrent = idx === state.currentIndex;

      btn.classList.toggle('answered', isAnswered);
      btn.classList.toggle('current', isCurrent);
      btn.setAttribute(
        'aria-label',
        `Pregunta ${planItem.examPosition}: ${isAnswered ? 'contestada' : 'sin contestar'}${isCurrent ? ' (actual)' : ''}`
      );
    });
  }

  renderCurrentQuestion() {
    if (!this.session || !this.session.getState()) return;

    const qView = this.session.getCurrentQuestionView();
    const counts = this.session.getProgressCounts();
    const state = this.session.getState();

    const progressText = document.getElementById('exam-progress-label');
    if (progressText) {
      progressText.textContent = `Contestadas: ${counts.answered} de ${counts.total} · Sin contestar: ${counts.unanswered}`;
    }

    const progressFill = document.getElementById('exam-progress-fill');
    if (progressFill) {
      const pct = Math.round((counts.answered / counts.total) * 100);
      progressFill.style.width = `${pct}%`;
    }

    const badge = document.getElementById('question-number-badge');
    if (badge) {
      badge.textContent = `Pregunta ${qView.examPosition} de ${qView.totalQuestions}`;
    }

    const statusPill = document.getElementById('question-status-pill');
    if (statusPill) {
      const answered = Boolean(qView.selectedOptionId);
      statusPill.textContent = answered ? 'Contestada' : 'Sin contestar';
      statusPill.className = `question-status-pill ${answered ? 'answered' : 'unanswered'}`;
    }

    const statementEl = document.getElementById('question-statement');
    if (statementEl) {
      statementEl.textContent = qView.questionText;
    }

    const optionsList = document.getElementById('options-list');
    if (optionsList) {
      optionsList.innerHTML = '';

      qView.shuffledOptions.forEach((opt) => {
        const isSelected = qView.selectedOptionId === opt.originalId;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `option-btn${isSelected ? ' selected' : ''}`;
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
        btn.setAttribute('data-display-letter', opt.displayLetter);

        const letterSpan = document.createElement('span');
        letterSpan.className = 'option-letter';
        letterSpan.textContent = opt.displayLetter;

        const textSpan = document.createElement('span');
        textSpan.className = 'option-text';
        textSpan.textContent = opt.text;

        btn.append(letterSpan, textSpan);

        btn.addEventListener('click', () => {
          if (this.session.selectAnswer(qView.questionId, opt.originalId)) {
            this.renderCurrentQuestion();
          }
        });

        optionsList.appendChild(btn);
      });
    }

    const btnClear = document.getElementById('btn-clear-answer');
    if (btnClear) {
      btnClear.disabled = !qView.selectedOptionId;
    }

    const btnPrev = document.getElementById('btn-prev-question');
    const btnNext = document.getElementById('btn-next-question');
    const btnFinishLast = document.getElementById('btn-finish-last');

    const isFirst = state.currentIndex === 0;
    const isLast = state.currentIndex === qView.totalQuestions - 1;

    if (btnPrev) btnPrev.disabled = isFirst;
    if (btnNext) btnNext.classList.toggle('hidden', isLast);
    if (btnFinishLast) btnFinishLast.classList.toggle('hidden', !isLast);

    this.updateQuestionGridStates();
  }

  bindExamEvents() {
    document.getElementById('btn-clear-answer')?.addEventListener('click', () => {
      if (!this.session?.getState()) return;
      const qView = this.session.getCurrentQuestionView();
      if (this.session.clearAnswer(qView.questionId)) {
        this.renderCurrentQuestion();
      }
    });

    document.getElementById('btn-prev-question')?.addEventListener('click', () => {
      if (this.session?.prevQuestion()) {
        this.renderCurrentQuestion();
      }
    });

    document.getElementById('btn-next-question')?.addEventListener('click', () => {
      if (this.session?.nextQuestion()) {
        this.renderCurrentQuestion();
      }
    });

    document.getElementById('btn-finish-last')?.addEventListener('click', () => {
      this.openFinishConfirmationModal();
    });

    document.getElementById('btn-finish-sidebar')?.addEventListener('click', () => {
      this.openFinishConfirmationModal();
    });

    document.addEventListener('keydown', (e) => {
      if (this.activeViewId !== 'view-exam') return;
      if (!document.getElementById('modal-finish')?.classList.contains('hidden')) return;
      if (!document.getElementById('modal-teacher-login')?.classList.contains('hidden')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      const key = e.key.toUpperCase();
      const letterMap = {
        '1': 'A',
        '2': 'B',
        '3': 'C',
        '4': 'D',
        'A': 'A',
        'B': 'B',
        'C': 'C',
        'D': 'D'
      };

      if (letterMap[key] && this.session?.getState()) {
        const qView = this.session.getCurrentQuestionView();
        const targetOpt = qView.shuffledOptions.find((o) => o.displayLetter === letterMap[key]);
        if (targetOpt && this.session.selectAnswer(qView.questionId, targetOpt.originalId)) {
          e.preventDefault();
          this.renderCurrentQuestion();
        }
      } else if (e.key === 'ArrowRight') {
        if (this.session?.nextQuestion()) {
          e.preventDefault();
          this.renderCurrentQuestion();
        }
      } else if (e.key === 'ArrowLeft') {
        if (this.session?.prevQuestion()) {
          e.preventDefault();
          this.renderCurrentQuestion();
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (this.session?.getState()) {
          const qView = this.session.getCurrentQuestionView();
          if (qView.selectedOptionId && this.session.clearAnswer(qView.questionId)) {
            e.preventDefault();
            this.renderCurrentQuestion();
          }
        }
      }
    });
  }

  openFinishConfirmationModal() {
    if (!this.session?.getState()) return;
    const counts = this.session.getProgressCounts();
    const countsText = document.getElementById('finish-modal-counts');
    if (countsText) {
      countsText.innerHTML =
        `Preguntas contestadas: <strong>${counts.answered}</strong><br>` +
        `Preguntas sin contestar: <strong>${counts.unanswered}</strong>`;
    }
    document.getElementById('modal-finish')?.classList.remove('hidden');
  }

  completeExam(reason = 'manual') {
    if (!this.session || !this.session.getState()) return;
    document.getElementById('modal-finish')?.classList.add('hidden');

    const finalizedState = this.session.finalize();
    if (!finalizedState) return;

    const evaluated = evaluateExam(finalizedState, this.questionBank, Date.now(), reason);
    this.currentResult = evaluated;
    saveLastResult(evaluated);

    this.reviewFilter = 'all';
    this.renderResults(evaluated);
    this.switchView('view-results');

    if (reason === 'timeout') {
      this.showGlobalBanner(
        'El tiempo de 30 minutos ha finalizado. El examen se ha cerrado y evaluado automáticamente.',
        'warning'
      );
    }
  }

  // =========================================================================
  // 4. PANTALLA DE RESULTADOS
  // =========================================================================
  renderResults(result) {
    const scoreBox = document.getElementById('result-score-box');
    const scoreValue = document.getElementById('result-score-value');
    if (scoreBox && scoreValue) {
      scoreValue.textContent = result.summary.scoreFormatted;
      scoreBox.classList.remove('passed', 'failed');
      scoreBox.classList.add(result.summary.score >= 5 ? 'passed' : 'failed');
    }

    const setMeta = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setMeta('res-student-name', `${result.student.nombre} ${result.student.apellidos}`);
    setMeta('res-student-group', result.student.grupo);
    setMeta('res-date', result.timing.dateFormatted);
    setMeta('res-start-time', result.timing.startTimeFormatted);
    setMeta('res-end-time', result.timing.endTimeFormatted);
    setMeta('res-elapsed-time', result.timing.elapsedFormatted);

    setMeta('res-count-correct', String(result.summary.correct));
    setMeta('res-count-incorrect', String(result.summary.incorrect));
    setMeta('res-count-unanswered', String(result.summary.unanswered));

    setMeta('filter-count-all', String(result.summary.totalQuestions));
    setMeta('filter-count-correct', String(result.summary.correct));
    setMeta('filter-count-incorrect', String(result.summary.incorrect));
    setMeta('filter-count-unanswered', String(result.summary.unanswered));

    document.querySelectorAll('[data-review-filter]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-review-filter') === this.reviewFilter);
    });

    this.renderReviewQuestionsList(result);
  }

  renderReviewQuestionsList(result) {
    const container = document.getElementById('results-review-list');
    if (!container) return;

    container.innerHTML = '';

    const filtered = result.questions.filter((q) => {
      if (this.reviewFilter === 'all') return true;
      return q.status === this.reviewFilter;
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'alert alert-info';
      empty.textContent = 'No hay preguntas en esta categoría.';
      container.appendChild(empty);
      return;
    }

    filtered.forEach((q) => {
      const card = document.createElement('article');
      card.className = `review-item ${q.status}`;

      const header = document.createElement('div');
      header.className = 'review-item-header';

      const numSpan = document.createElement('span');
      numSpan.className = 'review-q-num';
      numSpan.textContent = `Pregunta ${q.id}`;

      const badge = document.createElement('span');
      badge.className = `status-badge ${q.status}`;
      badge.textContent =
        q.status === 'correct'
          ? 'Correcta (+0,20)'
          : q.status === 'incorrect'
            ? 'Incorrecta (−0,05)'
            : 'Sin contestar (0)';

      header.append(numSpan, badge);

      const qTitle = document.createElement('p');
      qTitle.className = 'review-q-text';
      qTitle.textContent = q.question;

      const optsWrap = document.createElement('div');
      optsWrap.className = 'review-options';

      q.options.forEach((opt) => {
        const row = document.createElement('div');
        row.className = 'review-option';

        const isCorrect = opt.id === q.correctOptionId;
        const isSelected = opt.id === q.selectedOptionId;

        if (isCorrect) {
          row.classList.add('is-correct');
        } else if (isSelected) {
          row.classList.add('is-selected-wrong');
        }

        const labelSpan = document.createElement('span');
        labelSpan.textContent = `${opt.id}) ${opt.text}`;

        const tagsDiv = document.createElement('div');
        tagsDiv.className = 'review-option-tags';

        if (isCorrect) {
          const cTag = document.createElement('span');
          cTag.className = 'mini-tag correct-tag';
          cTag.textContent = 'Respuesta correcta';
          tagsDiv.appendChild(cTag);
        }

        if (isSelected) {
          const sTag = document.createElement('span');
          sTag.className = isCorrect ? 'mini-tag selected-tag' : 'mini-tag wrong-tag';
          sTag.textContent = 'Tu respuesta';
          tagsDiv.appendChild(sTag);
        }

        row.append(labelSpan, tagsDiv);
        optsWrap.appendChild(row);
      });

      const summaryLine = document.createElement('div');
      summaryLine.className = 'review-summary-line';
      summaryLine.innerHTML =
        `<span><strong>Tu respuesta:</strong> ${q.selectedOptionId ? q.selectedOptionId : 'Sin contestar'}</span>` +
        `<span><strong>Respuesta correcta:</strong> ${q.correctOptionId}</span>` +
        `<span><strong>Resultado:</strong> ${
          q.status === 'correct' ? 'Correcta' : q.status === 'incorrect' ? 'Incorrecta' : 'Sin contestar'
        }</span>`;

      card.append(header, qTitle, optsWrap, summaryLine);
      container.appendChild(card);
    });
  }

  bindResultsEvents() {
    document.getElementById('btn-download-pdf')?.addEventListener('click', () => {
      if (this.currentResult) {
        downloadResultPDF(this.currentResult);
      }
    });

    document.getElementById('btn-download-json')?.addEventListener('click', () => {
      if (this.currentResult) {
        downloadResultJSON(this.currentResult);
      }
    });

    document.getElementById('btn-new-exam')?.addEventListener('click', () => {
      const ok = window.confirm(
        '¿Deseas volver a la pantalla inicial para realizar un nuevo examen? ' +
        'Asegúrate de haber descargado antes tu PDF y archivo JSON si necesitas conservarlos.'
      );
      if (!ok) return;

      this.currentResult = null;
      this.identifiedStudent = null;
      this.hideGlobalBanner();

      const form = document.getElementById('identification-form');
      form?.reset();
      document.getElementById('recent-result-banner')?.classList.add('hidden');
      this.switchView('view-identification');
    });

    document.querySelectorAll('[data-review-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.reviewFilter = btn.getAttribute('data-review-filter') || 'all';
        if (this.currentResult) {
          this.renderResults(this.currentResult);
        }
      });
    });
  }

  bindModalEvents() {
    document.getElementById('btn-cancel-finish')?.addEventListener('click', () => {
      document.getElementById('modal-finish')?.classList.add('hidden');
    });

    document.getElementById('btn-confirm-finish')?.addEventListener('click', () => {
      this.completeExam('manual');
    });

    document.getElementById('btn-close-teacher-detail')?.addEventListener('click', () => {
      document.getElementById('modal-teacher-detail')?.classList.add('hidden');
    });

    document.getElementById('btn-close-teacher-detail-footer')?.addEventListener('click', () => {
      document.getElementById('modal-teacher-detail')?.classList.add('hidden');
    });
  }
}

function bootstrapExamApp() {
  if (window.__EXAM_APP_BOOTED__) return;
  window.__EXAM_APP_BOOTED__ = true;
  const app = new ExamApplication();
  window.__examApp = app;
  app.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapExamApp);
} else {
  bootstrapExamApp();
}
