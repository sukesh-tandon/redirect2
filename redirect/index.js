	const sql = require("mssql");
const { v4: uuidv4 } = require("uuid");
const cfg = require("../shared/config");

function getDeviceOS(ua) {
  const u = (ua || "").toLowerCase();
  if (u.includes("android")) return "Android";
  if (u.includes("iphone") || u.includes("ipad") || u.includes("ios")) return "iOS";
  if (u.includes("windows")) return "Windows";
  if (u.includes("mac os") || u.includes("macintosh")) return "macOS";
  if (u.includes("linux")) return "Linux";
  return "Unknown";
}

function getCrawlerName(ua) {
  const u = (ua || "").toLowerCase();
  const map = cfg.BOT_MAP || {};
  for (const key in map) {
    if (u.includes(key)) return map[key];
  }
  return null;
}

let poolPromise = null;
async function getPool() {
  if (poolPromise) return poolPromise;
  const connString = cfg.getConnString && cfg.getConnString();
  if (!connString) throw new Error("Missing DB connection string");
  poolPromise = (async () => {
    const pool = await sql.connect(connString);
    pool.on("error", (err) => {
      console.error("MSSQL pool error:", err && err.message);
      poolPromise = null;
    });
    return pool;
  })();
  return poolPromise;
}

module.exports = async function (context, req) {
  const token = context.bindingData && context.bindingData.token;
  const ua = req.headers["user-agent"] || "";
  const referrer = req.headers["referer"] || req.headers["referrer"] || null;
  const ip = req.headers["x-forwarded-for"] || req.headers["x-client-ip"] || req.headers["x-arr-clientip"] || "unknown";
  const deviceOS = getDeviceOS(ua);
  const crawlerName = getCrawlerName(ua);

  context.log(`🔹 Incoming token: ${token}`);
  context.log(`🔹 User-Agent: ${ua}`);

  if (!token) {
    context.res = { status: 400, body: "Missing token" };
    return;
  }

  try {
    const pool = await getPool();
    const request = pool.request();
    request.input("token", sql.VarChar(50), token);
    const result = await request.query(
      `SELECT destination_url FROM ${cfg.REDIRECT_TABLE} WHERE token = @token`
    );

    if (!result.recordset.length) {
      context.res = { status: 404, body: "Invalid token" };
      return;
    }

    const destination = result.recordset[0].destination_url;
    context.res = {
      status: 302,
      headers: { Location: destination },
    };
  } catch (err) {
    context.log.error("Redirect error:", err.message);
    context.res = { status: 500, body: "Internal error" };
  }
};
