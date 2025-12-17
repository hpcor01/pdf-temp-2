// We access the global PDFLib and pdfjsLib objects loaded via CDN
declare global {
  interface Window {
    PDFLib: any;
    pdfjsLib: any;
  }
}

import { DocumentGroup } from "../types";

/**
 * Converts a PDF file (via ArrayBuffer) into an array of PNG images (one per page)
 * This bypasses structural issues in source PDFs by "flattening" them into images.
 */
const renderPdfToImages = async (arrayBuffer: ArrayBuffer): Promise<Uint8Array[]> => {
  if (!window.pdfjsLib) throw new Error("PDF.js not loaded");
  
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pngPages: Uint8Array[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    // Use scale 2.0 for high resolution (approx 150-200 DPI equivalent)
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (!context) continue;
    
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport }).promise;
    
    // Convert canvas to PNG bytes
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject("Blob creation failed"), 'image/png');
    });
    
    const buffer = await blob.arrayBuffer();
    pngPages.push(new Uint8Array(buffer));
  }
  
  return pngPages;
};

// Helper to convert any image URL (blob/base64) to PNG bytes via Canvas
const convertImageToPngBytes = async (url: string): Promise<Uint8Array> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Canvas to Blob failed"));
          return;
        }
        blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)));
      }, 'image/png');
    };
    img.onerror = (e) => reject(e);
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

export const generatePDF = async (groups: DocumentGroup[]): Promise<void> => {
  if (!window.PDFLib) {
    alert("PDF library not loaded.");
    return;
  }

  const { PDFDocument } = window.PDFLib;

  for (const group of groups) {
    if (group.items.length === 0) continue;

    try {
      const pdfDoc = await PDFDocument.create();
      let addedPageCount = 0;

      for (const item of group.items) {
        if (item.type === 'pdf') {
           try {
             let arrayBuffer;
             if (item.originalFile) {
               arrayBuffer = await item.originalFile.arrayBuffer();
             } else {
               arrayBuffer = await fetch(item.url).then(res => res.arrayBuffer());
             }
             
             // Render PDF pages as images to avoid structural/compression errors
             const pageImages = await renderPdfToImages(arrayBuffer);
             
             for (const pngBytes of pageImages) {
               const image = await pdfDoc.embedPng(pngBytes);
               const { width, height } = image.scale(1);
               const page = pdfDoc.addPage([width, height]);
               page.drawImage(image, { x: 0, y: 0, width, height });
               addedPageCount++;
             }

           } catch (error) {
             console.error(`Error processing PDF ${item.name}:`, error);
             alert(`Erro ao processar o arquivo PDF: ${item.name}.`);
           }
        } else {
           // Handle direct Image items
           try {
             const pngBytes = await convertImageToPngBytes(item.url);
             const image = await pdfDoc.embedPng(pngBytes);

             const page = pdfDoc.addPage([595.28, 841.89]); // A4 Size in points
             const { width, height } = image.scale(1);
             
             const pageWidth = page.getWidth();
             const pageHeight = page.getHeight();
             const margin = 20;
             const availableWidth = pageWidth - (margin * 2);
             const availableHeight = pageHeight - (margin * 2);
             
             const scaleRatio = Math.min(availableWidth / width, availableHeight / height);
             
             const finalWidth = width * scaleRatio;
             const finalHeight = height * scaleRatio;
             
             const x = (pageWidth - finalWidth) / 2;
             const y = (pageHeight - finalHeight) / 2;

             page.drawImage(image, {
               x,
               y,
               width: finalWidth,
               height: finalHeight,
             });
             addedPageCount++;
           } catch (error) {
             console.error(`Error processing image ${item.name}:`, error);
             alert(`Erro ao processar imagem: ${item.name}`);
           }
        }
      }

      if (addedPageCount === 0) continue;

      const pdfBytes = await pdfDoc.save();
      downloadBlob(pdfBytes, `${group.title}.pdf`, 'application/pdf');

    } catch (err) {
      console.error("Error creating PDF for group " + group.title, err);
      alert(`Erro ao criar PDF ${group.title}.`);
    }
  }
};