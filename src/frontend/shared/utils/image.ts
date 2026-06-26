/**
 * Redimensiona una imagen y la devuelve como data URL (base64 JPEG).
 * Útil para guardar logos/escudos pequeños directamente en Firestore.
 */
export const resizeImageToBase64 = (
  file: File,
  maxWidth = 256,
  maxHeight = 256,
  quality = 0.7,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No se pudo procesar la imagen'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        // Usar webp para preservar transparencia y mantener tamaño pequeño
        resolve(canvas.toDataURL('image/webp', quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
