/**
 * exam.js
 * Lógica central del examen en curso: gestión de respuestas, navegación,
 * temporizador basado en reloj real (sin reiniciarse al recargar) y cierre automático.
 */

import { generateUUID, saveActiveExam, clearActiveExam } from './storage.js';
import { createShuffledExamPlan } from './questions.js';

export const EXAM_DURATION_MINUTES = 30;
export const EXAM_DURATION_MS = EXAM_DURATION_MINUTES * 60 * 1000;
export const WARNING_THRESHOLD_MS = 5 * 60 * 1000;
export const CRITICAL_THRESHOLD_MS = 1 * 60 * 1000;

export class ExamSession {
  /**
   * @param {Array<object>} questionBank
   */
  constructor(questionBank) {
    this.questionBank = questionBank;
    this.questionMap = new Map(questionBank.map((q) => [q.id, q]));
    this.state = null;
    this.timerIntervalId = null;
    this.isLocked = false;
    this.onTickCallback = null;
    this.onExpireCallback = null;
  }

  /**
   * Inicia un nuevo examen aleatorizando preguntas y opciones desde el instante actual.
   * @param {{ nombre: string, apellidos: string, grupo: string }} student
   * @param {number} durationMs
   * @returns {object}
   */
  startNew(student, durationMs = EXAM_DURATION_MS) {
    this.stopTimer();
    const now = Date.now();
    this.isLocked = false;

    this.state = {
      attemptId: generateUUID(),
      student: {
        nombre: student.nombre.trim(),
        apellidos: student.apellidos.trim(),
        grupo: student.grupo.trim()
      },
      startTime: now,
      endTime: now + durationMs,
      durationMs,
      currentIndex: 0,
      questionOrder: createShuffledExamPlan(this.questionBank),
      answers: {},
      status: 'in_progress'
    };

    saveActiveExam(this.state);
    return this.state;
  }

  /**
   * Restaura exactamente un examen guardado previamente sin regenerar el orden aleatorio.
   * @param {object} savedState
   * @returns {object}
   */
  restore(savedState) {
    this.stopTimer();
    this.isLocked = false;
    this.state = {
      ...savedState,
      answers: { ...(savedState.answers || {}) }
    };
    return this.state;
  }

  /**
   * Devuelve el estado actual.
   * @returns {object|null}
   */
  getState() {
    return this.state;
  }

  /**
   * Devuelve los datos completos de la pregunta actualmente visible en pantalla.
   * @returns {{
   *   examPosition: number,
   *   totalQuestions: number,
   *   questionId: number,
   *   questionText: string,
   *   shuffledOptions: Array<{ displayLetter: string, originalId: string, text: string }>,
   *   selectedOptionId: string|null
   * }}
   */
  getCurrentQuestionView() {
    if (!this.state) {
      throw new Error('No hay ningún examen activo.');
    }
    const planItem = this.state.questionOrder[this.state.currentIndex];
    const originalQuestion = this.questionMap.get(planItem.questionId);
    const selectedOptionId = this.state.answers[planItem.questionId] || null;

    return {
      examPosition: planItem.examPosition,
      totalQuestions: this.state.questionOrder.length,
      questionId: planItem.questionId,
      questionText: originalQuestion.question,
      shuffledOptions: planItem.shuffledOptions,
      selectedOptionId
    };
  }

  /**
   * Selecciona una respuesta mediante su identificador original de opción.
   * @param {number} questionId
   * @param {string} originalOptionId
   * @returns {boolean}
   */
  selectAnswer(questionId, originalOptionId) {
    if (!this.state || this.isLocked || this.state.status !== 'in_progress') {
      return false;
    }
    if (this.getRemainingMs() <= 0) {
      return false;
    }
    this.state.answers[questionId] = originalOptionId;
    saveActiveExam(this.state);
    return true;
  }

  /**
   * Borra la respuesta seleccionada para la pregunta indicada.
   * @param {number} questionId
   * @returns {boolean}
   */
  clearAnswer(questionId) {
    if (!this.state || this.isLocked || this.state.status !== 'in_progress') {
      return false;
    }
    if (this.getRemainingMs() <= 0) {
      return false;
    }
    delete this.state.answers[questionId];
    saveActiveExam(this.state);
    return true;
  }

