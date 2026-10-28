'use strict';

// Vision is configured independently from the text model. Recognition uses the
// active entry of visionProviders; text-only LLMs no longer need a multimodal
// flag. Legacy configs are migrated in config.js.

function visionList(cfg) {
  return Array.isArray(cfg && cfg.visionProviders) ? cfg.visionProviders.filter(Boolean) : [];
}

function activeVisionProvider(cfg) {
  const list = visionList(cfg);
  const id = typeof (cfg && cfg.activeVisionId) === 'string' ? cfg.activeVisionId.trim() : '';
  return list.find((provider) => provider.id === id) || list[0] || null;
}

function visionProviderStatus(cfg) {
  const provider = activeVisionProvider(cfg);
  if (!provider) return null;
  return { baseUrl: provider.baseUrl || '', model: provider.model || '' };
}

module.exports = { activeVisionProvider, visionProviderStatus };