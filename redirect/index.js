const sql = require("mssql");
const { v4: uuidv4 } = require("uuid");
const cfg = require("../shared/config");

// --- get OS from UA (kept from your original) ---
function getDeviceOS(ua) {
  const u = (ua || "").toLowerCase();
  if (u.includes("android")) return "Android";
  if (u.includes("iphone") || u.includes("ipad") || u.includes("ios")) return "iOS";
  if (u.includes("windows")) return "Windows";
  if (u.includes("mac os") || u.includes("macintosh")) return "macOS";
  if (u.includes("linux")) return "Linux";
  return "Unknown";
}

// --- SQL pool ---
let poolPromise = null;
async function getPool() {
  if (poolPromise) return poolPromise;
  const connString = cfg.getConnString && cfg.getConnString();
  poolPromise = (async () => {
    const pool = await sql.connect(connString);
    pool.on("error", err => {
      console.error("MSSQL pool error:", err.message);
      poolPromise = null;
    });
    return pool;
  })();
  return poolPromise;
}

// --- MAIN FUNCTION ---
module.exports = async function (context, req) {
  const token = context.bindingData && context.bindingData.token;
  const ua = req.headers["user-agent"] || "";
  const ip =
    (req.headers["x-forwarded-for"] ||
      req.headers["x-client-ip"] ||
      req.headers["x-arr-clientip"] ||
      "unknown")
      .split(",")[0]
      .trim();

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

    // --- Log the click (simple insert) ---
    const logReq = pool.request();
    logReq.input("click_id", sql.VarChar(50), uuidv4());
    logReq.input("tracked_date", sql.DateTimeOffset, new Date());
    logReq.input("link_id", sql.VarChar(100), token);
    logReq.input("device", sql.VarChar(500), ua.substring(0, 500));
    logReq.input("os", sql.VarChar(50), getDeviceOS(ua));
    logReq.input("ipaddress", sql.VarChar(50), ip);
    logReq.input("click_count", sql.Int, 1);
    logReq.input("load_ts", sql.DateTimeOffset, new Date());

    await logReq.query(`
      INSERT INTO dbo.Stg_SMS_Click
      (click_id, tracked_date, link_id, device, os, ipaddress, click_count, load_ts)
      VALUES
      (@click_id, @tracked_date, @link_id, @device, @os, @ipaddress, @click_count, @load_ts)
    `);

    // --- Redirect ---
    context.res = {
      status: 302,
      headers: { Location: destination },
    };
  } catch (err) {
    context.log.error("Redirect error:", err.message);
    context.res = { status: 500, body: "Internal error" };
  }
};
