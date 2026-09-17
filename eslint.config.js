const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  { files: ['test/**/*.js'], languageOptions: { globals: { structuredClone: 'readonly', Buffer: 'readonly', __dirname: 'readonly' } } },
  {
    files: ['src/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        SpreadsheetApp: 'readonly', ScriptApp: 'readonly', LockService: 'readonly',
        Utilities: 'readonly', console: 'readonly', PayrollCore: 'readonly',
        PAYROLL_CONFIG: 'readonly', readPayrollWorkbook: 'readonly',
        writePayrollChanges: 'readonly', writePayrollDiagnostics: 'readonly', tableFromSheet: 'readonly', status: 'readonly',
        displayStatus: 'readonly', ensurePaymentCheckbox: 'readonly',
        Sheets: 'readonly', HtmlService: 'readonly', PropertiesService: 'readonly',
        PayrollOwnerCore: 'readonly', getPayrollSpreadsheet_: 'readonly', withPayrollLock: 'readonly'
      }
    },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^(PAYROLL_CONFIG|dailySync|handlePaymentEdit|setup|readPayrollWorkbook|writePayrollChanges|writePayrollDiagnostics|ensurePaymentCheckbox|ensureSingleTrigger)$' }] }
  }
];
