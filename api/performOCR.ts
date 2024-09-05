import { VercelRequest, VercelResponse } from '@vercel/node';
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { ComputerVisionClient } from '@azure/cognitiveservices-computervision';
import { ApiKeyCredentials } from '@azure/ms-rest-js';
import { ReadResult, ReadOperationResult } from '@azure/cognitiveservices-computervision/esm/models';

// Use environment variables for secrets
const subKey = process.env.AZURE_COMPUTER_VISION_KEY;
const endPointUrl = process.env.AZURE_COMPUTER_VISION_ENDPOINT;
const sasUrl = process.env.AZURE_BLOB_SAS_URL;
const imagesUrl = process.env.AZURE_IMAGES_URL;

const computerVisionClient = new ComputerVisionClient(
  new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': subKey } }), endPointUrl!
);

const blobServiceClient = new BlobServiceClient(sasUrl!);
const containerClient = blobServiceClient.getContainerClient("images");

export default async function (req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' || !req.body.image) {
    res.status(400).send('No image found in request body.');
    return;
  }

  const imageBuffer = Buffer.from(req.body.image, 'base64'); // assuming base64-encoded image

  try {
    const imageUrl = await uploadImageToStorage(imageBuffer);
    const printedResult = await readTextFromURL(imageUrl);
    const extractedText = printRecognizedText(printedResult);

    await deleteImageFromStorage(imageUrl);

    res.status(200).send(extractedText);
  } catch (error) {
    res.status(500).send('Error: ' + error.message);
  }
}

async function uploadImageToStorage(image: Buffer): Promise<string> {
  const blobName = 'image-' + Date.now().toString();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(image);
  return `${imagesUrl}${blobName}`;
}

async function readTextFromURL(imageUrl: string): Promise<ReadResult[]> {
  let result = await computerVisionClient.read(imageUrl);
  let operation = result.operationLocation.split('/').slice(-1)[0];

  let readOperationResult: ReadOperationResult;
  do {
    await sleep(1000);
    readOperationResult = await computerVisionClient.getReadResult(operation);
  } while (readOperationResult.status !== "succeeded");

  return readOperationResult.analyzeResult!.readResults;
}

function printRecognizedText(readResults: ReadResult[]): string {
  let recognizedText = '';
  for (const result of readResults) {
    for (const line of result.lines) {
      const lineText = line.words.map((w) => w.text).join(' ');
      recognizedText += lineText + '\n';
    }
  }
  return recognizedText;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function deleteImageFromStorage(imageUrl: string): Promise<void> {
  const blobName = imageUrl.substring(imagesUrl!.length);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.delete();
}
