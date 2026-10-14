module.exports = function migrateLegacyPalette(config) {
  if (!config || typeof config !== 'object') return false;
  const changed = config.paletteEnabled !== false;
  config.paletteEnabled = false;
  return changed;
};
