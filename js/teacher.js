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

import { getTeacherResults, saveTeacherResults } from './storage.js';
import { downloadResultPDF } from './pdf.js';

/**
 * Valida que un archivo JSON importado corresponda a un resultado de examen válido.
 * @param {unknown} data
 * @returns {boolean}
 */
export function isValidStudentResult(data) {
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
export function mergeImportedResults(existingRecords, parsedFiles) {
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
export function buildTeacherCSV(records) {
  const escapeCSV = (val) => {
    const str = String(val ?? '');
    if (str.includes(';') || str.includes('"') || str.includes('
') || str.includes('')) {
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

export class TeacherPanelController {
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
