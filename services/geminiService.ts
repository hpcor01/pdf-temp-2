import { removeBackground as removeBackgroundImgly, type Config } from '@imgly/background-removal';

/**
 * Applies Brightness and Contrast to an image using HTML Canvas.
 * Kept from previous version as it works well for pre-processing.
 */
export const applyImageAdjustments = async (imageUrl: string, brightness: number, contrast: number): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error("Could not get canvas context"));
                return;
            }

            // Convert integer 0-200 inputs to CSS filter values
            const b = brightness; 
            const c = contrast;

            ctx.filter = `brightness(${b}%) contrast(${c}%)`;
            ctx.drawImage(img, 0, 0, img.width, img.height);
            
            resolve(canvas.toDataURL());
        };
        img.onerror = reject;
        img.src = imageUrl;
    });
};

/**
 * Removes background using @imgly/background-removal.
 * This library uses publicly accessible CDNs for models.
 */
export const removeBackground = async (imageUrl: string): Promise<string> => {
  try {
    // Configuration for imgly
    const config: Config = {
        progress: (key, current, total) => {
             // Optional: meaningful logs only
             // if (current === total) console.log(`Downloaded ${key}`);
        },
        debug: true, 
        // Use the local proxy path defined in vite.config.ts (dev) and vercel.json (prod).
        // This makes the browser treat the request as same-origin, bypassing CORS/Tracking Prevention.
        publicPath: `${window.location.origin}/imgly-proxy/`
    };

    // Run the removal
    const blob = await removeBackgroundImgly(imageUrl, config);

    // Convert Blob to Base64 Data URL for compatibility with the rest of the app
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error("Failed to convert blob to string"));
            }
        };
        reader.onerror = () => reject(new Error("FileReader failed"));
        reader.readAsDataURL(blob);
    });

  } catch (error) {
    console.error("Background removal error:", error);
    if (error instanceof Error) {
       console.error(error.message);
    }
    // Specific user-friendly error message
    throw new Error("Falha ao remover fundo. Erro ao baixar recursos da IA. Verifique sua conexão.");
  }
};