const { BlobServiceClient } = require('@azure/storage-blob');
const {
  ComputerVisionClient,
} = require('@azure/cognitiveservices-computervision');
const { ApiKeyCredentials } = require('@azure/ms-rest-js');

// --- Configuration ---
const subKey = process.env.AZURE_COMPUTER_VISION_KEY;
const endPointUrl = process.env.AZURE_COMPUTER_VISION_ENDPOINT;
const sasUrl = process.env.AZURE_BLOB_SAS_URL;

const computerVisionClient = new ComputerVisionClient(
  new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': subKey } }),
  endPointUrl
);

const blobServiceClient = new BlobServiceClient(sasUrl);
const containerClient = blobServiceClient.getContainerClient('images');

const ALLOWED_ORIGINS = [
  'https://test.lightningbowl.de',
  'https://lightningbowl.de',
  // 'http://localhost:3000' // Uncomment for local testing
];

// --- Rate Limiting Setup ---
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;
const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const userRequests = rateLimitMap.get(ip) || [];

  // Filter out requests older than the window
  const recentRequests = userRequests.filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW
  );

  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  recentRequests.push(now);
  rateLimitMap.set(ip, recentRequests);

  // If the map gets too big, remove IPs that haven't been active recently
  if (rateLimitMap.size > 1000) {
    for (const [key, timestamps] of rateLimitMap.entries()) {
      const isActive = timestamps.some((t) => now - t < RATE_LIMIT_WINDOW);
      if (!isActive) {
        rateLimitMap.delete(key);
      }
    }
  }
  return true;
}

module.exports = async function (req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).send('Origin not allowed');
    return;
  }

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.connection?.remoteAddress ||
    'unknown';

  if (!checkRateLimit(ip)) {
    res.status(429).send('Too many requests.');
    return;
  }

  if (req.method !== 'POST' || !req.body.image) {
    res.status(400).send('No image found.');
    return;
  }

  const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
  const imageBuffer = Buffer.from(req.body.image, 'base64');

  if (imageBuffer.length > MAX_IMAGE_SIZE_BYTES) {
    res.status(413).send('Image too large.');
    return;
  }

  let blobNameForDeletion = null;

  try {
    const { urlWithSas, blobName } = await uploadImageToStorage(imageBuffer);
    blobNameForDeletion = blobName;

    const printedResult = await readTextFromURL(urlWithSas);

    const extractedText = printRecognizedText(printedResult);

    if (blobNameForDeletion) {
      await deleteImageFromStorage(blobNameForDeletion);
      blobNameForDeletion = null;
    }

    res.status(200).send(extractedText);
  } catch (error) {
    console.error('Pipeline Error:', error);
    res.status(500).send('Error processing image: ' + error.message);
  } finally {
    if (blobNameForDeletion) {
      try {
        await deleteImageFromStorage(blobNameForDeletion);
      } catch (e) {
        console.error('Cleanup error:', e);
      }
    }
  }
};


async function uploadImageToStorage(image) {
  const blobName = 'image-' + Date.now().toString() + '.jpg';
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(image);

  return {
    urlWithSas: blockBlobClient.url,
    blobName: blobName,
  };
}

async function readTextFromURL(imageUrl) {
  let result = await computerVisionClient.read(imageUrl);
  let operation = result.operationLocation.split('/').slice(-1)[0];

  let readOperationResult;
  let attempts = 0;

  do {
    attempts++;
    if (attempts > 30) throw new Error('Timeout waiting for OCR');

    await sleep(1000);
    readOperationResult = await computerVisionClient.getReadResult(operation);
  } while (
    readOperationResult.status !== 'succeeded' &&
    readOperationResult.status !== 'failed'
  );

  if (readOperationResult.status === 'failed') {
    throw new Error('Computer Vision Analysis failed');
  }

  return readOperationResult.analyzeResult.readResults;
}

function printRecognizedText(readResults) {
  let recognizedText = '';
  for (const result of readResults) {
    for (const line of result.lines) {
      recognizedText += line.text + '\n';
    }
  }
  return recognizedText;
}

async function deleteImageFromStorage(blobName) {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.delete();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
