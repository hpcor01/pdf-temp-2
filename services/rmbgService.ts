const RMBG_API_URL = import.meta.env.VITE_RMBG_API_URL;

if (!RMBG_API_URL) {
  console.warn("VITE_RMBG_API_URL não configurada");
}

/**
 * Remove o fundo da imagem usando o backend RMBG (Render)
 */
export async function removeBackground(file: File): Promise<Blob> {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(`${RMBG_API_URL}/remove-bg`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Erro RMBG: ${text}`);
  }

  return await response.blob();
}
