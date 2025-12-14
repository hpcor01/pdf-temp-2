import { removeBackground as rmbg } from './rmbgService';

export async function removeBackground(img: string) {
  return rmbg(img);
}

export async function enhanceImage(img: string) {
  return img;
}

export async function magicEraser(img: string) {
  return img;
}

export async function identifyPageNumber(_: string) {
  return 1;
}
