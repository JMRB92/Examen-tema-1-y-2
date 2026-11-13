/**
 * results.js
 * Cálculo exacto de calificaciones, ordenación de resultados según el banco original (1..50, A..D)
 * y exportación del intento en formato JSON.
 */

export const POINTS_CORRECT = 0.20;
export const POINTS_INCORRECT = 0.05;
export const MIN_SCORE = 0;
export const MAX_SCORE = 10;

/**
 * Calcula la nota final utilizando aritmética entera en centésimas para evitar
 * errores de redondeo en coma flotante, acotando entre 0 y 10 con 2 decimales.
 *
 * @param {number} correct
 * @param {number} incorrect
 * @returns {number}
 */
export function calculateScore(correct, incorrect) {
  const rawHundredths = correct * 20 - incorrect * 5;
  const clampedHundredths = Math.max(0, Math.min(1000, rawHundredths));
  return Number((clampedHundredths / 100).toFixed(2));
}

/**
 * Formatea una fecha epoch (ms) en fecha legible DD/MM/YYYY.
 * @param {number} epochMs
 * @returns {string}
 */
export function formatDateES(epochMs) {
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
export function formatDateISO(epochMs) {
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
export function formatTimeES(epochMs) {
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
export function formatElapsedTime(elapsedMs) {
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
export function evaluateExam(examState, questionBank, finishedAt = Date.now(), finishReason = 'manual') {
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
export function sanitizeFilePart(str) {
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
export function buildResultFilename(result, extension) {
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
export function downloadResultJSON(result) {
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
