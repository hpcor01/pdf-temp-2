import express from 'express';
import cors from 'cors';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

let session: ort.InferenceSession;

// ===== Load model once =====
async function loadModel() {
  const modelPath = path.join(process.cwd(), 'rmbg', 'rmbg.onnx');
  console.log('Loading RMBG model:', modelPath);

  session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });

  console.log('RMBG model loaded');
}

loadModel().catch(err => {
  console.error('Failed to load RMBG model', err);
  process.exit(1);
});

// ===== Health =====
app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

// ===== Remove BG =====
app.post('/remove-bg', async (req, res) => {
  try {
    if (!session) {
      return res.status(503).json({ error: 'Model not ready' });
    }

    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image missing' });
    }

    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    // Resize to keep RAM low
    const MAX_SIZE = 1024;
    const img = sharp(buffer);
    const meta = await img.metadata();

    const scale = Math.min(
      MAX_SIZE / (meta.width || MAX_SIZE),
      MAX_SIZE / (meta.height || MAX_SIZE),
      1
    );

    const width = Math.round((meta.width || MAX_SIZE) * scale);
    const height = Math.round((meta.height || MAX_SIZE) * scale);

    const resized = await img
      .resize(width, height)
      .removeAlpha()
      .raw()
      .toBuffer();

    // Normalize [0,1]
    const input = new Float32Array(width * height * 3);
    for (let i = 0; i < resized.length; i++) {
      input[i] = resized[i] / 255;
    }

    const tensor = new ort.Tensor('float32', input, [1, 3, height, width]);
    const feeds = { input: tensor };

    const results = await session.run(feeds);
    const output = results[Object.keys(results)[0]];

    // Output mask
    const mask = Buffer.alloc(width * height);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = Math.round(output.data[i] * 255);
    }

    // Apply alpha mask
    const png = await sharp(resized, {
      raw: { width, height, channels: 3 },
    })
      .joinChannel(mask)
      .png()
      .toBuffer();

    res.json({
      image: `data:image/png;base64,${png.toString('base64')}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'RMBG failed' });
  }
});

// ===== Start =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RMBG backend running on ${PORT}`);
});
