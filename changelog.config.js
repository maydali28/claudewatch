/** @type {import('conventional-changelog-config-spec').Config} */
module.exports = {
  types: [
    { type: 'feat',     section: '✨ New Features' },
    { type: 'fix',      section: '🐛 Bug Fixes' },
    { type: 'perf',     section: '🚀 Performance Improvements' },
    { type: 'revert',   section: '⏪ Reverts' },
    { type: 'refactor', section: '♻️ Refactoring', hidden: false },
    { type: 'docs',     section: '📚 Documentation', hidden: false },
    { type: 'test',     hidden: true },
    { type: 'style',    hidden: true },
    { type: 'chore',    hidden: true },
    { type: 'ci',       hidden: true },
  ],
  issueUrlFormat: 'https://github.com/maydali28/claudewatch/issues/{{id}}',
  compareUrlFormat: 'https://github.com/maydali28/claudewatch/compare/{{previousTag}}...{{currentTag}}',
  userUrlFormat: 'https://github.com/{{user}}',
  commitPartial: '* {{header}}\n',
}
