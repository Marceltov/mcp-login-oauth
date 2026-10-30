// Diagrams in the site's palette. Material styles Mermaid through its own theme CSS and the --md-mermaid-* variables
// (set in stylesheets/extra.css), but some of its selectors predate Mermaid 11: arrowheads are now "<id>-arrowhead"
// markers, and lifelines carry a theme colour that wins over Material's rule. This adds the missing rules, with the same
// variables, before Material initialises Mermaid. Mermaid itself is pinned in mkdocs.yml, so a new release can't break it.
(() => {
  if (typeof mermaid === "undefined") return;
  const rules = `
    .actor-line { stroke: var(--md-mermaid-sequence-actor-line-color) !important; }
    marker[id$="arrowhead"] path { fill: var(--md-mermaid-sequence-message-line-color) !important; stroke: none !important; }
    marker[id$="crosshead"] path { stroke: var(--md-mermaid-sequence-message-line-color) !important; }
    .cluster rect { fill: var(--md-default-bg-color) !important; stroke: var(--md-mermaid-edge-color) !important; stroke-dasharray: 4 3; }
    .edgeLabel, .edgeLabel p { color: var(--md-mermaid-label-fg-color); }
  `;
  const initialize = mermaid.initialize.bind(mermaid);
  mermaid.initialize = (config = {}) => initialize({ ...config, themeCSS: (config.themeCSS ?? "") + rules });
})();
