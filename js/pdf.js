/**
 * pdf.js
 * Generador autónomo de documentos PDF 1.4 multipágina en el navegador (sin dependencias externas ni CDNs).
 * Produce un archivo PDF formal, limpio y listo para imprimir con:
 * - Cabecera institucional y datos completos del alumno y tiempos exactos.
 * - Resumen de calificación destacada.
 * - Revisión completa de las 50 preguntas en su orden original (1..50, A..D),
 *   garantizando que ninguna pregunta quede partida entre dos páginas.
 */

import { buildResultFilename } from './results.js';

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
    .replace(/?
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
export function buildResultPdfBytes(result) {
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
export function downloadResultPDF(result) {
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
