// We access the global PDFLib and pdfjsLib objects loaded via CDN
declare global {
  interface Window {
    PDFLib: any;
    pdfjsLib: any;
  }
}

import { DocumentGroup } from "../types";
import { GoogleGenAI, Type } from "@google/genai";

interface OCRText {
  t: string; // text
  x: number; // 0-1000
  y: number; // 0-1000
  w: number; // width
  h: number; // height
}

/**
 * Performs OCR using Gemini API to extract text with coordinates.
 */
const performOCR = async (base64Image: string): Promise<OCRText[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Extract base64 data without prefix
  const data = base64Image.split(',')[1] || base64Image;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            {
              inlineData: {
                data: data,
                mimeType: "image/png"
              }
            },
            {
              text: "Act as an OCR engine. Extract all text from this image. Return ONLY a JSON array of objects representing words: { \"t\": \"text\", \"x\": x_coord, \"y\": y_coord, \"w\": width, \"h\": height }. Use a 0-1000 coordinate system where (0,0) is top-left."
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              t: { type: Type.STRING },
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              w: { type: Type.NUMBER },
              h: { type: Type.NUMBER }
            },
            required: ["t", "x", "y", "w", "h"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text);
  } catch (error) {
    console.error("OCR API error:", error);
    return [];
  }
};

/**
 * Converts a PDF file (via ArrayBuffer) into an array of PNG images (one per page)
 */
const renderPdfToImages = async (arrayBuffer: ArrayBuffer): Promise<{ data: Uint8Array, base64: string }[]> => {
  if (!window.pdfjsLib) throw new Error("PDF.js not loaded");
  
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: { data: Uint8Array, base64: string }[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (!context) continue;
    
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport }).promise;
    
    const base64: string = canvas.toDataURL('image/png');
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject("Blob creation failed"), 'image/png');
    });
    
    const buffer = await blob.arrayBuffer();
    pages.push({ data: new Uint8Array(buffer), base64 });
  }
  
  return pages;
};

// Helper to convert image URL to PNG info
const getImageInfo = async (url: string): Promise<{ data: Uint8Array, base64: string }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error("No context")); return; }
      ctx.drawImage(img, 0, 0);
      const base64 = canvas.toDataURL('image/png');
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error("Blob failed")); return; }
        blob.arrayBuffer().then(buffer => resolve({ data: new Uint8Array(buffer), base64 }));
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = url;
  });
};

const downloadBlob = (data: Uint8Array, filename: string, mimeType: string) => {
  const blob = new Blob([data as any], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

export const generatePDF = async (groups: DocumentGroup[], useOCR: boolean = false): Promise<void> => {
  if (!window.PDFLib) {
    alert("PDF library not loaded.");
    return;
  }

  const { PDFDocument, rgb, StandardFonts } = window.PDFLib;

  for (const group of groups) {
    if (group.items.length === 0) continue;

    try {
      const pdfDoc = await PDFDocument.create();
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      let addedPageCount = 0;

      for (const item of group.items) {
        let pagesToProcess: { data: Uint8Array, base64: string }[] = [];

        if (item.type === 'pdf') {
           try {
             let arrayBuffer;
             if (item.originalFile) arrayBuffer = await item.originalFile.arrayBuffer();
             else arrayBuffer = await fetch(item.url).then(res => res.arrayBuffer());
             pagesToProcess = await renderPdfToImages(arrayBuffer);
           } catch (error) {
             console.error(`Error processing PDF ${item.name}:`, error);
           }
        } else {
           try {
             const info = await getImageInfo(item.url);
             pagesToProcess = [info];
           } catch (error) {
             console.error(`Error processing image ${item.name}:`, error);
           }
        }

        for (const pageInfo of pagesToProcess) {
          const image = await pdfDoc.embedPng(pageInfo.data);
          const { width, height } = image.scale(1);
          const page = pdfDoc.addPage([width, height]);
          page.drawImage(image, { x: 0, y: 0, width, height });

          if (useOCR) {
            console.log(`Performing OCR on page ${addedPageCount + 1}...`);
            const words = await performOCR(pageInfo.base64);
            
            for (const word of words) {
               // Gemini uses 0-1000 top-left. PDF-lib uses points bottom-left.
               // x: word.x / 1000 * page_width
               // y: (1000 - word.y) / 1000 * page_height - font_size
               const textX = (word.x / 1000) * width;
               // PDF coordinate y starts from bottom
               const textY = height - ((word.y / 1000) * height);
               
               // Estimate font size based on word height
               const fontSize = (word.h / 1000) * height || 10;

               try {
                 page.drawText(word.t, {
                   x: textX,
                   y: textY - fontSize * 0.8, // Basic vertical alignment adjustment
                   size: fontSize,
                   font: helveticaFont,
                   color: rgb(0, 0, 0),
                   opacity: 0, // Make text searchable but invisible
                 });
               } catch (e) {
                 // Ignore invalid characters for standard font
               }
            }
          }
          addedPageCount++;
        }
      }

      if (addedPageCount === 0) continue;

      const pdfBytes = await pdfDoc.save();
      downloadBlob(pdfBytes, `${group.title}.pdf`, 'application/pdf');

    } catch (err) {
      console.error("Error creating PDF for group " + group.title, err);
    }
  }
};