const API_URL = import.meta.env.VITE_RMBG_API_URL;

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout = 30000
) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(id));
}

export async function removeBackground(imageBase64: string): Promise<string> {
  if (!API_URL) {
    throw new Error('VITE_RMBG_API_URL not defined');
  }

  try {
    const res = await fetchWithTimeout(
      `${API_URL}/remove-bg`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64 }),
      },
      30000
    );

    if (!res.ok) {
      throw new Error(`RMBG failed: ${res.status}`);
    }

    const data = await res.json();
    if (!data?.image) {
      throw new Error('Invalid RMBG response');
    }

    return data.image;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('RMBG timeout (cold start)');
    }
    throw err;
  }
}
