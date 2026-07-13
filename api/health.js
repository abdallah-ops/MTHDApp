module.exports = async function handler(request, response) {
  response.status(200).json({
    ok: true,
    app: "MTHD",
    mongoConfigured: Boolean(process.env.MONGODB_URI),
  });
};
