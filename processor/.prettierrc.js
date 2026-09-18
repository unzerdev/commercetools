module.exports = {
  arrowParens: 'always',
  bracketSameLine: true,
  bracketSpacing: true,
  printWidth: 120,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'all',
  useTabs: false,
  // 'auto' so the lint gate tolerates the working-tree line endings Windows npm
  // reintroduces into package.json/lock on install; .gitattributes keeps the repo LF.
  endOfLine: 'auto',
};
