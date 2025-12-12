import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Trash2, ArrowLeft, ArrowRight, ZoomIn, ZoomOut, Search, Eye, Grid } from 'lucide-react';
import { ImageItem, Language } from '../types';
import { TRANSLATIONS } from '../constants';

// Declare globals for libraries loaded via CDN
declare global {
  interface Window {
    pdfjsLib: any;
    PDFLib: any;
  }
}

interface PdfEditorModalProps {
  item: ImageItem;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (updatedItem: ImageItem) => void;
  language: Language;
}

interface PdfPage {
  originalIndex: number;
  thumbnail: string;
  id: string;
  originalBlob?: Blob; // Store blob/data for high-res view if possible (not implemented fully here for simplicity, using thumbnail or re-render)
}

const PdfEditorModal: React.FC<PdfEditorModalProps> = ({ item, isOpen, onClose, onUpdate, language }) => {
  const t = TRANSLATIONS[language];
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draggedItem, setDraggedItem] = useState<number | null>(null);
  
  // Grid Zoom State
  const [gridZoom, setGridZoom] = useState(1);
  
  // Single Page View State
  const [viewingPageIndex, setViewingPageIndex] = useState<number | null>(null);
  const [pageZoom, setPageZoom] = useState(1);

  // Cached PDF Document
  const pdfDocRef = useRef<any>(null);

  useEffect(() => {
    if (isOpen && item.type === 'pdf') {
      loadPdfPages();
      setGridZoom(1); 
      setViewingPageIndex(null);
    }
  }, [isOpen, item]);

  const loadPdfPages = async () => {
    setIsLoading(true);
    try {
      if (!window.pdfjsLib) {
        console.error("PDF.js not loaded");
        return;
      }

      // 1. Fetch data
      const response = await fetch(item.url);
      const arrayBuffer = await response.arrayBuffer();

      // 2. Load PDF Document using PDF.js
      const loadingTask = window.pdfjsLib.getDocument(arrayBuffer);
      const pdf = await loadingTask.promise;
      pdfDocRef.current = pdf;

      const numPages = pdf.numPages;
      const loadedPages: PdfPage[] = [];

      // 3. Render each page to canvas to get a thumbnail
      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.4 }); // Decent quality thumbnail
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        if (context) {
          await page.render({ canvasContext: context, viewport: viewport }).promise;
          loadedPages.push({
            originalIndex: i - 1, // 0-based index for pdf-lib
            thumbnail: canvas.toDataURL(),
            id: Math.random().toString(36).substr(2, 9)
          });
        }
      }
      setPages(loadedPages);
    } catch (error) {
      console.error("Error loading PDF pages:", error);
      alert("Failed to load PDF pages.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!window.PDFLib) {
      alert("PDF Lib not loaded");
      return;
    }
    
    setIsLoading(true);
    try {
      const { PDFDocument } = window.PDFLib;

      // Load original PDF
      const originalArrayBuffer = await fetch(item.url).then(res => res.arrayBuffer());
      const originalPdf = await PDFDocument.load(originalArrayBuffer);
      
      // Create new PDF
      const newPdf = await PDFDocument.create();
      
      // Copy pages in the new order
      const pageIndices = pages.map(p => p.originalIndex);
      const copiedPages = await newPdf.copyPages(originalPdf, pageIndices);
      
      copiedPages.forEach((page: any) => newPdf.addPage(page));

      // Save to bytes
      const pdfBytes = await newPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const newUrl = URL.createObjectURL(blob);

      onUpdate({
        ...item,
        url: newUrl
      });
      onClose();
    } catch (error) {
      console.error("Error saving PDF:", error);
      alert("Error saving PDF.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePage = (index: number) => {
    const newPages = [...pages];
    newPages.splice(index, 1);
    setPages(newPages);
    if (viewingPageIndex !== null && index === viewingPageIndex) {
       setViewingPageIndex(null); // Close view if deleted
    } else if (viewingPageIndex !== null && index < viewingPageIndex) {
       setViewingPageIndex(viewingPageIndex - 1); // Adjust index
    }
  };

  const movePage = (index: number, direction: 'left' | 'right') => {
    if (direction === 'left' && index > 0) {
      const newPages = [...pages];
      [newPages[index - 1], newPages[index]] = [newPages[index], newPages[index - 1]];
      setPages(newPages);
    } else if (direction === 'right' && index < pages.length - 1) {
      const newPages = [...pages];
      [newPages[index + 1], newPages[index]] = [newPages[index], newPages[index + 1]];
      setPages(newPages);
    }
  };

  // Zoom handlers
  const handleZoomIn = () => {
    if (viewingPageIndex !== null) setPageZoom(prev => Math.min(prev + 0.25, 4));
    else setGridZoom(prev => Math.min(prev + 0.25, 3));
  };
  
  const handleZoomOut = () => {
    if (viewingPageIndex !== null) setPageZoom(prev => Math.max(prev - 0.25, 0.5));
    else setGridZoom(prev => Math.max(prev - 0.25, 0.25));
  };
  
  const handleZoomReset = () => {
    if (viewingPageIndex !== null) setPageZoom(1);
    else setGridZoom(1);
  };

  // Drag and Drop handlers
  const onDragStart = (e: React.DragEvent, index: number) => {
    setDraggedItem(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedItem === null || draggedItem === index) return;
    
    const newPages = [...pages];
    const item = newPages.splice(draggedItem, 1)[0];
    newPages.splice(index, 0, item);
    
    setPages(newPages);
    setDraggedItem(index);
  };

  const onDragEnd = () => {
    setDraggedItem(null);
  };

  // --- Single Page View Logic ---
  
  const [highResPageUrl, setHighResPageUrl] = useState<string | null>(null);

  useEffect(() => {
    const loadHighRes = async () => {
      if (viewingPageIndex === null || !pdfDocRef.current) return;
      
      setHighResPageUrl(null); // Clear previous
      const pageIndex = pages[viewingPageIndex].originalIndex;
      
      try {
        const page = await pdfDocRef.current.getPage(pageIndex + 1); // PDF.js is 1-based
        const viewport = page.getViewport({ scale: 2 }); // High quality for view
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        if (context) {
           await page.render({ canvasContext: context, viewport }).promise;
           setHighResPageUrl(canvas.toDataURL());
        }
      } catch (e) {
        console.error("Error rendering page view", e);
      }
    };

    loadHighRes();
    setPageZoom(1);
  }, [viewingPageIndex, pages]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 w-[80vw] h-[80vh] rounded-lg flex flex-col border border-gray-300 dark:border-gray-700 shadow-2xl transition-colors duration-300">
        
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center space-x-3">
             <h2 className="text-lg font-medium text-gray-900 dark:text-gray-200">{t.pdfEditorTitle}</h2>
             {viewingPageIndex !== null && (
               <span className="text-sm text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                 {t.page} {viewingPageIndex + 1} / {pages.length}
               </span>
             )}
          </div>
          
          <div className="flex items-center space-x-4">
             {/* Zoom Controls */}
             <div className="flex items-center space-x-1 border-r border-gray-300 dark:border-gray-700 pr-4">
               <button onClick={handleZoomOut} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition" title={t.zoomOut}><ZoomOut size={18} /></button>
               <span className="text-xs w-10 text-center text-gray-500 dark:text-gray-400 font-medium select-none">
                 {Math.round((viewingPageIndex !== null ? pageZoom : gridZoom) * 100)}%
               </span>
               <button onClick={handleZoomIn} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition" title={t.zoomIn}><ZoomIn size={18} /></button>
               <button onClick={handleZoomReset} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition ml-1" title={t.zoomReset}><Search size={16} /></button>
             </div>

             <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                <X />
             </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative bg-gray-100 dark:bg-gray-950">
          
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-emerald-500">
               <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500 mb-4"></div>
               <span>{t.loadingPdf}</span>
            </div>
          ) : viewingPageIndex !== null ? (
            // --- Single Page View Mode ---
            <div className="w-full h-full flex flex-col">
               <div className="flex-1 overflow-auto flex items-center justify-center p-8 custom-scrollbar relative">
                 {highResPageUrl ? (
                   <img 
                     src={highResPageUrl} 
                     alt="Page View" 
                     className="shadow-2xl transition-transform duration-200"
                     style={{ 
                       transform: `scale(${pageZoom})`,
                       maxWidth: '100%',
                       maxHeight: '100%',
                       objectFit: 'contain'
                     }} 
                   />
                 ) : (
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500"></div>
                 )}
               </div>
               
               {/* View Navigation Bar */}
               <div className="h-16 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between px-6 z-10">
                  <button 
                    onClick={() => setViewingPageIndex(null)}
                    className="flex items-center text-gray-600 dark:text-gray-300 hover:text-emerald-500 transition font-medium"
                  >
                    <Grid size={18} className="mr-2" />
                    {t.backToGrid}
                  </button>

                  <div className="flex items-center space-x-4">
                    <button 
                       disabled={viewingPageIndex <= 0}
                       onClick={() => setViewingPageIndex(prev => prev! - 1)}
                       className="p-2 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 transition"
                       title={t.prevPage}
                    >
                      <ArrowLeft size={20} />
                    </button>
                    <button 
                       disabled={viewingPageIndex >= pages.length - 1}
                       onClick={() => setViewingPageIndex(prev => prev! + 1)}
                       className="p-2 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 transition"
                       title={t.nextPage}
                    >
                      <ArrowRight size={20} />
                    </button>
                  </div>
                  
                  <div className="w-20"></div> {/* Spacer for center alignment */}
               </div>
            </div>
          ) : (
            // --- Grid View Mode ---
            <div className="h-full overflow-y-auto p-6">
              {pages.length === 0 ? (
                 <div className="h-full flex items-center justify-center text-gray-500">
                   No pages found.
                 </div>
              ) : (
                <div 
                   className="grid gap-4 transition-all duration-200" 
                   style={{ 
                      gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(120, 150 * gridZoom)}px, 1fr))` 
                   }}
                >
                  {pages.map((page, index) => (
                    <div 
                      key={page.id} 
                      draggable
                      onDragStart={(e) => onDragStart(e, index)}
                      onDragOver={(e) => onDragOver(e, index)}
                      onDragEnd={onDragEnd}
                      className={`relative group bg-white dark:bg-gray-800 p-2 rounded shadow-sm border-2 transition-colors cursor-move
                        ${draggedItem === index ? 'border-emerald-500 opacity-50' : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'}`}
                    >
                      <div className="aspect-[1/1.4] bg-gray-200 dark:bg-gray-900 mb-2 overflow-hidden rounded relative">
                        <img src={page.thumbnail} alt={`Page ${index + 1}`} className="w-full h-full object-contain" draggable={false} />
                        
                        {/* Hover Overlay for View */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                           <button 
                             onClick={() => setViewingPageIndex(index)}
                             className="p-2 bg-white/90 rounded-full text-gray-800 hover:text-emerald-500 hover:scale-110 transition shadow-lg"
                             title={t.viewPage}
                           >
                             <Eye size={20} />
                           </button>
                        </div>
                      </div>
                      
                      <div className="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400 px-1">
                        <span>{t.page} {index + 1}</span>
                        <button 
                          onClick={() => handleDeletePage(index)}
                          className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer (Only shown in Grid Mode) */}
        {viewingPageIndex === null && (
          <div className="h-16 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end px-6 space-x-4 bg-white dark:bg-gray-900">
             <button onClick={onClose} className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition">{t.cancel}</button>
             <button 
               onClick={handleSave} 
               disabled={pages.length === 0}
               className="bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white px-6 py-2 rounded font-medium flex items-center shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
             >
               <Save size={18} className="mr-2" />
               {t.savePdf}
             </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfEditorModal;