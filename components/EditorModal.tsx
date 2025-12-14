import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Wand2, Eraser, Check, Undo, RotateCcw, Redo, ZoomIn, ZoomOut, Search, Sparkles, Crop as CropIcon, Hand } from 'lucide-react';
import { ImageItem, Language } from '../types';
import { removeBackground } from '../services/rmbgService';
import { TRANSLATIONS } from '../constants';

interface EditorModalProps {
  item: ImageItem;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (updatedItem: ImageItem) => void;
  language: Language;
}

type Tool = 'none' | 'crop' | 'eraser';
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EditorModal: React.FC<EditorModalProps> = ({ item, isOpen, onClose, onUpdate, language }) => {
  const t = TRANSLATIONS[language];
  
  // History State
  const [history, setHistory] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>('crop'); 
  
  // Crop State
  const [crop, setCrop] = useState<Rect | null>(null); // Stored in NATURAL image coordinates
  const [isDragging, setIsDragging] = useState(false);
  const [dragAction, setDragAction] = useState<'create' | 'move' | 'resize' | null>(null);
  const [activeHandle, setActiveHandle] = useState<ResizeHandle | null>(null);
  
  // Panning State
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const panStartRef = useRef<Point>({ x: 0, y: 0 });
  const scrollStartRef = useRef<{ left: number, top: number }>({ left: 0, top: 0 });

  // Refs for drag calculations (to avoid stale state in event listeners)
  const dragStartPosRef = useRef<Point>({ x: 0, y: 0 }); // Screen coordinates
  const cropStartRectRef = useRef<Rect | null>(null); // Natural coordinates

  // Eraser State
  const [maskLines, setMaskLines] = useState<{ points: Point[], size: number }[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);

  // Zoom State
  const [zoom, setZoom] = useState(1);
  
  const imageRef = useRef<HTMLImageElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null); // New Ref for the container
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageDimensions, setImageDimensions] = useState<{width: number, height: number} | null>(null);

  useEffect(() => {
    if (isOpen) {
      setHistory([item.url]);
      setCurrentIndex(0);
      setCrop(null);
      setMaskLines([]);
      setIsDragging(false);
      setZoom(1);
      setActiveTool('none');
      setCursorPos(null);
      setIsPanning(false);
    }
  }, [item, isOpen]);

  // Spacebar Listener for Panning Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        if (isPanning) setIsPanning(false); // Stop panning if space released (optional UX choice)
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isPanning]);

  // Derived state
  const currentImage = history[currentIndex] || item.url;

  // Handle Image Load to set initial dimensions for calculation
  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    // We store the rendered size at zoom 1 to base our calculations
    // This allows "fit to screen" logic to work initially
    setImageDimensions({ width: img.width, height: img.height });
  };

  // Render the mask canvas
  useEffect(() => {
    if (!maskCanvasRef.current || !imageRef.current) return;
    const canvas = maskCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = imageRef.current.naturalWidth;
    canvas.height = imageRef.current.naturalHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    
    maskLines.forEach(line => {
      if (line.points.length < 1) return;
      ctx.lineWidth = line.size;
      ctx.beginPath();
      ctx.moveTo(line.points[0].x, line.points[0].y);
      for (let i = 1; i < line.points.length; i++) {
        ctx.lineTo(line.points[i].x, line.points[i].y);
      }
      ctx.stroke();
    });

  }, [maskLines, currentImage, zoom]);

  // --- Helpers ---

  const pushToHistory = (newUrl: string) => {
    const newHistory = history.slice(0, currentIndex + 1);
    newHistory.push(newUrl);
    setHistory(newHistory);
    setCurrentIndex(newHistory.length - 1);
    setMaskLines([]);
    setCrop(null);
  };

  const normalizeRect = (r: Rect): Rect => {
    return {
      x: r.w < 0 ? r.x + r.w : r.x,
      y: r.h < 0 ? r.y + r.h : r.y,
      w: Math.abs(r.w),
      h: Math.abs(r.h)
    };
  };

  const getClientToNaturalScale = () => {
    if (!imageRef.current || !wrapperRef.current) return 1;
    // We use the wrapper's client width vs natural width
    // This is the source of truth for the coordinate mapping
    const rect = wrapperRef.current.getBoundingClientRect();
    return imageRef.current.naturalWidth / rect.width;
  };

  // --- Interaction Handlers (Global Listeners for smooth drag) ---

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isProcessing || !imageRef.current || !wrapperRef.current) return;
    
    e.preventDefault();

    // 0. Check for Pan Condition (Spacebar OR No active tool)
    if (isSpacePressed || activeTool === 'none') {
        setIsPanning(true);
        panStartRef.current = { x: e.clientX, y: e.clientY };
        if (containerRef.current) {
            scrollStartRef.current = {
                left: containerRef.current.scrollLeft,
                top: containerRef.current.scrollTop
            };
        }
        return;
    }

    const rect = wrapperRef.current.getBoundingClientRect();
    const scale = getClientToNaturalScale();

    // Mouse pos relative to Wrapper (Visual Pixels)
    const clientX = e.clientX;
    const clientY = e.clientY;
    
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;
    
    // Convert to Natural
    const naturalX = relX * scale;
    const naturalY = relY * scale;

    if (activeTool === 'eraser') {
      setIsDrawing(true);
      setMaskLines(prev => [...prev, { points: [{ x: naturalX, y: naturalY }], size: brushSize }]);
      return;
    }

    if (activeTool === 'crop') {
      // 1. Check Handles (Screen Coordinates for easier hitting)
      if (crop) {
        // Project crop to screen coords
        const screenCrop = {
            x: crop.x / scale + rect.left,
            y: crop.y / scale + rect.top,
            w: crop.w / scale,
            h: crop.h / scale
        };

        const handleRadius = 15; // increased hit radius
        const handle = getHitHandle(clientX, clientY, screenCrop, handleRadius);

        if (handle) {
            setIsDragging(true);
            setDragAction('resize');
            setActiveHandle(handle);
            dragStartPosRef.current = { x: clientX, y: clientY };
            cropStartRectRef.current = { ...crop };
            return;
        }

        // 2. Check Inside (Move)
        const normalizedCrop = normalizeRect(crop);
        const normX = normalizedCrop.x / scale;
        const normY = normalizedCrop.y / scale;
        const normW = normalizedCrop.w / scale;
        const normH = normalizedCrop.h / scale;

        if (
            relX >= normX && 
            relX <= normX + normW &&
            relY >= normY &&
            relY <= normY + normH
        ) {
            setIsDragging(true);
            setDragAction('move');
            dragStartPosRef.current = { x: clientX, y: clientY };
            cropStartRectRef.current = { ...crop };
            return;
        }
      }

      // 3. Create New
      setIsDragging(true);
      setDragAction('create');
      dragStartPosRef.current = { x: clientX, y: clientY };
      
      const startRect = { x: naturalX, y: naturalY, w: 0, h: 0 };
      setCrop(startRect);
      cropStartRectRef.current = startRect;
    }
  };

  const handleWindowMouseMove = useCallback((e: MouseEvent) => {
    // Panning Logic
    if (isPanning && containerRef.current) {
        const deltaX = e.clientX - panStartRef.current.x;
        const deltaY = e.clientY - panStartRef.current.y;
        
        // Move scroll opposite to drag direction (Standard Grab behavior)
        containerRef.current.scrollLeft = scrollStartRef.current.left - deltaX;
        containerRef.current.scrollTop = scrollStartRef.current.top - deltaY;
        return;
    }

    if (!isDragging || !imageRef.current || !cropStartRectRef.current || !wrapperRef.current) return;

    const scale = getClientToNaturalScale();
    const startPos = dragStartPosRef.current;
    const startRect = cropStartRectRef.current;

    const deltaX = (e.clientX - startPos.x) * scale;
    const deltaY = (e.clientY - startPos.y) * scale;

    const imgW = imageRef.current.naturalWidth;
    const imgH = imageRef.current.naturalHeight;

    if (dragAction === 'create') {
        let newW = deltaX;
        let newH = deltaY;
        
        // No auto-clamping/normalizing here prevents "jumping" when dragging negatively
        // We just update the raw rect, normalizeRect handles rendering
        setCrop({ ...startRect, w: newW, h: newH });

    } else if (dragAction === 'move') {
        let newX = startRect.x + deltaX;
        let newY = startRect.y + deltaY;

        // Clamp
        const normStart = normalizeRect(startRect); // Ensure we know dimensions
        newX = Math.max(0, Math.min(newX, imgW - normStart.w));
        newY = Math.max(0, Math.min(newY, imgH - normStart.h));

        setCrop({ ...startRect, x: newX, y: newY });

    } else if (dragAction === 'resize' && activeHandle) {
        let { x, y, w, h } = startRect;

        // Apply delta based on handle
        if (activeHandle.includes('e')) w += deltaX;
        if (activeHandle.includes('w')) { x += deltaX; w -= deltaX; }
        if (activeHandle.includes('s')) h += deltaY;
        if (activeHandle.includes('n')) { y += deltaY; h -= deltaY; }

        setCrop({ x, y, w, h });
    }

  }, [isDragging, dragAction, activeHandle, isPanning]);

  const handleWindowMouseUp = useCallback(() => {
    if (isPanning) {
        setIsPanning(false);
    }
    
    if (isDragging) {
        setIsDragging(false);
        setDragAction(null);
        setActiveHandle(null);
        // Normalize crop on release to keep positive width/height
        setCrop(prev => {
            if (!prev) return null;
            const norm = normalizeRect(prev);
            if (norm.w < 5 || norm.h < 5) return null; // Too small
            return norm;
        });
    }
    setIsDrawing(false);
  }, [isDragging, isPanning]);

  // Attach/Detach global listeners
  useEffect(() => {
    if (isDragging || isDrawing || isPanning) {
        window.addEventListener('mousemove', handleWindowMouseMove);
        window.addEventListener('mouseup', handleWindowMouseUp);
    }
    return () => {
        window.removeEventListener('mousemove', handleWindowMouseMove);
        window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isDragging, isDrawing, isPanning, handleWindowMouseMove, handleWindowMouseUp]);


  const handleMouseMoveLocal = (e: React.MouseEvent) => {
    // Only used for eraser cursor update or non-dragging logic
    if (activeTool === 'eraser' && !isSpacePressed) {
      setCursorPos({ x: e.clientX, y: e.clientY });
      
      if (isDrawing && imageRef.current && wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        const scale = getClientToNaturalScale();
        const naturalX = (e.clientX - rect.left) * scale;
        const naturalY = (e.clientY - rect.top) * scale;
        
        setMaskLines(prev => {
            const last = prev[prev.length - 1];
            if (!last) return prev;
            const newPoints = [...last.points, { x: naturalX, y: naturalY }];
            const updatedLast = { ...last, points: newPoints };
            return [...prev.slice(0, -1), updatedLast];
        });
      }
    }
  };


  // --- Standard Actions ---

  const handleUndo = () => {
    if (activeTool === 'eraser' && maskLines.length > 0) {
      setMaskLines(prev => prev.slice(0, -1));
    } else if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setCrop(null);
      setMaskLines([]);
    }
  };

  const handleRedo = () => {
    if (currentIndex < history.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setCrop(null);
      setMaskLines([]);
    }
  };

  const handleReset = () => {
    if (history.length > 0) {
      setCurrentIndex(0);
      setCrop(null);
      setZoom(1);
      setMaskLines([]);
      setActiveTool('none');
    }
  };

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 5));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.1));
  const handleZoomReset = () => setZoom(1);

  const handleAiAction = async (action: 'bg' | 'enhance') => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      let newUrl = '';
      if (action === 'bg') {
        newUrl = await removeBackground(currentImage);
      } else {
        newUrl = await enhanceImage(currentImage);
      }
      pushToHistory(newUrl);
    } catch (e) {
      alert("AI processing failed. Check API Key.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyEraser = async () => {
    if (maskLines.length === 0 || isProcessing) return;
    setIsProcessing(true);
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.src = currentImage;
      await new Promise(resolve => { img.onload = resolve; });
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
        maskLines.forEach(line => {
          if (line.points.length < 1) return;
          ctx.lineWidth = line.size;
          ctx.beginPath();
          ctx.moveTo(line.points[0].x, line.points[0].y);
          for (let i = 1; i < line.points.length; i++) {
             ctx.lineTo(line.points[i].x, line.points[i].y);
          }
          ctx.stroke();
        });
        const compositeUrl = canvas.toDataURL('image/png');
        const resultUrl = await magicEraser(compositeUrl);
        pushToHistory(resultUrl);
        setActiveTool('none');
      }
    } catch (e) {
      alert("Magic Eraser failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyCrop = () => {
    if (!crop || !imageRef.current) return;
    const norm = normalizeRect(crop);
    if (norm.w < 10 || norm.h < 10) return;

    const canvas = document.createElement('canvas');
    canvas.width = norm.w;
    canvas.height = norm.h;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      ctx.drawImage(
        imageRef.current,
        norm.x,
        norm.y,
        norm.w,
        norm.h,
        0,
        0,
        norm.w,
        norm.h
      );
      pushToHistory(canvas.toDataURL());
    }
    setCrop(null);
  };

  const handleSave = () => {
    let finalUrl = currentImage;

    // Auto-apply pending crop if exists and active
    if (activeTool === 'crop' && crop && imageRef.current) {
      const norm = normalizeRect(crop);
      // Minimum valid size check (same as mouseUp)
      if (norm.w > 5 && norm.h > 5) {
        const canvas = document.createElement('canvas');
        canvas.width = norm.w;
        canvas.height = norm.h;
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
          ctx.drawImage(
            imageRef.current,
            norm.x,
            norm.y,
            norm.w,
            norm.h,
            0,
            0,
            norm.w,
            norm.h
          );
          finalUrl = canvas.toDataURL();
        }
      }
    }

    onUpdate({ ...item, url: finalUrl });
    onClose();
  };

  const getHitHandle = (mx: number, my: number, r: Rect, tol: number): ResizeHandle | null => {
    const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1);
    
    // Check corners
    if (dist(mx, my, r.x, r.y) < tol) return 'nw';
    if (dist(mx, my, r.x + r.w, r.y) < tol) return 'ne';
    if (dist(mx, my, r.x, r.y + r.h) < tol) return 'sw';
    if (dist(mx, my, r.x + r.w, r.y + r.h) < tol) return 'se';
    
    // Check midpoints
    if (dist(mx, my, r.x + r.w/2, r.y) < tol) return 'n';
    if (dist(mx, my, r.x + r.w/2, r.y + r.h) < tol) return 's';
    if (dist(mx, my, r.x, r.y + r.h/2) < tol) return 'w';
    if (dist(mx, my, r.x + r.w, r.y + r.h/2) < tol) return 'e';

    return null;
  };

  // Determine cursor based on state
  const getCursor = () => {
      if (isPanning) return 'cursor-grabbing';
      if (isSpacePressed || activeTool === 'none') return 'cursor-grab';
      if (activeTool === 'eraser') return 'cursor-none';
      if (activeTool === 'crop') return 'cursor-crosshair';
      return 'cursor-default';
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-default"
      onMouseMove={handleMouseMoveLocal} // Local hover effects only
    >
      <div className="bg-white dark:bg-gray-900 w-[90vw] h-[90vh] rounded-lg flex flex-col border border-gray-300 dark:border-gray-700 shadow-2xl transition-colors duration-300" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-6 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-200">{t.editorTitle}</h2>
          
          <div className="flex items-center space-x-2">
             <div className="flex items-center space-x-1 mr-4 border-r border-gray-300 dark:border-gray-700 pr-4">
               <button onClick={handleZoomOut} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition" title={t.zoomOut}><ZoomOut size={18} /></button>
               <span className="text-xs w-10 text-center text-gray-500 dark:text-gray-400 font-medium select-none">{Math.round(zoom * 100)}%</span>
               <button onClick={handleZoomIn} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition" title={t.zoomIn}><ZoomIn size={18} /></button>
               <button onClick={handleZoomReset} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition ml-1" title={t.zoomReset}><Search size={16} /></button>
             </div>

             <button onClick={handleUndo} disabled={currentIndex <= 0} className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 transition rounded hover:bg-gray-100 dark:hover:bg-gray-800"><Undo size={18} /></button>
             <button onClick={handleRedo} disabled={currentIndex >= history.length - 1} className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 transition rounded hover:bg-gray-100 dark:hover:bg-gray-800"><Redo size={18} /></button>
             <button onClick={handleReset} disabled={currentIndex === 0 && history.length === 1} className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 transition rounded hover:bg-gray-100 dark:hover:bg-gray-800"><RotateCcw size={18} /></button>
             <div className="w-px h-6 bg-gray-300 dark:bg-gray-700 mx-2" />
             <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"><X /></button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <div className="w-64 bg-gray-50 dark:bg-gray-850 p-4 border-r border-gray-200 dark:border-gray-800 flex flex-col flex-shrink-0 z-20 overflow-y-auto">
            <div className="space-y-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{t.aiTools}</div>
              
              <button 
                onClick={() => { setActiveTool('none'); handleAiAction('bg'); }}
                disabled={isProcessing || activeTool === 'eraser' || activeTool === 'crop'}
                className="w-full flex items-center p-3 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-gray-700 dark:text-gray-200 disabled:opacity-50"
              >
                <Eraser className="mr-3 text-emerald-500 dark:text-emerald-400" size={18} />
                {t.removeBg}
              </button>

              <button 
                onClick={() => { setActiveTool('none'); handleAiAction('enhance'); }}
                disabled={isProcessing || activeTool === 'eraser' || activeTool === 'crop'}
                className="w-full flex items-center p-3 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-gray-700 dark:text-gray-200 disabled:opacity-50"
              >
                <Wand2 className="mr-3 text-blue-500 dark:text-blue-400" size={18} />
                {t.enhance}
              </button>

              {/* Eraser */}
              <div className={`border rounded-lg p-3 transition ${activeTool === 'eraser' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
                <button 
                  onClick={() => setActiveTool(activeTool === 'eraser' ? 'none' : 'eraser')}
                  className="w-full flex items-center text-left mb-2 text-gray-700 dark:text-gray-200"
                >
                  <Sparkles className="mr-3 text-purple-500 dark:text-purple-400" size={18} />
                  <span className="font-medium text-sm">{t.magicEraser}</span>
                </button>
                {activeTool === 'eraser' && (
                  <div className="mt-3 space-y-3 animate-fade-in">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t.eraserInstructions}</p>
                    <input type="range" min="5" max="100" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-emerald-500" />
                    <button onClick={handleApplyEraser} disabled={maskLines.length === 0 || isProcessing} className="w-full py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-medium disabled:opacity-50 transition">{t.applyEraser}</button>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 my-4" />
              
              {/* Crop Tool */}
              <div className={`border rounded-lg p-3 transition ${activeTool === 'crop' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
                 <button 
                  onClick={() => {
                    setActiveTool(activeTool === 'crop' ? 'none' : 'crop');
                    setCrop(null); // Reset crop on toggle
                  }}
                  className="w-full flex items-center text-left mb-2 text-gray-700 dark:text-gray-200"
                 >
                   <CropIcon className="mr-3 text-orange-500 dark:text-orange-400" size={18} />
                   <span className="font-medium text-sm">{t.manualCrop}</span>
                 </button>
                 {activeTool === 'crop' && (
                    <div className="mt-3 space-y-3 animate-fade-in">
                      <p className="text-xs text-gray-500 dark:text-gray-400">{t.cropInstructions}</p>
                      <button 
                        onClick={handleApplyCrop}
                        disabled={!crop}
                        className="w-full py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-xs font-medium disabled:opacity-50 transition"
                      >
                        {t.applyCrop}
                      </button>
                    </div>
                 )}
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div 
             className="flex-1 bg-gray-100 dark:bg-gray-950 flex overflow-auto relative select-none custom-scrollbar"
             ref={containerRef}
          >
            <div className="min-w-full min-h-full flex items-center justify-center p-10">
                {isProcessing && (
                   <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/50 dark:bg-black/50 backdrop-blur-sm">
                      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500 mb-4"></div>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium animate-pulse">{t.processing}</span>
                   </div>
                )}
                
                <div 
                  ref={wrapperRef}
                  className={`relative inline-block border border-gray-300 dark:border-gray-700 shadow-xl 
                    ${getCursor()}
                    bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgZmlsbD0iI2YwZjBmMCI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZThlOGU4IiAvPjxyZWN0IHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZThlOGU4IiAvPjwvc3ZnPg==')] dark:bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgZmlsbD0iIzIyMjIyMiI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMzMzMzMzIiAvPjxyZWN0IHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMzMzMzMzIiAvPjwvc3ZnPg==')]`}
                  onMouseDown={handleMouseDown}
                  style={{
                    // Explicitly sizing the wrapper prevents layout mismatch with image scaling
                    width: imageDimensions ? imageDimensions.width * zoom : 'auto',
                    height: imageDimensions ? imageDimensions.height * zoom : 'auto',
                    touchAction: 'none'
                  }}
                >
                  <img 
                    ref={imageRef}
                    src={currentImage} 
                    onLoad={onImageLoad}
                    alt="Editing" 
                    className="max-h-[75vh] max-w-[90vw] pointer-events-none block"
                    style={{ 
                       // Use strict width/height instead of transform: scale to ensure getBoundingClientRect is consistent
                       width: '100%',
                       height: '100%',
                       maxWidth: 'none',
                       maxHeight: 'none'
                    }} 
                    draggable={false}
                  />

                  <canvas 
                    ref={maskCanvasRef}
                    className="absolute top-0 left-0 pointer-events-none"
                    style={{
                      width: '100%',
                      height: '100%'
                    }}
                  />
                  
                  {activeTool === 'eraser' && cursorPos && !isPanning && (
                    <div 
                       className="fixed pointer-events-none z-50 rounded-full border border-white shadow-sm bg-purple-500/30"
                       style={{
                         width: brushSize * zoom,
                         height: brushSize * zoom,
                         left: cursorPos.x - (brushSize * zoom) / 2,
                         top: cursorPos.y - (brushSize * zoom) / 2,
                       }}
                    />
                  )}

                  {/* Crop UI */}
                  {crop && activeTool === 'crop' && (
                    <>
                      {/* We calculate normalized visual coords for rendering */}
                      {(() => {
                          const norm = normalizeRect(crop);
                          // Calculate visual position relative to wrapper size
                          const scale = getClientToNaturalScale();
                          
                          const vx = norm.x / scale;
                          const vy = norm.y / scale;
                          const vw = norm.w / scale;
                          const vh = norm.h / scale;
                          
                          return (
                            <>
                              {/* Dimmed Overlay (4 divs) */}
                              <div className="absolute top-0 left-0 right-0 bg-black/60 pointer-events-none" style={{ height: vy }} />
                              <div className="absolute left-0 right-0 bottom-0 bg-black/60 pointer-events-none" style={{ top: vy + vh }} />
                              <div className="absolute left-0 bg-black/60 pointer-events-none" style={{ top: vy, height: vh, width: vx }} />
                              <div className="absolute right-0 bg-black/60 pointer-events-none" style={{ top: vy, height: vh, left: vx + vw }} />

                              {/* Selection Box */}
                              <div 
                                className="absolute border-2 border-emerald-500 cursor-move"
                                style={{ left: vx, top: vy, width: vw, height: vh }}
                              >
                                 {/* Grid Lines */}
                                 <div className="absolute inset-0 flex flex-col pointer-events-none opacity-50">
                                    <div className="flex-1 border-b border-white/50"></div>
                                    <div className="flex-1 border-b border-white/50"></div>
                                    <div className="flex-1"></div>
                                 </div>
                                 <div className="absolute inset-0 flex pointer-events-none opacity-50">
                                    <div className="flex-1 border-r border-white/50"></div>
                                    <div className="flex-1 border-r border-white/50"></div>
                                    <div className="flex-1"></div>
                                 </div>

                                 {/* Handles - Fixed size regardless of zoom */}
                                 <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-emerald-500 rounded-full cursor-nw-resize z-10" />
                                 <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-emerald-500 rounded-full cursor-ne-resize z-10" />
                                 <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-emerald-500 rounded-full cursor-sw-resize z-10" />
                                 <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-emerald-500 rounded-full cursor-se-resize z-10" />
                                 
                                 <div className="absolute -top-1.5 left-1/2 -ml-1.5 w-3 h-3 bg-white border border-emerald-500 rounded-full cursor-n-resize z-10" />
                                 <div className="absolute -bottom-1.5 left-1/2 -ml-1.5 w-3 h-3 bg-white border border-emerald-500 rounded-full cursor-s-resize z-10" />
                                 <div className="absolute top-1/2 -mt-1.5 -left-1.5 w-3 h-3 bg-white border border-emerald-500 rounded-full cursor-w-resize z-10" />
                                 <div className="absolute top-1/2 -mt-1.5 -right-1.5 w-3 h-3 bg-white border border-emerald-500 rounded-full cursor-e-resize z-10" />
                              </div>
                            </>
                          );
                      })()}
                    </>
                  )}
                </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-16 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end px-6 space-x-4 bg-white dark:bg-gray-900 transition-colors z-20">
           <button onClick={onClose} className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition">{t.cancel}</button>
           <button onClick={handleSave} className="bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white px-6 py-2 rounded font-medium flex items-center shadow-lg shadow-emerald-500/20 dark:shadow-emerald-900/20">
             <Check size={18} className="mr-2" />
             {t.confirm}
           </button>
        </div>
      </div>
    </div>
  );
};

export default EditorModal;