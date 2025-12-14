import express from "express";
import multer from "multer";
import cors from "cors";
import sharp from "sharp";
import * as ort from "onnxruntime-node";

const app = express();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());

let session: ort.InferenceSession;

/* ===========================
   Carregar modelo UMA vez
=========================== */
async function loadModel() {
  console.log("Carregando modelo RMBG...");
  session = await ort.InferenceSession.create(
    "./rmbg/rmbg-2.0.onnx",
    { executionProviders: ["cpu"] }
  );
  console.log("Modelo RMBG carregado");
}

await loadModel();

/* ===========================
   Health check
=========================== */
app.get("/health", (_, res) => {
  res.send("ok");
});

/* ===========================
   Remoção de fundo
=========================== */
app.post("/remove-bg", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("Imagem não enviada");
    }

    const MAX_SIZE = 1024;

    const { data, info } = await sharp(req.file.buffer)
      .resize(MAX_SIZE, MAX_SIZE, { fit: "contain" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const floatData = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      floatData[i] = data[i] / 255;
    }

    const inputTensor = new ort.Tensor(
      "float32",
      floatData,
      [1, info.height, info.width, 3]
    );

    const output = await session.run({ input: inputTensor });
    const mask = output.output.data as Float32Array;

    const alpha = Buffer.alloc(mask.length);
    for (let i = 0; i < mask.length; i++) {
      alpha[i] = Math.round(mask[i] * 255);
    }

    const result = await sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 3
      }
    })
      .joinChannel(alpha)
      .png()
      .toBuffer();

    res.set("Content-Type", "image/png");
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao remover fundo");
  }
});

/* ===========================
   Start server (Render-safe)
=========================== */
const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`RMBG backend rodando na porta ${port}`);
});
