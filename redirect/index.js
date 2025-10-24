// ------------------- Imports -------------------
const sql = require("mssql");
const { v4: uuidv4 } = require("uuid");
const geoip = require("geoip-lite"); // new addition for IP-based geolocation
const cfg = require("../shared/config");

// ------------------- Utilities -------------------
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

// ------------------- SQL Connection Pool -------------------
let poolPromise = null;
async function getPool() {
  if (poolPromise) return poolPromise;
  const connString = cfg.getConnString && cfg.getConnString();
  if (!connString) throw new Error("Missing DB connection string");

  poolPromise = (async () => {
    const pool = await sql.connect(connString);
    pool.on("error", (err) => {
      console.error("MSSQL pool error:", err.message);
      poolPromise = null;
    });
    return pool;
  })();

  return poolPromise;
}

// ------------------- MAIN FUNCTION -------------------
module.exports = async function (context, req) {
  const token = context.bindingData && context.bindingData.token;
  const ua = req.headers["user-agent"] || "";
  const referrer = req.headers["referer"] || req.headers["referrer"] || null;
  const ipRaw =
    req.headers["x-forwarded-for"] ||
    req.headers["x-client-ip"] ||
    req.headers["x-arr-clientip"] ||
    "";
  const ip = ipRaw.split(",")[0].trim() || "unknown";

  const deviceOS = getDeviceOS(ua);
  const crawlerName = getCrawlerName(ua);
  const method = (req.method || "").toUpperCase();
  const clickId = uuidv4();
  const trackedDate = new Date();

  context.log(`🔹 Token: ${token}`);
  context.log(`🔹 Method: ${method} | UA: ${ua}`);

  if (!token) {
    context.res = { status: 400, body: "Missing token" };
    return;
  }

  try {
    const pool = await getPool();

    // Lookup destination URL from redirect table
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

    // ------------------- Geo Lookup -------------------
    const geo = geoip.lookup(ip);
    const country = geo ? geo.country : null;
    const state = geo && geo.region ? geo.region : null;
    const city = geo && geo.city ? geo.city : null;

    // ------------------- Async DB Logging -------------------
    const logPromise = (async () => {
      try {
        const logReq = pool.request();
        logReq.input("click_id", sql.VarChar(50), clickId);
        logReq.input("tracked_date", sql.DateTimeOffset, trackedDate);
        logReq.input("campaign_id", sql.VarChar(50), null);
        logReq.input("execution_id", sql.VarChar(50), null);
        logReq.input("recipient", sql.VarChar(50), null);
        logReq.input("device", sql.VarChar(500), ua.substring(0, 500));
        logReq.input("os", sql.VarChar(50), deviceOS);
        logReq.input("link_id", sql.VarChar(100), token);
        logReq.input("country", sql.VarChar(50), country);
        logReq.input("state", sql.VarChar(50), state);
        logReq.input("city", sql.VarChar(50), city);
        logReq.input("ipaddress", sql.VarChar(50), ip);
        logReq.input("click_count", sql.Int, 1);
        logReq.input("load_ts", sql.DateTimeOffset, new Date());
        logReq.input("referrer", sql.VarChar(500), referrer);

        await logReq.query(`
          INSERT INTO dbo.Stg_SMS_Click
          (click_id, tracked_date, campaign_id, execution_id, recipient,
           device, os, link_id, country, state, city, ipaddress, click_count, load_ts, referrer)
          VALUES
          (@click_id, @tracked_date, @campaign_id, @execution_id, @recipient,
           @device, @os, @link_id, @country, @state, @city, @ipaddress, @click_count, @load_ts, @referrer)
        `);

        context.log(`✅ Logged click for token: ${token} | IP: ${ip} | ${country}-${state}-${city}`);
      } catch (logErr) {
        context.log.error("❌ Logging error:", logErr.message);
      }
    })();

    // ------------------- Bot / HEAD Handling -------------------
    if (method === "HEAD" || crawlerName) {
      context.log(`🤖 Bot or preview detected: ${crawlerName || "HEAD request"}`);
      context.res = { status: 204 };
      return;
    }

    // ------------------- Redirect (main response) -------------------
    context.res = {
      status: 302,
      headers: { Location: destination },
    };

    // Ensure DB log starts before function teardown
    await Promise.allSettled([logPromise]);
  } catch (err) {
    context.log.error("Redirect error:", err.message);
    context.res = { status: 500, body: "Internal error" };
  }
};
