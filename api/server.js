const { BlobServiceClient } = require("@azure/storage-blob");
const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
const { ApiKeyCredentials } = require('@azure/ms-rest-js');

// Use environment variables for secrets
const subKey = process.env.AZURE_COMPUTER_VISION_KEY;
const endPointUrl = process.env.AZURE_COMPUTER_VISION_ENDPOINT;
const sasUrl = process.env.AZURE_BLOB_SAS_URL;
const imagesUrl = process.env.AZURE_IMAGES_URL;

const computerVisionClient = new ComputerVisionClient(
  new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': subKey } }), endPointUrl
);

const blobServiceClient = new BlobServiceClient(sasUrl);
const containerClient = blobServiceClient.getContainerClient("images");

module.exports = async function (context, req) {
  context.log('JavaScript HTTP trigger function processed a request.');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  
  
  if (req.method !== 'POST' || !req.body.image) {
    context.res = {
      status: 400,
      body: 'No image found in request body.'
    };
    return;
  }

  const imageBuffer = Buffer.from(req.body.image, 'base64'); // assuming base64-encoded image

  try {
    const imageUrl = await uploadImageToStorage(imageBuffer);
    const printedResult = await readTextFromURL(imageUrl);
    const extractedText = printRecognizedText(printedResult);

    await deleteImageFromStorage(imageUrl);

    context.res = {
      status: 200,
      body: extractedText
    };
  } catch (error) {
    context.res = {
      status: 500,
      body: 'Error: ' + error.message
    };
  }
};

async function uploadImageToStorage(image) {
  const blobName = 'image-' + Date.now().toString();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(image);
  return `${imagesUrl}${blobName}`;
}

async function readTextFromURL(imageUrl) {
  let result = await computerVisionClient.read(imageUrl);
  let operation = result.operationLocation.split('/').slice(-1)[0];

  let readOperationResult;
  do {
    await sleep(1000);
    readOperationResult = await computerVisionClient.getReadResult(operation);
  } while (readOperationResult.status !== "succeeded");

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}