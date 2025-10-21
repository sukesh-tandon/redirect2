// shared/config.js
// Central config (env-driven). Returns full connection string (no parsing required).
// Supports BOT_MAP as JSON or CSV "key:Value,key2:Value2".

function parseBotMap(raw) {
  if (!raw) {
    // sensible defaults
    raw = [
      "whatsapp:WhatsApp",
      "facebook:Facebook",
      "facebookexternalhit:Facebook",
      "twitter:Twitter",
      "twitterbot:Twitter",
      "linkedin:LinkedIn",
      "linkedinbot:LinkedIn",
      "applebot:Apple",
      "googlebot:Google",
      "bingbot:Bing",
      "telegram:Telegram",
      "preview:Generic Preview",
      "crawler:Generic Crawler",
      "spider:Generic Spider",
      "bot:Generic Bot"
    ].join(",");
  }

  // try JSON first
  try {
    const maybe = JSON.parse(raw);
    if (typeof maybe === "object" && maybe !== null) {
      const out = {};
      Object.keys(maybe).forEach(k => { out[String(k).toLowerCase()] = String(maybe[k]); });
      return out;
    }
  } catch (e) {
    // not JSON, fallthrough to CSV
  }

  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const [k, v] = pair.split(":").map(x => x && x.trim());
      if (k && v) acc[k.toLowerCase()] = v;
      return acc;
    }, {});
}

module.exports = {
  // Primary: DB_CONN_STRING (recommended). Fallbacks for other common App Setting names.
  getConnString: () => {
    const v =
      process.env.DB_CONN_STRING ||
      process.env.DB_CONNECTION_STRING ||
      process.env.SQLAZURECONNSTR_SqlConnectionString ||
      process.env.SQLCONNSTR_SqlConnectionString ||
      process.env.CUSTOMCONNSTR_SqlConnectionString ||
      process.env.APPSETTING_SqlConnectionString ||
      process.env.SqlConnectionString ||
      process.env.SqlConnectionString__Value || // extra fallback
      "";

    const s = (v || "").toString().trim();
    if (!s) {
      // do not throw here — caller will handle; but surface a clear console message for diagnostics
      try { console.warn("shared/config: DB connection string not found in env (DB_CONN_STRING)."); } catch(e){}
    }
    return s;
  },

  // Table names (override with App Settings if you need)
  REDIRECT_TABLE: process.env.REDIRECT_TABLE || "redirects",
  CLICK_TABLE: process.env.CLICK_TABLE || "link_clicks",
  BOT_AUDIT_TABLE: process.env.BOT_AUDIT_TABLE || "bot_audit",

  // Delay in ms for human clicks (optional)
  HUMAN_DELAY_MS: Number(process.env.REDIRECT_DELAY_MS || process.env.HUMAN_DELAY_MS || "0") || 0,

  // BOT map: supports JSON (object) or CSV "key:Value,..."
  BOT_MAP: parseBotMap(process.env.BOT_MAP)
};
