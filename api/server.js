const { BlobServiceClient } = require("@azure/storage-blob");
const {
  ComputerVisionClient,
} = require("@azure/cognitiveservices-computervision");
const { ApiKeyCredentials } = require("@azure/ms-rest-js");

// Use environment variables for secrets
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
  console.log("Request received");

  if (req.method !== "POST" || !req.body.image) {
    console.log("Invalid request method or no image found in request body");
    res.status(400).send("No image found in request body.");
    return;
  }

  const imageBuffer = Buffer.from(req.body.image, "base64"); // assuming base64-encoded image
  console.log("Image buffer created");

  try {
    const imageUrl = await uploadImageToStorage(imageBuffer);
    console.log("Image uploaded to storage:", imageUrl);

    const printedResult = await readTextFromURL(imageUrl);
    console.log("Text read from image URL");

    const extractedText = printRecognizedText(printedResult);
    console.log("Text extracted from printed result");

    await deleteImageFromStorage(imageUrl);
    console.log("Image deleted from storage");

    res.status(200).send(extractedText);
    console.log("Response sent with extracted text");
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).send("Error: " + error.message);
  }
};

async function uploadImageToStorage(image) {
  const blobName = "image-" + Date.now().toString();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(image);
  console.log("Image uploaded to blob storage with name:", blobName);
  return `${imagesUrl}${blobName}`;
}

async function readTextFromURL(imageUrl) {
  console.log("Reading text from image URL:", imageUrl);
  let result = await computerVisionClient.read(imageUrl);
  let operation = result.operationLocation.split("/").slice(-1)[0];

  let readOperationResult;
  do {
    console.log("Waiting for text recognition to complete...");
    await sleep(1000);
    readOperationResult = await computerVisionClient.getReadResult(operation);
  } while (readOperationResult.status !== "succeeded");

  console.log("Text recognition completed");
  return readOperationResult.analyzeResult.readResults;
}

function printRecognizedText(readResults) {
  let recognizedText = "";
  for (const result of readResults) {
    for (const line of result.lines) {
      recognizedText += line.text + "\n";
    }
  }
  console.log("Recognized text:", recognizedText);
  return recognizedText;
}

async function deleteImageFromStorage(imageUrl) {
  const blobName = imageUrl.split("/").pop();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.delete();
  console.log("Deleted image from storage with name:", blobName);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}