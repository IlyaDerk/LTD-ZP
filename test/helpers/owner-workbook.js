const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const fixture = require('../sheet-fixture.json');

module.exports = function workbook() {
  let data = structuredClone(fixture), sequence = 0, locked = false, failBatch = false;
  const calls = [], documentProperties = {}, userProperties = {};
  const meta = {}, hidden = {};
  data['Интерфейс собственника'] = [];
  Object.keys(data).forEach((name, i) => { meta[name] = { id: i + 1, rows: Math.max(data[name].length, 1000) }; hidden[name] = {}; });
  const cells = name => data[name];
  function readValue(cell = {}) {
    const v = cell.effective || cell.value || {};
    if (typeof v.numberValue === 'number' && cell.format?.numberFormat?.type === 'DATE') return new Date(Date.UTC(1899, 11, 30) + v.numberValue * 86400000 - 3 * 3600000);
    return v.stringValue ?? v.numberValue ?? v.boolValue ?? '';
  }
  function value(name, row, col, v) {
    const cell = ((data[name][row - 1] ||= [])[col - 1] ||= {});
    cell.value = { [typeof v === 'number' ? 'numberValue' : typeof v === 'boolean' ? 'boolValue' : 'stringValue']: v };
    cell.effective = cell.value;
  }
  function range(name, row, col, numRows = 1, numCols = 1) {
    const r = {
      setValue(v) { value(name, row, col, v); return r; },
      setValues(values) { values.forEach((line, ri) => line.forEach((v, ci) => value(name, row + ri, col + ci, v))); return r; },
      getNote() { return data[name][row - 1]?.[col - 1]?.note || ''; },
      getDataValidation() { return data[name][row - 1]?.[col - 1]?.validation || null; },
      setNote(note) { const cell = ((data[name][row - 1] ||= [])[col - 1] ||= {}); cell.note = note; return r; },
      insertCheckboxes() {
        for (let ri = 0; ri < numRows; ri += 1) for (let ci = 0; ci < numCols; ci += 1) {
          const cell = ((data[name][row - 1 + ri] ||= [])[col - 1 + ci] ||= {}); cell.validation = { condition: { type: 'BOOLEAN' } };
        }
        return r;
      }
    };
    ['setBackground', 'setFontWeight', 'setWrap', 'setFontSize', 'setNumberFormat'].forEach(k => { r[k] = () => r; });
    return r;
  }
  function sheet(name) {
    if (!data[name]) return null;
    return {
      getName: () => name, getSheetId: () => meta[name].id, getParent: () => ss, getMaxRows: () => meta[name].rows,
      getLastRow: () => data[name].reduce((last, r, i) => r.some(c => c?.value && Object.keys(c.value).length && readValue(c) !== '') ? i + 1 : last, 0),
      getDataRange: () => ({
        getValues: () => { const width = Math.max(10, ...Array.from(data[name], r => r?.length || 0)); return Array.from({ length: Math.max(1, data[name].length) }, (_, ri) => Array.from({ length: width }, (_, i) => readValue(data[name][ri]?.[i]))); },
        getFormulas: () => { const width = Math.max(10, ...Array.from(data[name], r => r?.length || 0)); return Array.from({ length: Math.max(1, data[name].length) }, (_, ri) => Array.from({ length: width }, (_, i) => data[name][ri]?.[i]?.value?.formulaValue || '')); },
        getNotes: () => { const width = Math.max(10, ...Array.from(data[name], r => r?.length || 0)); return Array.from({ length: Math.max(1, data[name].length) }, (_, ri) => Array.from({ length: width }, (_, i) => data[name][ri]?.[i]?.note || '')); }
      }),
      getRange: (r, c, nr, nc) => range(name, r, c, nr, nc),
      deleteRow: row => { data[name].splice(row - 1, 1); },
      setColumnWidths() {}, setColumnWidth() {}, setFrozenRows() {}, hideColumns() {},
      isRowHiddenByUser: row => !!hidden[name][row]
    };
  }
  const ss = { getId: () => '1ckKRYXnMY8WORciktpZvTI4BQjvmZv1o05guagqiK90', getSpreadsheetTimeZone: () => 'Europe/Moscow', getSheetByName: sheet, setActiveSheet() {} };
  function props(map) { return { getProperty: k => map[k] || null, setProperty: (k, v) => { map[k] = v; }, deleteProperty: k => { delete map[k]; } }; }
  const context = vm.createContext({
    Date, console: { info() {}, warn() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (locked) throw Error('Nested lock'); locked = true; return true; }, releaseLock: () => { locked = false; } }) },
    PropertiesService: { getDocumentProperties: () => props(documentProperties), getUserProperties: () => props(userProperties) },
    Utilities: {
      getUuid: () => 'UUID-' + ++sequence, DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, text) => crypto.createHash(algorithm).update(text).digest(), base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'),
      formatDate(date, timeZone, pattern) {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
        const keys = pattern === 'dd.MM.yyyy' ? ['day', 'month', 'year'] : ['year', 'month', 'day'];
        return keys.map(k => parts.find(p => p.type === k).value).join(pattern === 'dd.MM.yyyy' ? '.' : '-');
      }
    },
    Sheets: { Spreadsheets: { batchUpdate(body, id) {
      if (!locked) throw Error('Write outside shared ScriptLock');
      if (id !== ss.getId()) throw Error('Wrong target');
      if (failBatch) { failBatch = false; throw Error('Atomic API failure'); }
      const old = data;
      data = structuredClone(data);
      try {
        for (const request of body.requests) {
          const update = request.updateCells;
          if (update) {
            if (update.fields !== 'userEnteredValue') throw Error('Unexpected source field mask');
            const name = Object.keys(meta).find(n => meta[n].id === update.range.sheetId);
            if (!name) throw Error('Unknown sheet');
            update.rows.forEach((r, ri) => r.values.forEach((c, ci) => {
              const row = update.range.startRowIndex + ri, col = update.range.startColumnIndex + ci;
              const cell = ((data[name][row] ||= [])[col] ||= {});
              cell.value = structuredClone(c.userEnteredValue || {}); cell.effective = cell.value;
            }));
          } else if (request.setDataValidation) {
            const d = request.setDataValidation, name = Object.keys(meta).find(n => meta[n].id === d.range.sheetId);
            data[name][d.range.startRowIndex][d.range.startColumnIndex].validation = structuredClone(d.rule);
          } else if (request.updateDimensionProperties) {
            const d = request.updateDimensionProperties, name = Object.keys(meta).find(n => meta[n].id === d.range.sheetId);
            hidden[name][d.range.startIndex + 1] = d.properties.hiddenByUser;
          } else if (request.appendDimension) {
            const d = request.appendDimension, name = Object.keys(meta).find(n => meta[n].id === d.sheetId); meta[name].rows += d.length;
          } else if (request.deleteDimension) {
            const d = request.deleteDimension.range, name = Object.keys(meta).find(n => meta[n].id === d.sheetId);
            data[name].splice(d.startIndex, d.endIndex - d.startIndex); meta[name].rows -= d.endIndex - d.startIndex;
          }
        }
      } catch (error) { data = old; throw error; }
      calls.push(structuredClone(body.requests));
    } } }
  });
  for (const file of ['Config.js', 'Core.js', 'Sheets.js', 'Main.js', 'OwnerCore.js', 'Owner.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'), context, { filename: file });
  function select(id, checked = true) {
    const index = data['Интерфейс собственника'].findIndex(r => readValue(r?.[0]) === id);
    if (index < 0) throw Error('No view ID ' + id);
    value('Интерфейс собственника', index + 1, 8, checked);
    context.onEdit({ range: { getSheet: () => sheet('Интерфейс собственника') } });
  }
  return { api: context, data: () => data, cells, value, readValue, calls, select, ss, sheet, meta, hidden, documentProperties, userProperties, failNextBatch: () => { failBatch = true; } };
};
