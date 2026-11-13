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
export function isStorageAvailable() {
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
export function generateUUID() {
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
export function saveActiveExam(examState) {
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
export function getActiveExam() {
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
export function clearActiveExam() {
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
export function saveLastResult(result) {
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
export function getLastResult() {
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
export function clearLastResult() {
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
export function getTeacherResults() {
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
export function saveTeacherResults(records) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.TEACHER_RECORDS, JSON.stringify(records));
    return true;
  } catch (err) {
    console.error('Error al guardar los registros del profesor:', err);
    return false;
  }
}
