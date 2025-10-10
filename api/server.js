const { BlobServiceClient } = require("@azure/storage-blob");
const {
  ComputerVisionClient,
} = require("@azure/cognitiveservices-computervision");
const { ApiKeyCredentials } = require("@azure/ms-rest-js");

const subKey = process.env.AZURE_COMPUTER_VISION_KEY;
const endPointUrl = process.env.AZURE_COMPUTER_VISION_ENDPOINT;
const sasUrl = process.env.AZURE_BLOB_SAS_URL;
const imagesUrl = process.env.AZURE_IMAGES_URL;

const computerVisionClient = new ComputerVisionClient(
  new ApiKeyCredentials({ inHeader: { "Ocp-Apim-Subscription-Key": subKey } }),
  endPointUrl
);

const blobServiceClient = new BlobServiceClient(sasUrl);
const containerClient = blobServiceClient.getContainerClient("images");

module.exports = async function (req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }

  if (req.method !== "POST" || !req.body.image) {
    res.status(400).send("No image found in request body.");
    return;
  }

  const imageBuffer = Buffer.from(req.body.image, "base64");

  try {
    const imageUrl = await uploadImageToStorage(imageBuffer);

    const printedResult = await readTextFromURL(imageUrl);

    const extractedText = printRecognizedText(printedResult);

    await deleteImageFromStorage(imageUrl);

    res.status(200).send(extractedText);
  } catch (error) {
    res.status(500).send("Error: " + error.message);
  }
};

async function uploadImageToStorage(image) {
  const blobName = "image-" + Date.now().toString();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(image);
  
  return `${imagesUrl}${blobName}`;
}

async function readTextFromURL(imageUrl) {
  let result = await computerVisionClient.read(imageUrl);
  let operation = result.operationLocation.split("/").slice(-1)[0];

  let readOperationResult;
  do {
    await sleep(1000);
    readOperationResult = await computerVisionClient.getReadResult(operation);
  } while (readOperationResult.status !== "succeeded");

  return readOperationResult.analyzeResult.readResults;
}

function printRecognizedText(readResults) {
  let recognizedText = "";
  for (const result of readResults) {
    for (const line of result.lines) {
      recognizedText += line.text + "\n";
    }
  }
  return recognizedText;
}

async function deleteImageFromStorage(imageUrl) {
  const blobName = imageUrl.split("/").pop();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.delete();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
