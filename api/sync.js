const crypto = require("node:crypto");
const { getDb } = require("./_mongo");

function stableKey(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function sendError(response, status, message) {
  response.status(status).json({ ok: false, error: message });
}

module.exports = async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    sendError(response, 405, "Method not allowed.");
    return;
  }

  const vaultId = request.query.vaultId || request.body?.vaultId;
  const vaultSecret = request.headers["x-mthd-vault-secret"] || request.body?.vaultSecret;

  if (!vaultId || !vaultSecret) {
    sendError(response, 400, "vaultId and vault secret are required.");
    return;
  }

  const db = await getDb();
  const collection = db.collection("vault_payloads");
  const key = stableKey(`${vaultId}:${vaultSecret}`);

  if (request.method === "GET") {
    const record = await collection.findOne({ key }, { projection: { _id: 0, key: 0 } });
    response.status(200).json({ ok: true, data: record?.data || null, updatedAt: record?.updatedAt || null });
    return;
  }

  const data = request.body?.data;
  if (!data || typeof data !== "object") {
    sendError(response, 400, "data object is required.");
    return;
  }

  const updatedAt = new Date();
  await collection.updateOne(
    { key },
    {
      $set: {
        data,
        updatedAt,
      },
      $setOnInsert: {
        createdAt: updatedAt,
      },
    },
    { upsert: true },
  );

  response.status(200).json({ ok: true, updatedAt });
};
