import app from "./app";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SSS Backend running on port ${PORT}`);
  console.log(`  Program ID: ${process.env.PROGRAM_ID || "CmyUqWVb4agcavSybreJ7xb7WoKUyWhpkEc6f1DnMEGJ"}`);
  console.log(`  Stablecoin Mint: ${process.env.STABLECOIN_MINT ?? "not set"}`);
  console.log(`  Auth: ${process.env.API_KEY ? "enabled" : "disabled (set API_KEY to enable)"}`);
});
