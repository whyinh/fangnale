function makeWav(seconds = 1) {
  const rate = 16000, n = rate * seconds, dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataSize, 40);
  return buf;
}
const b64 = makeWav(1).toString("base64");
const res = await fetch("https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Api-Key": "6ca4391d-c940-4a1c-9d78-b613be69d332",
    "X-Api-Resource-Id": "volc.bigasr.auc_turbo",
    "X-Api-Request-Id": crypto.randomUUID(),
    "X-Api-Sequence": "-1",
  },
  body: JSON.stringify({ user: { uid: "smoke" }, audio: { data: b64, format: "wav", rate: 16000, channel: 1, bits: 16 }, request: { model_name: "bigmodel" } }),
});
console.log("ASR status:", res.status);
console.log((await res.text()).slice(0, 400));
