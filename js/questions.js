/**
 * questions.js
 * Carga, validación estricta del banco de 50 preguntas y aleatorización
 * independiente de preguntas y opciones manteniendo la trazabilidad de identificadores.
 * Versión 1.01
 */

export const EXPECTED_QUESTION_COUNT = 50;
export const DISPLAY_LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Carga el banco de preguntas desde ./data/questions.json y lo valida.
 * Si se ejecuta directamente desde archivo local (file://) donde el navegador bloquea fetch(),
 * utiliza automáticamente el respaldo sincronizado window.__FALLBACK_QUESTIONS__.
 * @param {string} url
 * @returns {Promise<Array<object>>}
 */
export async function loadQuestionBank(url = './data/questions.json') {
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
export function validateQuestionBank(data) {
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
export function shuffleArray(items) {
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
export function createShuffledExamPlan(questionBank) {
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
