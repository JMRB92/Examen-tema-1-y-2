/**
 * app-standalone.js (Versión 1.01)
 * Paquete compatible con ejecución directa local (file://) sin servidor HTTP.
 * En entornos HTTP/HTTPS (GitHub Pages), index.html ejecuta los módulos ES nativos.
 */
(function () {
  'use strict';
  if (window.__EXAM_APP_BOOTED__) return;

  // --- js/storage.js ---
/**
 * storage.js
 * Gestión segura del almacenamiento local del navegador (localStorage).
 * Todos los datos permanecen exclusivamente en el dispositivo del usuario.
 */

const STORAGE_KEYS = {
  ACTIVE_EXAM: 'exam_test_active_attempt_v1',
  LAST_RESULT: 'exam_test_last_result_v1',
  TEACHER_RECORDS: 'exam_test_teacher_records_v1'
};

/**
 * Comprueba si localStorage está disponible y operativo.
 * @returns {boolean}
 */
function isStorageAvailable() {
  try {
    const testKey = '__exam_storage_probe__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Genera un identificador único UUID v4 utilizando Web Crypto API cuando está disponible.
 * @returns {string}
 */
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Guarda el estado del examen en curso.
 * @param {object} examState
 * @returns {boolean}
 */
function saveActiveExam(examState) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.ACTIVE_EXAM, JSON.stringify(examState));
    return true;
  } catch (err) {
    console.error('No se pudo guardar el examen en curso:', err);
    return false;
  }
}

/**
 * Recupera el examen pendiente en curso, si existe y es estructuralmente válido.
 * @returns {object|null}
 */
function getActiveExam() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.ACTIVE_EXAM);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      parsed.status !== 'in_progress' ||
      !parsed.student ||
      !Array.isArray(parsed.questionOrder) ||
      parsed.questionOrder.length !== 50 ||
      typeof parsed.startTime !== 'number' ||
      typeof parsed.endTime !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch (err) {
    console.error('Error al leer el examen en curso:', err);
    return null;
  }
}

/**
 * Elimina el examen en curso tras finalizarlo o abandonarlo.
 */
function clearActiveExam() {
  try {
    window.localStorage.removeItem(STORAGE_KEYS.ACTIVE_EXAM);
  } catch (err) {
    console.error('Error al limpiar el examen en curso:', err);
  }
}

/**
 * Guarda el último resultado finalizado del alumno para evitar pérdida accidental al recargar.
 * @param {object} result
 */
function saveLastResult(result) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.LAST_RESULT, JSON.stringify(result));
  } catch (err) {
    console.error('No se pudo guardar el último resultado:', err);
  }
}

/**
 * Recupera el último resultado finalizado del alumno.
 * @returns {object|null}
 */
function getLastResult() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.LAST_RESULT);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Elimina el último resultado almacenado del alumno.
 */
function clearLastResult() {
  try {
    window.localStorage.removeItem(STORAGE_KEYS.LAST_RESULT);
  } catch (err) {
    console.error('Error al limpiar último resultado:', err);
  }
}

/**
 * Obtiene la lista de resultados importados en el Panel del profesor.
 * @returns {Array<object>}
 */
function getTeacherResults() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.TEACHER_RECORDS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error al leer los registros del profesor:', err);
    return [];
  }
}

/**
 * Guarda la lista actualizada de resultados en el Panel del profesor.
 * @param {Array<object>} records
 * @returns {boolean}
 */
function saveTeacherResults(records) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.TEACHER_RECORDS, JSON.stringify(records));
    return true;
  } catch (err) {
    console.error('Error al guardar los registros del profesor:', err);
    return false;
  }
}


  // --- js/questions.js ---
/**
 * questions.js
 * Carga, validación estricta del banco de 50 preguntas y aleatorización
 * independiente de preguntas y opciones manteniendo la trazabilidad de identificadores.
 * Versión 1.01
 */

