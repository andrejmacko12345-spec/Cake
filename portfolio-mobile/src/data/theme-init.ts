try {
  const { applyTheme, readStoredTheme } = require('./theme');
  applyTheme(readStoredTheme());
} catch {
  // pri chybe ostane predvolený tmavý motív
}
