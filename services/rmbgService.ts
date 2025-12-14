const API_URL = import.meta.env.VITE_RMBG_API_URL;

export async function removeBackground(imageBase64: string): Promise<string> {
  if (!API_URL) {
    throw new Error('VITE_RMBG_API_URL not defined');
  }

  const res = await fetch(`${API_URL}/remove-bg`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ image: imageBase64 }),
  });

  if (!res.ok) {
    throw new Error(`RMBG failed: ${res.status}`);
  }

  const data = await res.json();
  return data.image;
}