const EXPECTED_QUESTION_COUNT = 50;
const DISPLAY_LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Carga el banco de preguntas desde ./data/questions.json y lo valida.
 * Si se ejecuta directamente desde archivo local (file://) donde el navegador bloquea fetch(),
 * utiliza automáticamente el respaldo sincronizado window.__FALLBACK_QUESTIONS__.
 * @param {string} url
 * @returns {Promise<Array<object>>}
 */
async function loadQuestionBank(url = './data/questions.json') {
  let data = null;
  let fetchError = null;

  try {
    let response;
    try {
      response = await fetch(url, { cache: 'no-cache' });
    } catch (networkErr) {
      response = await fetch(url);
    }

    if (!response || !response.ok) {
      throw new Error(`Error HTTP ${response ? response.status : 'desconocido'} al cargar preguntas.`);
    }
    data = await response.json();
  } catch (err) {
    fetchError = err;
    if (typeof window !== 'undefined' && Array.isArray(window.__FALLBACK_QUESTIONS__)) {
      data = window.__FALLBACK_QUESTIONS__;
    }
  }

  if (!data) {
    throw new Error(
      fetchError?.message ||
      'No se pudo cargar el archivo de preguntas (data/questions.json).'
    );
  }

  const validation = validateQuestionBank(data);
  if (!validation.valid) {
    throw new Error(`Banco de preguntas inválido: ${validation.errors.join(' | ')}`);
  }

  return validation.questions;
}

/**
 * Valida que el banco cumpla todas las reglas de integridad:
 * - Exactamente 50 preguntas.
 * - Sin identificadores duplicados.
 * - Cada pregunta tiene 4 opciones únicas.
 * - Cada pregunta tiene una única respuesta correcta existente entre sus opciones.
 * @param {unknown} data
 * @returns {{ valid: boolean, errors: string[], questions: Array<object> }}
 */
function validateQuestionBank(data) {
  const errors = [];

  if (!Array.isArray(data)) {
    return {
      valid: false,
      errors: ['El archivo de preguntas debe contener una lista (array) de 50 preguntas.'],
      questions: []
    };
  }

  if (data.length !== EXPECTED_QUESTION_COUNT) {
    errors.push(
      `Se esperaban exactamente ${EXPECTED_QUESTION_COUNT} preguntas, pero se encontraron ${data.length}.`
    );
  }

  const seenIds = new Set();

  data.forEach((item, idx) => {
    const label = `Pregunta en índice ${idx + 1}`;

    if (!item || typeof item !== 'object') {
      errors.push(`${label}: estructura no válida.`);
      return;
    }

    if (typeof item.id !== 'number' || !Number.isInteger(item.id) || item.id <= 0) {
      errors.push(`${label}: identificador de pregunta inválido.`);
    } else if (seenIds.has(item.id)) {
      errors.push(`Identificador de pregunta duplicado: ${item.id}.`);
    } else {
      seenIds.add(item.id);
    }

    if (typeof item.question !== 'string' || item.question.trim().length === 0) {
      errors.push(`Pregunta ${item.id ?? idx + 1}: el enunciado está vacío.`);
    }

    if (!Array.isArray(item.options) || item.options.length !== 4) {
      errors.push(`Pregunta ${item.id ?? idx + 1}: debe tener exactamente 4 opciones.`);
      return;
    }

    const optionIds = new Set();
    item.options.forEach((opt, optIdx) => {
      if (!opt || typeof opt !== 'object') {
        errors.push(`Pregunta ${item.id}: opción ${optIdx + 1} no válida.`);
        return;
      }
      if (typeof opt.id !== 'string' || opt.id.trim().length === 0) {
        errors.push(`Pregunta ${item.id}: opción ${optIdx + 1} sin identificador.`);
      } else if (optionIds.has(opt.id)) {
        errors.push(`Pregunta ${item.id}: identificador de opción duplicado (${opt.id}).`);
      } else {
        optionIds.add(opt.id);
      }

      if (typeof opt.text !== 'string' || opt.text.trim().length === 0) {
        errors.push(`Pregunta ${item.id}: texto vacío en la opción ${opt.id || optIdx + 1}.`);
      }
    });

    if (typeof item.correctOptionId !== 'string' || !optionIds.has(item.correctOptionId)) {
      errors.push(
        `Pregunta ${item.id}: la respuesta correcta (${item.correctOptionId}) no corresponde a ninguna opción existente.`
      );
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    questions: errors.length === 0 ? data : []
  };
}

/**
 * Devuelve un entero aleatorio uniforme en el rango [0, maxExclusive - 1].
 * @param {number} maxExclusive
 * @returns {number}
 */
function randomInt(maxExclusive) {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const array = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    let value;
    do {
      crypto.getRandomValues(array);
      value = array[0];
    } while (value >= limit);
    return value % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

/**
 * Realiza una permutación aleatoria imparcial (algoritmo Fisher-Yates) sin mutar el array original.
 * @template T
 * @param {Array<T>} items
 * @returns {Array<T>}
 */
function shuffleArray(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

/**
 * Genera el plan aleatorizado completo para un intento de examen.
 * @param {Array<object>} questionBank
 * @returns {Array<{
 *   examPosition: number,
 *   questionId: number,
 *   shuffledOptions: Array<{ displayLetter: string, originalId: string, text: string }>
 * }>}
 */
function createShuffledExamPlan(questionBank) {
  const shuffledQuestions = shuffleArray(questionBank);

  return shuffledQuestions.map((question, index) => {
    const shuffledRawOptions = shuffleArray(question.options);
    const shuffledOptions = shuffledRawOptions.map((opt, optIndex) => ({
      displayLetter: DISPLAY_LETTERS[optIndex],
      originalId: opt.id,
      text: opt.text
    }));

    return {
      examPosition: index + 1,
      questionId: question.id,
      shuffledOptions
    };
  });
}


  // --- js/exam.js ---
/**
 * exam.js
 * Lógica central del examen en curso: gestión de respuestas, navegación,
 * temporizador basado en reloj real (sin reiniciarse al recargar) y cierre automático.
 */


const EXAM_DURATION_MINUTES = 30;
const EXAM_DURATION_MS = EXAM_DURATION_MINUTES * 60 * 1000;
const WARNING_THRESHOLD_MS = 5 * 60 * 1000;
const CRITICAL_THRESHOLD_MS = 1 * 60 * 1000;

class ExamSession {
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


  // --- js/results.js ---
/**
 * results.js
 * Cálculo exacto de calificaciones, ordenación de resultados según el banco original (1..50, A..D)
 * y exportación del intento en formato JSON.
 */

const POINTS_CORRECT = 0.20;
const POINTS_INCORRECT = 0.05;
const MIN_SCORE = 0;
const MAX_SCORE = 10;

/**
 * Calcula la nota final utilizando aritmética entera en centésimas para evitar
 * errores de redondeo en coma flotante, acotando entre 0 y 10 con 2 decimales.
 *
 * @param {number} correct
 * @param {number} incorrect
 * @returns {number}
 */
function calculateScore(correct, incorrect) {
  const rawHundredths = correct * 20 - incorrect * 5;
  const clampedHundredths = Math.max(0, Math.min(1000, rawHundredths));
  return Number((clampedHundredths / 100).toFixed(2));
}

/**
 * Formatea una fecha epoch (ms) en fecha legible DD/MM/YYYY.
 * @param {number} epochMs
 * @returns {string}
 */
function formatDateES(epochMs) {
  const d = new Date(epochMs);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Formatea una fecha epoch (ms) en fecha ISO corta YYYY-MM-DD para nombres de archivo.
 * @param {number} epochMs
 * @returns {string}
 */
function formatDateISO(epochMs) {
  const d = new Date(epochMs);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${year}-${month}-${day}`;
}

/**
 * Formatea una hora epoch (ms) en HH:MM:SS.
 * @param {number} epochMs
 * @returns {string}
 */
function formatTimeES(epochMs) {
  const d = new Date(epochMs);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Formatea una duración en milisegundos como "MM min SS s".
 * @param {number} elapsedMs
 * @returns {string}
 */
function formatElapsedTime(elapsedMs) {
  const totalSec = Math.max(0, Math.round(elapsedMs / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins} min ${String(secs).padStart(2, '0')} s`;
}

/**
 * Evalúa un examen finalizado y genera el informe ordenado del 1 al 50
 * con las opciones en su orden original A, B, C y D.
 *
 * @param {object} examState
 * @param {Array<object>} questionBank
 * @param {number} finishedAt
 * @param {'manual'|'timeout'} finishReason
 * @returns {object}
 */
function evaluateExam(examState, questionBank, finishedAt = Date.now(), finishReason = 'manual') {
  const effectiveEndTime = Math.min(Math.max(examState.startTime, finishedAt), examState.endTime);
  const elapsedMs = Math.max(0, effectiveEndTime - examState.startTime);

  const positionByQuestionId = new Map();
  for (const item of examState.questionOrder) {
    positionByQuestionId.set(item.questionId, item.examPosition);
  }

  // Ordenar estrictamente según el identificador original (1 a 50)
  const orderedBank = questionBank.slice().sort((a, b) => a.id - b.id);

  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;

  const detailedQuestions = orderedBank.map((q) => {
    const selectedOptionId = examState.answers[q.id] || null;
    const correctOption = q.options.find((o) => o.id === q.correctOptionId);
    const selectedOption = selectedOptionId
      ? q.options.find((o) => o.id === selectedOptionId) || null
      : null;

    let status = 'unanswered';
    if (!selectedOptionId) {
      unanswered++;
      status = 'unanswered';
    } else if (selectedOptionId === q.correctOptionId) {
      correct++;
      status = 'correct';
    } else {
      incorrect++;
      status = 'incorrect';
    }

    return {
      id: q.id,
      examPosition: positionByQuestionId.get(q.id) || q.id,
      question: q.question,
      // Las 4 opciones se conservan en su orden original A, B, C, D
      options: q.options.map((opt) => ({
        id: opt.id,
        text: opt.text
      })),
      selectedOptionId,
      selectedOptionText: selectedOption ? selectedOption.text : null,
      correctOptionId: q.correctOptionId,
      correctOptionText: correctOption ? correctOption.text : '',
      status
    };
  });

  if (correct + incorrect + unanswered !== orderedBank.length) {
    throw new Error('Error de integridad en el recuento de respuestas.');
  }

  const score = calculateScore(correct, incorrect);

  return {
    schemaVersion: '1.01',
    attemptId: examState.attemptId,
    student: {
      nombre: examState.student.nombre,
      apellidos: examState.student.apellidos,
      grupo: examState.student.grupo
    },
    timing: {
      startTime: examState.startTime,
      endTime: effectiveEndTime,
      elapsedMs,
      dateFormatted: formatDateES(effectiveEndTime),
      dateISO: formatDateISO(effectiveEndTime),
      startTimeFormatted: formatTimeES(examState.startTime),
      endTimeFormatted: formatTimeES(effectiveEndTime),
      elapsedFormatted: formatElapsedTime(elapsedMs),
      finishReason
    },
    summary: {
      totalQuestions: orderedBank.length,
      correct,
      incorrect,
      unanswered,
      score,
      scoreFormatted: score.toFixed(2).replace('.', ',')
    },
    questions: detailedQuestions
  };
}

/**
 * Normaliza un texto para usarlo de forma segura en nombres de archivo.
 * @param {string} str
 * @returns {string}
 */
function sanitizeFilePart(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Dato';
}

/**
 * Construye el nombre de archivo estándar: Examen_Nombre_Apellidos_Grupo_Fecha.<ext>
 * @param {object} result
 * @param {string} extension
 * @returns {string}
 */
function buildResultFilename(result, extension) {
  const nombre = sanitizeFilePart(result.student.nombre);
  const apellidos = sanitizeFilePart(result.student.apellidos);
  const grupo = sanitizeFilePart(result.student.grupo);
  const fecha = result.timing.dateISO || formatDateISO(result.timing.endTime);
  return `Examen_${nombre}_${apellidos}_${grupo}_${fecha}.${extension}`;
}

/**
 * Descarga los resultados completos del alumno en un archivo JSON para su entrega al profesor.
 * @param {object} result
 */
function downloadResultJSON(result) {
  const jsonContent = JSON.stringify(result, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildResultFilename(result, 'json');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


  // --- js/pdf.js ---
/**
 * pdf.js
 * Generador autónomo de documentos PDF 1.4 multipágina en el navegador (sin dependencias externas ni CDNs).
 * Produce un archivo PDF formal, limpio y listo para imprimir con:
 * - Cabecera institucional y datos completos del alumno y tiempos exactos.
 * - Resumen de calificación destacada.
 * - Revisión completa de las 50 preguntas en su orden original (1..50, A..D),
 *   garantizando que ninguna pregunta quede partida entre dos páginas.
 */

// Tabla de conversión Unicode -> Windows-1252 (WinAnsiEncoding estándar de PDF Type1)
const UNICODE_TO_WIN1252 = new Map([
  [0x20AC, 0x80], // €
  [0x201A, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201E, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02C6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8A], // Š
  [0x2039, 0x8B], // ‹
  [0x0152, 0x8C], // Œ
  [0x017D, 0x8E], // Ž
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201C, 0x93], // “
  [0x201D, 0x94], // ”
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02DC, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9A], // š
  [0x203A, 0x9B], // ›
  [0x0153, 0x9C], // œ
  [0x017E, 0x9E], // ž
  [0x0178, 0x9F]  // Ÿ
]);

/**
 * Normaliza caracteres especiales que no existen en WinAnsiEncoding (como flechas → o signo menos matemático −)
 * y codifica una cadena JS a bytes WinAnsiEncoding escapados para cadenas literales PDF.
 * @param {string} text
 * @returns {number[]}
 */
function encodeWinAnsiBytes(text) {
  const normalized = String(text ?? '')
    .replace(/→/g, '->')
    .replace(/−/g, '-')
    .replace(/
?
/g, ' ');

  const bytes = [];
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    let byteVal = 0x3F; // '?' por defecto si no es representable

    if (code >= 0x20 && code <= 0x7E) {
      byteVal = code;
    } else if (code >= 0xA0 && code <= 0xFF) {
      byteVal = code;
    } else if (UNICODE_TO_WIN1252.has(code)) {
      byteVal = UNICODE_TO_WIN1252.get(code);
    }

    // Escapar paréntesis y barra invertida dentro de literales PDF (...)
    if (byteVal === 0x28 || byteVal === 0x29 || byteVal === 0x5C) {
      bytes.push(0x5C, byteVal);
    } else {
      bytes.push(byteVal);
    }
  }
  return bytes;
}

/**
 * Estima el ancho en puntos tipográficos de una cadena en Helvetica / Helvetica-Bold.
 * Utiliza anchos conservadores para evitar desbordamientos en márgenes.
 * @param {string} text
 * @param {number} fontSize
 * @param {boolean} isBold
 * @returns {number}
 */
function estimateTextWidth(text, fontSize, isBold = false) {
  const str = String(text ?? '')
    .replace(/→/g, '->')
    .replace(/−/g, '-');

  let units = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if ('ilIj1.,:;'|! '.includes(ch)) {
      units += 0.30;
    } else if ('fjt()-[]{}«»"'.includes(ch)) {
      units += 0.38;
    } else if ('MW@%mw#&'.includes(ch)) {
      units += 0.86;
    } else if (ch >= 'A' && ch <= 'Z') {
      units += 0.68;
    } else if (ch >= '0' && ch <= '9') {
      units += 0.56;
    } else {
      units += 0.54;
    }
  }
  const boldFactor = isBold ? 1.06 : 1.0;
  return units * fontSize * boldFactor;
}

/**
 * Divide un texto en líneas que caben dentro de maxWidth puntos.
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} fontSize
 * @param {boolean} isBold
 * @returns {string[]}
 */
function wrapText(text, maxWidth, fontSize, isBold = false) {
  const cleaned = String(text ?? '')
    .replace(/→/g, '->')
    .replace(/−/g, '-')
    .trim();

  if (!cleaned) return [''];

  const words = cleaned.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (estimateTextWidth(candidate, fontSize, isBold) <= maxWidth) {
      currentLine = candidate;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      // Si una sola palabra supera maxWidth, trocearla por caracteres
      if (estimateTextWidth(word, fontSize, isBold) > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          if (estimateTextWidth(chunk + ch, fontSize, isBold) <= maxWidth) {
            chunk += ch;
          } else {
            if (chunk) lines.push(chunk);
            chunk = ch;
          }
        }
        currentLine = chunk;
      } else {
        currentLine = word;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Constructor interno de páginas y comandos gráficos PDF 1.4.
 */
class SimplePdfBuilder {
  constructor() {
    // Formato A4 vertical en puntos (595.28 x 841.89)
    this.pageWidth = 595.28;
    this.pageHeight = 841.89;
    this.marginLeft = 42;
    this.marginRight = 42;
    this.marginTop = 48;
    this.marginBottom = 46;
    this.contentWidth = this.pageWidth - this.marginLeft - this.marginRight;
    this.pages = [];
    this.currentOps = [];
    this.cursorY = this.pageHeight - this.marginTop;
    this.newPage();
  }

  newPage() {
    if (this.currentOps.length > 0) {
      this.pages.push(this.currentOps);
    }
    this.currentOps = [];
    this.cursorY = this.pageHeight - this.marginTop;
  }

  /**
   * Añade una operación de texto codificada en WinAnsi.
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {{ font?: 'F1'|'F2', size?: number, color?: [number, number, number] }} opts
   */
  drawText(text, x, y, opts = {}) {
    const font = opts.font || 'F1';
    const size = opts.size || 10;
    const [r, g, b] = opts.color || [0.06, 0.09, 0.16];
    const encoded = encodeWinAnsiBytes(text);

    this.currentOps.push({
      type: 'text',
      font,
      size,
      r,
      g,
      b,
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      bytes: encoded
    });
  }

  /**
   * Dibuja un rectángulo relleno y/o con borde.
   */
  drawRect(x, yBottom, width, height, opts = {}) {
    this.currentOps.push({
      type: 'rect',
      x: Number(x.toFixed(2)),
      y: Number(yBottom.toFixed(2)),
      w: Number(width.toFixed(2)),
      h: Number(height.toFixed(2)),
      fill: opts.fill || null,
      stroke: opts.stroke || null,
      lineWidth: opts.lineWidth || 0.75
    });
  }

  /**
   * Dibuja una línea horizontal o vertical.
   */
  drawLine(x1, y1, x2, y2, color = [0.8, 0.84, 0.88], lineWidth = 0.75) {
    this.currentOps.push({
      type: 'line',
      x1: Number(x1.toFixed(2)),
      y1: Number(y1.toFixed(2)),
      x2: Number(x2.toFixed(2)),
      y2: Number(y2.toFixed(2)),
      color,
      lineWidth
    });
  }

  /**
   * Compila todas las páginas en un Uint8Array binario compatible con PDF 1.4.
   * @param {string} footerLeftText
   * @returns {Uint8Array}
   */
  buildBinary(footerLeftText) {
    if (this.currentOps.length > 0) {
      this.pages.push(this.currentOps);
      this.currentOps = [];
    }

    const totalPages = this.pages.length;

    // Añadir pie de página numerado en todas las páginas
    for (let p = 0; p < totalPages; p++) {
      this.currentOps = this.pages[p];
      const footerY = 26;
      this.drawLine(
        this.marginLeft,
        footerY + 11,
        this.pageWidth - this.marginRight,
        footerY + 11,
        [0.82, 0.85, 0.9],
        0.6
      );
      this.drawText(footerLeftText, this.marginLeft, footerY, {
        font: 'F1',
        size: 8,
        color: [0.4, 0.45, 0.52]
      });
      const pageLabel = `Página ${p + 1} de ${totalPages}`;
      const labelW = estimateTextWidth(pageLabel, 8, false);
      this.drawText(pageLabel, this.pageWidth - this.marginRight - labelW, footerY, {
        font: 'F1',
        size: 8,
        color: [0.4, 0.45, 0.52]
      });
    }

    // Construcción de objetos PDF 1.4
    // Obj 1: Catalog
    // Obj 2: Pages
    // Obj 3: Font Helvetica (F1)
    // Obj 4: Font Helvetica-Bold (F2)
    // Luego 2 objetos por página: Page (5 + 2*i) y Contents (6 + 2*i)
    const chunks = [];
    let byteOffset = 0;
    const offsets = [0]; // Índice 0 reservado para tabla xref

    const pushAscii = (str) => {
      const arr = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        arr[i] = str.charCodeAt(i) & 0xFF;
      }
      chunks.push(arr);
      byteOffset += arr.length;
    };

    const pushBytes = (byteArr) => {
      const arr = byteArr instanceof Uint8Array ? byteArr : new Uint8Array(byteArr);
      chunks.push(arr);
      byteOffset += arr.length;
    };

    const startObj = (objNum) => {
      offsets[objNum] = byteOffset;
      pushAscii(`${objNum} 0 obj
`);
    };

    const endObj = () => {
      pushAscii('
endobj
');
    };

    // Cabecera PDF 1.4 con marcador binario
    pushAscii('%PDF-1.4
');
    pushBytes([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]);

    const pageObjNums = [];
    for (let i = 0; i < totalPages; i++) {
      pageObjNums.push(5 + i * 2);
    }

    // 1: Catalog
    startObj(1);
    pushAscii('<< /Type /Catalog /Pages 2 0 R >>');
    endObj();

    // 2: Pages
    startObj(2);
    pushAscii(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${totalPages} >>`);
    endObj();

    // 3: Helvetica
    startObj(3);
    pushAscii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    endObj();

    // 4: Helvetica-Bold
    startObj(4);
    pushAscii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    endObj();

    // Páginas y flujos de contenido
    for (let i = 0; i < totalPages; i++) {
      const pageObj = 5 + i * 2;
      const contentObj = 6 + i * 2;

      // Compilar flujo de contenido de la página
      const streamChunks = [];
      let streamLen = 0;
      const addStreamAscii = (s) => {
        const a = new Uint8Array(s.length);
        for (let k = 0; k < s.length; k++) a[k] = s.charCodeAt(k) & 0xFF;
        streamChunks.push(a);
        streamLen += a.length;
      };
      const addStreamBytes = (b) => {
        const a = new Uint8Array(b);
        streamChunks.push(a);
        streamLen += a.length;
      };

      for (const op of this.pages[i]) {
        if (op.type === 'rect') {
          addStreamAscii('q
');
          if (op.fill) {
            addStreamAscii(`${op.fill[0]} ${op.fill[1]} ${op.fill[2]} rg
`);
          }
          if (op.stroke) {
            addStreamAscii(`${op.lineWidth} w
`);
            addStreamAscii(`${op.stroke[0]} ${op.stroke[1]} ${op.stroke[2]} RG
`);
          }
          addStreamAscii(`${op.x} ${op.y} ${op.w} ${op.h} re
`);
          if (op.fill && op.stroke) {
            addStreamAscii('B
');
          } else if (op.fill) {
            addStreamAscii('f
');
          } else if (op.stroke) {
            addStreamAscii('S
');
          }
          addStreamAscii('Q
');
        } else if (op.type === 'line') {
          addStreamAscii('q
');
          addStreamAscii(`${op.lineWidth} w
`);
          addStreamAscii(`${op.color[0]} ${op.color[1]} ${op.color[2]} RG
`);
          addStreamAscii(`${op.x1} ${op.y1} m ${op.x2} ${op.y2} l S
`);
          addStreamAscii('Q
');
        } else if (op.type === 'text') {
          addStreamAscii('BT
');
          addStreamAscii(`/${op.font} ${op.size} Tf
`);
          addStreamAscii(`${op.r} ${op.g} ${op.b} rg
`);
          addStreamAscii(`1 0 0 1 ${op.x} ${op.y} Tm
`);
          addStreamAscii('(');
          addStreamBytes(op.bytes);
          addStreamAscii(') Tj
');
          addStreamAscii('ET
');
        }
      }

      startObj(pageObj);
      pushAscii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`
      );
      endObj();

      startObj(contentObj);
      pushAscii(`<< /Length ${streamLen} >>
stream
`);
      for (const sc of streamChunks) {
        pushBytes(sc);
      }
      pushAscii('
endstream');
      endObj();
    }

    // Tabla xref
    const totalObjects = offsets.length;
    const xrefStart = byteOffset;
    pushAscii(`xref
0 ${totalObjects}
`);
    pushAscii('0000000000 65535 f 
');
    for (let objIdx = 1; objIdx < totalObjects; objIdx++) {
      const offStr = String(offsets[objIdx]).padStart(10, '0');
      pushAscii(`${offStr} 00000 n 
`);
    }

    pushAscii(
      `trailer
<< /Size ${totalObjects} /Root 1 0 R >>
startxref
${xrefStart}
%%EOF`
    );

    const finalBuffer = new Uint8Array(byteOffset);
    let pos = 0;
    for (const c of chunks) {
      finalBuffer.set(c, pos);
      pos += c.length;
    }
    return finalBuffer;
  }
}

/**
 * Genera el binario Uint8Array del PDF formal de resultados del examen.
 * @param {object} result
 * @returns {Uint8Array}
 */
function buildResultPdfBytes(result) {
  const pdf = new SimplePdfBuilder();
  const left = pdf.marginLeft;
  const width = pdf.contentWidth;

  // =========================================================================
  // 1. CABECERA FORMAL DEL INFORME
  // =========================================================================
  const headerH = 54;
  pdf.drawRect(left, pdf.cursorY - headerH, width, headerH, {
    fill: [0.11, 0.25, 0.69]
  });
  pdf.drawText('INFORME OFICIAL DE RESULTADOS - EXAMEN TIPO TEST', left + 14, pdf.cursorY - 22, {
    font: 'F2',
    size: 13,
    color: [1, 1, 1]
  });
  pdf.drawText(
    `Finalizado el ${result.timing.dateFormatted} a las ${result.timing.endTimeFormatted}`,
    left + 14,
    pdf.cursorY - 40,
    {
      font: 'F1',
      size: 9.5,
      color: [0.86, 0.92, 1]
    }
  );
  pdf.cursorY -= headerH + 14;

  // =========================================================================
  // 2. DATOS DEL ALUMNO Y TIEMPOS
  // =========================================================================
  const metaH = 74;
  pdf.drawRect(left, pdf.cursorY - metaH, width, metaH, {
    fill: [0.97, 0.98, 0.99],
    stroke: [0.8, 0.84, 0.88],
    lineWidth: 0.8
  });

  const col1X = left + 12;
  const col2X = left + width * 0.54;
  let metaY = pdf.cursorY - 18;

  pdf.drawText('Alumno/a:', col1X, metaY, { font: 'F2', size: 9.5, color: [0.2, 0.25, 0.33] });
  pdf.drawText(`${result.student.nombre} ${result.student.apellidos}`, col1X + 56, metaY, {
    font: 'F1',
    size: 9.5
  });

  pdf.drawText('Fecha:', col2X, metaY, { font: 'F2', size: 9.5, color: [0.2, 0.25, 0.33] });
  pdf.drawText(result.timing.dateFormatted, col2X + 42, metaY, { font: 'F1', size: 9.5 });

  metaY -= 18;
  pdf.drawText('Grupo:', col1X, metaY, { font: 'F2', size: 9.5, color: [0.2, 0.25, 0.33] });
  pdf.drawText(result.student.grupo, col1X + 56, metaY, { font: 'F1', size: 9.5 });

  pdf.drawText('Hora inicio:', col2X, metaY, { font: 'F2', size: 9.5, color: [0.2, 0.25, 0.33] });
  pdf.drawText(result.timing.startTimeFormatted, col2X + 64, metaY, { font: 'F1', size: 9.5 });

  metaY -= 18;
  pdf.drawText('Tiempo:', col1X, metaY, { font: 'F2', size: 9.5, color: [0.2, 0.25, 0.33] });
  pdf.drawText(result.timing.elapsedFormatted, col1X + 56, metaY, { font: 'F1', size: 9.5 });

  pdf.drawText('Hora fin:', col2X, metaY, { font: 'F2', size: 9.5, color: [0.2, 0.25, 0.33] });
  pdf.drawText(result.timing.endTimeFormatted, col2X + 64, metaY, { font: 'F1', size: 9.5 });

  pdf.cursorY -= metaH + 12;

  // =========================================================================
  // 3. RESUMEN DE CALIFICACIÓN
  // =========================================================================
  const summaryH = 54;
  const boxGap = 8;
  const boxW = (width - boxGap * 3) / 4;

  const summaryCards = [
    {
      label: 'ACIERTOS (+0,20)',
      value: String(result.summary.correct),
      fill: [0.94, 0.99, 0.95],
      stroke: [0.53, 0.93, 0.67],
      textColor: [0.08, 0.5, 0.24]
    },
    {
      label: 'ERRORES (-0,05)',
      value: String(result.summary.incorrect),
      fill: [0.99, 0.95, 0.95],
      stroke: [0.98, 0.64, 0.64],
      textColor: [0.72, 0.11, 0.11]
    },
    {
      label: 'SIN CONTESTAR (0)',
      value: String(result.summary.unanswered),
      fill: [1, 0.98, 0.92],
      stroke: [0.98, 0.82, 0.3],
      textColor: [0.7, 0.32, 0.04]
    },
    {
      label: 'NOTA FINAL (0-10)',
      value: `${result.summary.scoreFormatted} / 10`,
      fill: [0.93, 0.96, 1],
      stroke: [0.57, 0.77, 0.99],
      textColor: [0.11, 0.25, 0.69]
    }
  ];

  summaryCards.forEach((card, idx) => {
    const bx = left + idx * (boxW + boxGap);
    pdf.drawRect(bx, pdf.cursorY - summaryH, boxW, summaryH, {
      fill: card.fill,
      stroke: card.stroke,
      lineWidth: 0.9
    });
    pdf.drawText(card.label, bx + 8, pdf.cursorY - 17, {
      font: 'F2',
      size: 7.5,
      color: card.textColor
    });
    pdf.drawText(card.value, bx + 8, pdf.cursorY - 39, {
      font: 'F2',
      size: 14,
      color: card.textColor
    });
  });

  pdf.cursorY -= summaryH + 18;

  // Título de sección de revisión
  pdf.drawText('REVISIÓN COMPLETA DEL EXAMEN (ORDEN ORIGINAL 1 A 50)', left, pdf.cursorY, {
    font: 'F2',
    size: 11,
    color: [0.06, 0.09, 0.16]
  });
  pdf.cursorY -= 8;
  pdf.drawLine(left, pdf.cursorY, left + width, pdf.cursorY, [0.11, 0.25, 0.69], 1.1);
  pdf.cursorY -= 12;

  // =========================================================================
  // 4. LAS 50 PREGUNTAS EN ORDEN ORIGINAL SIN CORTES ENTRE PÁGINAS
  // =========================================================================
  const innerPadX = 10;
  const innerWidth = width - innerPadX * 2;
  const qLineHeight = 12.5;
  const optLineHeight = 11.5;

  for (const q of result.questions) {
    const statusText =
      q.status === 'correct'
        ? 'CORRECTA'
        : q.status === 'incorrect'
          ? 'INCORRECTA'
          : 'SIN CONTESTAR';

    const statusColors =
      q.status === 'correct'
        ? { border: [0.53, 0.85, 0.62], badgeBg: [0.9, 0.98, 0.92], badgeFg: [0.08, 0.5, 0.24] }
        : q.status === 'incorrect'
          ? { border: [0.95, 0.62, 0.62], badgeBg: [0.99, 0.92, 0.92], badgeFg: [0.72, 0.11, 0.11] }
          : { border: [0.85, 0.78, 0.52], badgeBg: [0.99, 0.97, 0.9], badgeFg: [0.65, 0.35, 0.05] };

    const qLines = wrapText(`${q.id}. ${q.question}`, innerWidth, 9.5, true);

    const wrappedOptions = q.options.map((opt) => {
      const tags = [];
      if (opt.id === q.correctOptionId) tags.push('[CORRECTA]');
      if (opt.id === q.selectedOptionId) tags.push('[SELECCIONADA]');
      const suffix = tags.length > 0 ? ` ${tags.join(' ')}` : '';
      const fullOptText = `${opt.id}) ${opt.text}${suffix}`;
      return {
        id: opt.id,
        isCorrect: opt.id === q.correctOptionId,
        isSelected: opt.id === q.selectedOptionId,
        lines: wrapText(fullOptText, innerWidth - 8, 8.8, opt.id === q.correctOptionId)
      };
    });

    const summaryLine =
      `Seleccionada: ${q.selectedOptionId || 'Ninguna'}   |   ` +
      `Correcta: ${q.correctOptionId}   |   ` +
      `Resultado: ${statusText}`;

    // Calcular altura exacta del bloque completo de la pregunta
    const headerRowH = 18;
    const qBlockH = qLines.length * qLineHeight;
    const optsBlockH = wrappedOptions.reduce((acc, o) => acc + o.lines.length * optLineHeight + 2, 0);
    const footerRowH = 16;
    const totalCardH = 8 + headerRowH + 4 + qBlockH + 6 + optsBlockH + 4 + footerRowH + 6;

    // Salto de página preventivo: evita dividir una pregunta entre dos páginas
    if (pdf.cursorY - totalCardH < pdf.marginBottom) {
      pdf.newPage();
    }

    const cardTop = pdf.cursorY;
    const cardBottom = cardTop - totalCardH;

    // Contorno de tarjeta de pregunta
    pdf.drawRect(left, cardBottom, width, totalCardH, {
      fill: [1, 1, 1],
      stroke: statusColors.border,
      lineWidth: 0.75
    });

    // Banda superior de estado dentro de la tarjeta
    pdf.drawRect(left + 0.5, cardTop - headerRowH - 4, width - 1, headerRowH + 3.5, {
      fill: statusColors.badgeBg
    });

    pdf.drawText(`Pregunta ${q.id} de 50`, left + innerPadX, cardTop - 15, {
      font: 'F2',
      size: 8.8,
      color: [0.12, 0.16, 0.23]
    });

    const badgeW = estimateTextWidth(statusText, 8.5, true);
    pdf.drawText(statusText, left + width - innerPadX - badgeW, cardTop - 15, {
      font: 'F2',
      size: 8.5,
      color: statusColors.badgeFg
    });

    let y = cardTop - headerRowH - 16;

    // Enunciado
    for (const line of qLines) {
      pdf.drawText(line, left + innerPadX, y, {
        font: 'F2',
        size: 9.5,
        color: [0.06, 0.09, 0.16]
      });
      y -= qLineHeight;
    }

    y -= 3;

    // 4 opciones en orden original A, B, C, D
    for (const opt of wrappedOptions) {
      const optColor = opt.isCorrect
        ? [0.08, 0.48, 0.22]
        : opt.isSelected
          ? [0.72, 0.11, 0.11]
          : [0.22, 0.27, 0.35];
      const optFont = opt.isCorrect || opt.isSelected ? 'F2' : 'F1';

      for (const oLine of opt.lines) {
        pdf.drawText(oLine, left + innerPadX + 6, y, {
          font: optFont,
          size: 8.8,
          color: optColor
        });
        y -= optLineHeight;
      }
      y -= 2;
    }

    // Línea de resumen inferior de la pregunta
    pdf.drawLine(left + innerPadX, y + 7, left + width - innerPadX, y + 7, [0.88, 0.9, 0.93], 0.5);
    pdf.drawText(summaryLine, left + innerPadX, y - 4, {
      font: 'F2',
      size: 8.2,
      color: statusColors.badgeFg
    });

    pdf.cursorY = cardBottom - 8;
  }

  const footerText =
    `${result.student.nombre} ${result.student.apellidos} (${result.student.grupo}) - ` +
    `Finalizado: ${result.timing.dateFormatted} ${result.timing.endTimeFormatted}`;

  return pdf.buildBinary(footerText);
}

/**
 * Genera y descarga localmente el PDF de resultados con el nombre:
 * Examen_Nombre_Apellidos_Grupo_Fecha.pdf
 * @param {object} result
 */
function downloadResultPDF(result) {
  const pdfBytes = buildResultPdfBytes(result);
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildResultFilename(result, 'pdf');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}


  // --- js/teacher.js ---
/**
 * teacher.js
 * Módulo independiente para el Panel del profesor:
 * - Importación múltiple de archivos JSON de resultados.
 * - Detección de intentos duplicados mediante attemptId único.
 * - Ordenación por nombre, grupo, nota o fecha, y búsqueda rápida.
 * - Consulta detallada de las 50 preguntas de cada alumno y descarga de su PDF.
 * - Eliminación individual o masiva de resultados importados.
 * - Exportación consolidada a CSV compatible con Microsoft Excel.
 */


const TEACHER_CREDENTIALS = Object.freeze({
  username: 'jmramirezb03',
  password: '123456789'
});

/**
 * Verifica las credenciales de acceso al Panel del profesor.
 * @param {string} username
 * @param {string} password
 * @returns {boolean}
 */
function verifyTeacherCredentials(username, password) {
  return (
    String(username ?? '').trim() === TEACHER_CREDENTIALS.username &&
    String(password ?? '') === TEACHER_CREDENTIALS.password
  );
}

/**
 * Valida que un archivo JSON importado corresponda a un resultado de examen válido.
 * @param {unknown} data
 * @returns {boolean}
 */
function isValidStudentResult(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.attemptId !== 'string' || data.attemptId.trim() === '') return false;
  if (!data.student || typeof data.student !== 'object') return false;
  if (
    typeof data.student.nombre !== 'string' ||
    typeof data.student.apellidos !== 'string' ||
    typeof data.student.grupo !== 'string'
  ) {
    return false;
  }
  if (!data.timing || typeof data.timing.endTime !== 'number') return false;
  if (
    !data.summary ||
    typeof data.summary.correct !== 'number' ||
    typeof data.summary.incorrect !== 'number' ||
    typeof data.summary.unanswered !== 'number' ||
    typeof data.summary.score !== 'number'
  ) {
    return false;
  }
  if (!Array.isArray(data.questions) || data.questions.length !== 50) return false;
  return true;
}

/**
 * Importa una colección de objetos JSON ya parseados evitando duplicados por attemptId.
 * @param {Array<object>} existingRecords
 * @param {Array<{ filename: string, content: unknown }>} parsedFiles
 * @returns {{
 *   records: Array<object>,
 *   importedCount: number,
 *   duplicateCount: number,
 *   invalidFiles: string[]
 * }}
 */
function mergeImportedResults(existingRecords, parsedFiles) {
  const knownIds = new Set(existingRecords.map((r) => r.attemptId));
  const updated = existingRecords.slice();
  let importedCount = 0;
  let duplicateCount = 0;
  const invalidFiles = [];

  for (const fileEntry of parsedFiles) {
    const candidate = fileEntry.content;
    if (!isValidStudentResult(candidate)) {
      invalidFiles.push(fileEntry.filename);
      continue;
    }
    if (knownIds.has(candidate.attemptId)) {
      duplicateCount++;
      continue;
    }
    knownIds.add(candidate.attemptId);
    updated.push(candidate);
    importedCount++;
  }

  return {
    records: updated,
    importedCount,
    duplicateCount,
    invalidFiles
  };
}

/**
 * Genera el contenido CSV compatible con Excel (con BOM UTF-8 y delimitador punto y coma).
 * @param {Array<object>} records
 * @returns {string}
 */
function buildTeacherCSV(records) {
  const escapeCSV = (val) => {
    const str = String(val ?? '');
    if (str.includes(';') || str.includes('"') || str.includes('
') || str.includes('
')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = [
    'Nombre',
    'Apellidos',
    'Grupo',
    'Fecha',
    'Hora inicio',
    'Hora finalización',
    'Tiempo empleado',
    'Aciertos',
    'Errores',
    'Sin contestar',
    'Nota',
    'ID Intento'
  ];

  const rows = records.map((r) => [
    r.student.nombre,
    r.student.apellidos,
    r.student.grupo,
    r.timing.dateFormatted || '',
    r.timing.startTimeFormatted || '',
    r.timing.endTimeFormatted || '',
    r.timing.elapsedFormatted || '',
    r.summary.correct,
    r.summary.incorrect,
    r.summary.unanswered,
    Number(r.summary.score).toFixed(2).replace('.', ','),
    r.attemptId
  ]);

  const csvLines = [
    headers.map(escapeCSV).join(';'),
    ...rows.map((row) => row.map(escapeCSV).join(';'))
  ];

  return '﻿' + csvLines.join('
');
}

class TeacherPanelController {
  constructor() {
    this.records = getTeacherResults();
    this.sortField = 'date'; // 'name' | 'group' | 'score' | 'date'
    this.sortDirection = 'desc'; // 'asc' | 'desc'
    this.searchQuery = '';
    this.bound = false;
  }

  init() {
    if (this.bound) {
      this.records = getTeacherResults();
      this.render();
      return;
    }
    this.bound = true;

    const fileInput = document.getElementById('teacher-file-input');
    const dropzone = document.getElementById('teacher-dropzone');
    const btnSelectFiles = document.getElementById('btn-teacher-select-files');
    const btnExportCsv = document.getElementById('btn-teacher-export-csv');
    const btnClearAll = document.getElementById('btn-teacher-clear-all');
    const searchInput = document.getElementById('teacher-search-input');

    btnSelectFiles?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput?.click();
    });

    dropzone?.addEventListener('click', () => {
      fileInput?.click();
    });

    dropzone?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput?.click();
      }
    });

    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone?.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-over');
    });

    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer?.files?.length) {
        this.handleFiles(e.dataTransfer.files);
      }
    });

    fileInput?.addEventListener('change', (e) => {
      if (e.target.files?.length) {
        this.handleFiles(e.target.files);
        e.target.value = '';
      }
    });

    document.querySelectorAll('[data-sort-field]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const field = btn.getAttribute('data-sort-field');
        if (this.sortField === field) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortField = field;
          this.sortDirection = field === 'score' || field === 'date' ? 'desc' : 'asc';
        }
        this.render();
      });
    });

    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.render();
    });

    btnExportCsv?.addEventListener('click', () => {
      this.exportCSV();
    });

    btnClearAll?.addEventListener('click', () => {
      if (this.records.length === 0) return;
      if (
        window.confirm(
          `¿Seguro que deseas eliminar los ${this.records.length} resultados importados en este navegador? Esta acción no se puede deshacer.`
        )
      ) {
        this.records = [];
        saveTeacherResults(this.records);
        this.showFeedback('Se han eliminado todos los resultados almacenados en el panel.', 'info');
        this.render();
      }
    });

    this.render();
  }

  /**
   * Lee e importa múltiples archivos JSON seleccionados por el profesor.
   * @param {FileList} fileList
   */
  async handleFiles(fileList) {
    const files = Array.from(fileList);
    const parsedFiles = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        parsedFiles.push({ filename: file.name, content: json });
      } catch (err) {
        parsedFiles.push({ filename: file.name, content: null });
      }
    }

    const result = mergeImportedResults(this.records, parsedFiles);
    this.records = result.records;
    saveTeacherResults(this.records);

    const parts = [`Archivos importados correctamente: ${result.importedCount}.`];
    if (result.duplicateCount > 0) {
      parts.push(`Duplicados omitidos: ${result.duplicateCount}.`);
    }
    if (result.invalidFiles.length > 0) {
      parts.push(`Archivos no válidos (${result.invalidFiles.length}): ${result.invalidFiles.join(', ')}.`);
    }

    const tone =
      result.invalidFiles.length > 0 && result.importedCount === 0
        ? 'danger'
        : result.duplicateCount > 0 || result.invalidFiles.length > 0
          ? 'warning'
          : 'success';

    this.showFeedback(parts.join(' '), tone);
    this.render();
  }

  showFeedback(message, type = 'info') {
    const box = document.getElementById('teacher-feedback');
    if (!box) return;
    box.className = `alert alert-${type}`;
    box.textContent = message;
    box.classList.remove('hidden');
  }

  getFilteredAndSortedRecords() {
    let list = this.records.slice();

    if (this.searchQuery) {
      list = list.filter((r) => {
        const full = `${r.student.nombre} ${r.student.apellidos} ${r.student.grupo}`.toLowerCase();
        return full.includes(this.searchQuery);
      });
    }

    const dir = this.sortDirection === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (this.sortField) {
        case 'name': {
          const nameA = `${a.student.apellidos} ${a.student.nombre}`.toLowerCase();
          const nameB = `${b.student.apellidos} ${b.student.nombre}`.toLowerCase();
          return nameA.localeCompare(nameB, 'es') * dir;
        }
        case 'group':
          return a.student.grupo.localeCompare(b.student.grupo, 'es') * dir;
        case 'score':
          return (a.summary.score - b.summary.score) * dir;
        case 'date':
        default:
          return (a.timing.endTime - b.timing.endTime) * dir;
      }
    });

    return list;
  }

  render() {
    const tbody = document.getElementById('teacher-table-body');
    const emptyMsg = document.getElementById('teacher-empty-state');
    const tableWrap = document.getElementById('teacher-table-wrap');
    const btnExportCsv = document.getElementById('btn-teacher-export-csv');
    const btnClearAll = document.getElementById('btn-teacher-clear-all');

    const totalEl = document.getElementById('teacher-stat-total');
    const avgEl = document.getElementById('teacher-stat-avg');
    const passEl = document.getElementById('teacher-stat-pass');

    const total = this.records.length;
    if (totalEl) totalEl.textContent = String(total);

    if (total > 0) {
      const avg = this.records.reduce((acc, r) => acc + r.summary.score, 0) / total;
      const passed = this.records.filter((r) => r.summary.score >= 5).length;
      if (avgEl) avgEl.textContent = avg.toFixed(2).replace('.', ',');
      if (passEl) passEl.textContent = `${passed} / ${total}`;
    } else {
      if (avgEl) avgEl.textContent = '0,00';
      if (passEl) passEl.textContent = '0 / 0';
    }

    if (btnExportCsv) btnExportCsv.disabled = total === 0;
    if (btnClearAll) btnClearAll.disabled = total === 0;

    // Actualizar indicadores de ordenación en cabeceras
    document.querySelectorAll('[data-sort-field]').forEach((btn) => {
      const field = btn.getAttribute('data-sort-field');
      const arrowSpan = btn.querySelector('.sort-indicator');
      if (arrowSpan) {
        arrowSpan.textContent =
          this.sortField === field ? (this.sortDirection === 'asc' ? '▲' : '▼') : '⇅';
      }
    });

    const visibleRecords = this.getFilteredAndSortedRecords();

    if (!tbody || !emptyMsg || !tableWrap) return;

    if (visibleRecords.length === 0) {
      tableWrap.classList.add('hidden');
      emptyMsg.classList.remove('hidden');
      emptyMsg.textContent =
        total === 0
          ? 'Aún no hay resultados importados. Selecciona o arrastra uno o varios archivos JSON descargados por los alumnos.'
          : 'Ningún alumno coincide con el filtro de búsqueda actual.';
      return;
    }

    emptyMsg.classList.add('hidden');
    tableWrap.classList.remove('hidden');
    tbody.innerHTML = '';

    visibleRecords.forEach((record) => {
      const tr = document.createElement('tr');

      const cells = [
        record.student.nombre,
        record.student.apellidos,
        record.student.grupo,
        `${record.timing.dateFormatted} ${record.timing.endTimeFormatted}`,
        String(record.summary.correct),
        String(record.summary.incorrect),
        String(record.summary.unanswered)
      ];

      cells.forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });

      const scoreTd = document.createElement('td');
      const scoreBadge = document.createElement('strong');
      scoreBadge.textContent = `${record.summary.scoreFormatted} / 10`;
      scoreBadge.style.color = record.summary.score >= 5 ? 'var(--success)' : 'var(--danger)';
      scoreTd.appendChild(scoreBadge);
      tr.appendChild(scoreTd);

      const actionsTd = document.createElement('td');
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'table-actions';

      const btnDetail = document.createElement('button');
      btnDetail.type = 'button';
      btnDetail.className = 'btn btn-secondary btn-sm';
      btnDetail.textContent = 'Ver detalle';
      btnDetail.addEventListener('click', () => this.openDetailModal(record));

      const btnPdf = document.createElement('button');
      btnPdf.type = 'button';
      btnPdf.className = 'btn btn-secondary btn-sm';
      btnPdf.textContent = 'PDF';
      btnPdf.title = 'Descargar informe PDF de este alumno';
      btnPdf.addEventListener('click', () => downloadResultPDF(record));

      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'btn btn-ghost btn-sm';
      btnDelete.style.color = 'var(--danger)';
      btnDelete.textContent = 'Eliminar';
      btnDelete.addEventListener('click', () => {
        if (
          window.confirm(
            `¿Eliminar el resultado de ${record.student.nombre} ${record.student.apellidos}?`
          )
        ) {
          this.records = this.records.filter((r) => r.attemptId !== record.attemptId);
          saveTeacherResults(this.records);
          this.render();
        }
      });

      actionsWrap.append(btnDetail, btnPdf, btnDelete);
      actionsTd.appendChild(actionsWrap);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    });
  }

  /**
   * Muestra el modal con el desglose completo de las 50 preguntas de un alumno importado.
   * @param {object} record
   */
  openDetailModal(record) {
    const modal = document.getElementById('modal-teacher-detail');
    const title = document.getElementById('teacher-detail-title');
    const body = document.getElementById('teacher-detail-body');
    const btnPdf = document.getElementById('btn-teacher-detail-pdf');

    if (!modal || !title || !body) return;

    title.textContent = `${record.student.nombre} ${record.student.apellidos} — Grupo ${record.student.grupo}`;

    body.innerHTML = '';

    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'alert alert-info';
    summaryDiv.innerHTML =
      `<strong>Nota final: ${record.summary.scoreFormatted} / 10</strong> · ` +
      `Aciertos: ${record.summary.correct} · Errores: ${record.summary.incorrect} · ` +
      `Sin contestar: ${record.summary.unanswered}<br>` +
      `Fecha: ${record.timing.dateFormatted} · Inicio: ${record.timing.startTimeFormatted} · ` +
      `Fin: ${record.timing.endTimeFormatted} · Tiempo: ${record.timing.elapsedFormatted}`;
    body.appendChild(summaryDiv);

    const list = document.createElement('div');
    list.className = 'review-list';

    record.questions.forEach((q) => {
      const item = document.createElement('article');
      item.className = `review-item ${q.status}`;

      const header = document.createElement('div');
      header.className = 'review-item-header';

      const qNum = document.createElement('span');
      qNum.className = 'review-q-num';
      qNum.textContent = `Pregunta ${q.id}`;

      const badge = document.createElement('span');
      badge.className = `status-badge ${q.status}`;
      badge.textContent =
        q.status === 'correct'
          ? 'Correcta'
          : q.status === 'incorrect'
            ? 'Incorrecta'
            : 'Sin contestar';

      header.append(qNum, badge);

      const qText = document.createElement('p');
      qText.className = 'review-q-text';
      qText.textContent = q.question;

      const optsDiv = document.createElement('div');
      optsDiv.className = 'review-options';

      q.options.forEach((opt) => {
        const optRow = document.createElement('div');
        optRow.className = 'review-option';
        if (opt.id === q.correctOptionId) {
          optRow.classList.add('is-correct');
        } else if (opt.id === q.selectedOptionId) {
          optRow.classList.add('is-selected-wrong');
        }

        const textSpan = document.createElement('span');
        textSpan.textContent = `${opt.id}) ${opt.text}`;

        const tagsWrap = document.createElement('div');
        tagsWrap.className = 'review-option-tags';

        if (opt.id === q.correctOptionId) {
          const t = document.createElement('span');
          t.className = 'mini-tag correct-tag';
          t.textContent = 'Correcta';
          tagsWrap.appendChild(t);
        }
        if (opt.id === q.selectedOptionId) {
          const t = document.createElement('span');
          t.className =
            opt.id === q.correctOptionId ? 'mini-tag selected-tag' : 'mini-tag wrong-tag';
          t.textContent = 'Seleccionada';
          tagsWrap.appendChild(t);
        }

        optRow.append(textSpan, tagsWrap);
        optsDiv.appendChild(optRow);
      });

      item.append(header, qText, optsDiv);
      list.appendChild(item);
    });

    body.appendChild(list);

    if (btnPdf) {
      btnPdf.onclick = () => downloadResultPDF(record);
    }

    modal.classList.remove('hidden');
  }

  exportCSV() {
    if (this.records.length === 0) return;
    const csv = buildTeacherCSV(this.getFilteredAndSortedRecords());
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `Resultados_Examenes_${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}


  // --- js/app.js ---
/**
 * app.js
 * Controlador principal de la aplicación web de exámenes tipo test (Versión 1.01).
 * Coordina la identificación del alumno, instrucciones, ejecución del examen,
 * recuperación tras cierre/recarga, resultados, PDF/JSON y Panel del profesor autenticado.
 */






const APP_VERSION = '1.01';
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

})();
