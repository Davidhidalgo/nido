export const honchoTools = [
  "honcho_context",
  "honcho_search_conclusions",
  "honcho_search_messages",
  "honcho_session",
  "honcho_ask",
];

export function honchoPlugin(previous) {
  const entry = previous?.plugins?.entries?.["openclaw-honcho"];
  return entry ? structuredClone(entry) : undefined;
}

export function disableDemoHoncho(config) {
  config.plugins.allow = config.plugins.allow.filter((id) => id !== "openclaw-honcho");
  // Explicit disable also covers plugins discovered through inherited install paths.
  config.plugins.entries["openclaw-honcho"] = { enabled: false };
  for (const entry of Object.values(config.agents.entries)) {
    if (entry.tools?.allow)
      entry.tools.allow = entry.tools.allow.filter((name) => !honchoTools.includes(name));
  }
}