  /**
   * Navega directamente a una pregunta por su índice (0..49).
   * @param {number} index
   * @returns {boolean}
   */
  goToIndex(index) {
    if (!this.state || index < 0 || index >= this.state.questionOrder.length) {
      return false;
    }
    this.state.currentIndex = index;
    saveActiveExam(this.state);
    return true;
  }

  /**
   * Avanza a la siguiente pregunta.
   * @returns {boolean}
   */
  nextQuestion() {
    if (!this.state) return false;
    return this.goToIndex(this.state.currentIndex + 1);
  }

  /**
   * Retrocede a la pregunta anterior.
   * @returns {boolean}
   */
  prevQuestion() {
    if (!this.state) return false;
    return this.goToIndex(this.state.currentIndex - 1);
  }

  /**
   * Devuelve el recuento actual de preguntas contestadas y sin contestar.
   * @returns {{ answered: number, unanswered: number, total: number }}
   */
  getProgressCounts() {
    if (!this.state) {
      return { answered: 0, unanswered: 50, total: 50 };
    }
    const total = this.state.questionOrder.length;
    let answered = 0;
    for (const item of this.state.questionOrder) {
      if (this.state.answers[item.questionId]) {
        answered++;
      }
    }
    return {
      answered,
      unanswered: total - answered,
      total
    };
  }

  /**
   * Calcula los milisegundos restantes basándose en la hora real del sistema.
   * @param {number} now
   * @returns {number}
   */
  getRemainingMs(now = Date.now()) {
    if (!this.state) return 0;
    return Math.max(0, this.state.endTime - now);
  }

  /**
   * Formatea milisegundos en cadena MM:SS.
   * @param {number} ms
   * @returns {string}
   */
  static formatMMSS(ms) {
    const safeMs = Math.max(0, ms);
    const totalSeconds = Math.ceil(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  /**
   * Determina el estado visual del temporizador ('normal' | 'warning' | 'critical').
   * @param {number} remainingMs
   * @returns {'normal'|'warning'|'critical'}
   */
  static getTimerLevel(remainingMs) {
    if (remainingMs <= CRITICAL_THRESHOLD_MS) return 'critical';
    if (remainingMs <= WARNING_THRESHOLD_MS) return 'warning';
    return 'normal';
  }

  /**
   * Inicia el temporizador de control en tiempo real.
   * @param {(info: { remainingMs: number, formatted: string, level: string }) => void} onTick
   * @param {() => void} onExpire
   */
  startTimer(onTick, onExpire) {
    this.stopTimer();
    this.onTickCallback = onTick;
    this.onExpireCallback = onExpire;

    const tick = () => {
      if (!this.state || this.state.status !== 'in_progress') {
        this.stopTimer();
        return;
      }

      const remainingMs = this.getRemainingMs(Date.now());
      const formatted = ExamSession.formatMMSS(remainingMs);
      const level = ExamSession.getTimerLevel(remainingMs);

      if (typeof this.onTickCallback === 'function') {
        this.onTickCallback({ remainingMs, formatted, level });
      }

      if (remainingMs <= 0 && !this.isLocked) {
        this.isLocked = true;
        this.stopTimer();
        if (typeof this.onExpireCallback === 'function') {
          this.onExpireCallback();
        }
      }
    };

    tick();
    this.timerIntervalId = window.setInterval(tick, 250);
  }

  /**
   * Detiene el intervalo del temporizador.
   */
  stopTimer() {
    if (this.timerIntervalId !== null) {
      window.clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
  }

  /**
   * Marca el examen como finalizado y elimina el estado pendiente de localStorage
   * para impedir cualquier recuperación posterior.
   * @returns {object|null}
   */
  finalize() {
    this.isLocked = true;
    this.stopTimer();
    if (!this.state) return null;
    this.state.status = 'completed';
    const snapshot = {
      ...this.state,
      answers: { ...this.state.answers }
    };
    clearActiveExam();
    return snapshot;
  }
}
