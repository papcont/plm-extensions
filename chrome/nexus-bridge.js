/**
 * Nexus Browser Bridge — PLM UX Extensions
 *
 * Injected by the Chrome extension into every autodeskplm360.net page.
 * When running inside the Nexus engineering browser, delegates AI tasks
 * to window.nexus.ai (local: Gemini Nano → WebLLM → cloud fallback).
 *
 * Outside Nexus, falls back to the PLM UX Extensions server proxy at
 * /services/nexus/analyze, which routes to the configured AI provider.
 */

(function () {
  'use strict';

  /** True when running inside the Nexus engineering browser */
  function isNexusBrowser() {
    return typeof window !== 'undefined' && !!window.nexus;
  }

  /**
   * Analyse a Fusion Manage PLM item using local AI.
   *
   * context:
   *   'plm-fast'    — quick field suggestion / classification (Gemini Nano)
   *   'plm-analysis'— deep BOM reasoning / fault diagnosis (WebLLM Phi-3.5)
   *   'vision'      — image attachment, requires cloud
   *
   * @param {string} prompt
   * @param {'plm-fast'|'plm-analysis'|'vision'|'general'} [context]
   * @param {string} [imageBase64]
   * @returns {Promise<{text: string, provider: string, latencyMs: number}>}
   */
  async function analyzePLMItem(prompt, context = 'plm-analysis', imageBase64) {
    if (isNexusBrowser()) {
      const response = await window.nexus.ai.generate({
        prompt,
        context,
        ...(imageBase64 ? { image: imageBase64 } : {}),
      });
      return {
        text: response.text,
        provider: mapProvider(response.provider),
        latencyMs: response.latencyMs,
      };
    }

    // Fallback — PLM UX Extensions server proxy
    const res = await fetch(window.__plmExtServerUrl + '/services/nexus/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, context }),
    });
    if (!res.ok) throw new Error('Nexus analyze failed: ' + res.status);
    const data = await res.json();
    return { text: data.result, provider: 'cloud', latencyMs: 0 };
  }

  /**
   * Streaming variant — returns a ReadableStream of token strings.
   * Returns null outside Nexus.
   *
   * @param {string} prompt
   * @param {'plm-fast'|'plm-analysis'|'general'} [context]
   * @returns {ReadableStream<string>|null}
   */
  function streamAnalysis(prompt, context = 'plm-analysis') {
    if (!isNexusBrowser()) return null;
    return window.nexus.ai.stream({ prompt, context });
  }

  /**
   * Get a 384-dim embedding for semantic PLM item search.
   * Requires Nexus browser (Transformers.js all-MiniLM-L6-v2).
   *
   * @param {string} text
   * @returns {Promise<Float32Array>}
   */
  async function getEmbedding(text) {
    if (!isNexusBrowser()) {
      throw new Error('Embeddings require Nexus browser (Transformers.js)');
    }
    const response = await window.nexus.ai.embed(text);
    return new Float32Array(JSON.parse(response.text));
  }

  /**
   * Open the Fusion Manage PLM panel in the Nexus sidebar.
   * No-op when running outside Nexus.
   *
   * @param {string} [workspaceId]
   */
  function openNexusPLMPanel(workspaceId) {
    if (isNexusBrowser() && window.nexus.plm) {
      window.nexus.plm.openPanel(workspaceId);
    }
  }

  /** @param {string} p */
  function mapProvider(p) {
    if (p === 'built-in') return 'local-builtin';
    if (p === 'webllm') return 'local-webllm';
    if (p === 'transformers') return 'local-wasm';
    return 'cloud';
  }

  // Expose on window so content.js and page scripts can call it
  window.__nexusBridge = {
    isNexusBrowser,
    analyzePLMItem,
    streamAnalysis,
    getEmbedding,
    openNexusPLMPanel,
  };

  // Signal that the bridge is ready
  window.dispatchEvent(new CustomEvent('nexusBridge:ready'));
})();
