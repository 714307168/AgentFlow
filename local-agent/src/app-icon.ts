import * as fs from "fs";
import * as path from "path";
import { nativeImage, NativeImage } from "electron";

function resolveIconAssetPath(fileName: string): string | null {
  const candidates = [
    path.join(__dirname, "..", "..", "assets", fileName),
    path.join(process.resourcesPath, "assets", fileName),
    path.join(process.cwd(), "assets", fileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadBundledIcon(fileNames: string[], size: number): NativeImage | null {
  for (const fileName of fileNames) {
    const assetPath = resolveIconAssetPath(fileName);
    if (!assetPath) {
      continue;
    }

    const image = nativeImage.createFromPath(assetPath);
    if (image.isEmpty()) {
      continue;
    }

    return image.resize({
      width: size,
      height: size,
      quality: "best",
    });
  }

  return null;
}

function buildLogoSvg(size: number): string {
  const safeSize = Math.max(32, size);
  const stroke = safeSize * 0.065;
  const nodeRadius = safeSize * 0.1;
  const centerSize = safeSize * 0.2;
  const center = safeSize / 2;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${safeSize}" height="${safeSize}" viewBox="0 0 ${safeSize} ${safeSize}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0d1824" />
          <stop offset="100%" stop-color="#163249" />
        </linearGradient>
        <linearGradient id="core" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#5dd0ff" />
          <stop offset="100%" stop-color="#3fd88f" />
        </linearGradient>
      </defs>
      <rect x="${safeSize * 0.06}" y="${safeSize * 0.06}" width="${safeSize * 0.88}" height="${safeSize * 0.88}" rx="${safeSize * 0.24}" fill="url(#bg)" />
      <rect x="${safeSize * 0.13}" y="${safeSize * 0.16}" width="${safeSize * 0.74}" height="${safeSize * 0.1}" rx="${safeSize * 0.05}" fill="rgba(255,255,255,0.10)" />
      <circle cx="${center}" cy="${safeSize * 0.27}" r="${nodeRadius}" fill="#5dd0ff" />
      <circle cx="${safeSize * 0.28}" cy="${safeSize * 0.71}" r="${nodeRadius}" fill="#7ee6ff" />
      <circle cx="${safeSize * 0.72}" cy="${safeSize * 0.71}" r="${nodeRadius}" fill="#3fd88f" />
      <path d="M ${center} ${safeSize * 0.37} L ${safeSize * 0.34} ${safeSize * 0.63}" stroke="rgba(237,244,251,0.88)" stroke-width="${stroke}" stroke-linecap="round" />
      <path d="M ${center} ${safeSize * 0.37} L ${safeSize * 0.66} ${safeSize * 0.63}" stroke="rgba(237,244,251,0.88)" stroke-width="${stroke}" stroke-linecap="round" />
      <path d="M ${safeSize * 0.38} ${safeSize * 0.71} L ${safeSize * 0.62} ${safeSize * 0.71}" stroke="rgba(237,244,251,0.66)" stroke-width="${stroke}" stroke-linecap="round" />
      <rect
        x="${center - centerSize / 2}"
        y="${safeSize * 0.45}"
        width="${centerSize}"
        height="${centerSize}"
        rx="${safeSize * 0.05}"
        transform="rotate(45 ${center} ${safeSize * 0.55})"
        fill="url(#core)"
      />
      <path d="M ${center} ${safeSize * 0.49} L ${center} ${safeSize * 0.61}" stroke="#08111a" stroke-width="${stroke * 0.72}" stroke-linecap="round" />
      <path d="M ${safeSize * 0.44} ${safeSize * 0.55} L ${safeSize * 0.56} ${safeSize * 0.55}" stroke="#08111a" stroke-width="${stroke * 0.72}" stroke-linecap="round" />
    </svg>
  `.trim();
}

export function createAppIcon(size = 128): NativeImage {
  const bundled = loadBundledIcon(["app-icon.png"], size);
  if (bundled) {
    return bundled;
  }

  const svg = buildLogoSvg(size);
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return nativeImage.createFromDataURL(dataUrl);
}

export function createTrayIcon(size = process.platform === "win32" ? 32 : 64): NativeImage {
  const bundled = loadBundledIcon(
    process.platform === "win32" ? ["app-icon.ico", "app-icon.png"] : ["app-icon.png"],
    size,
  );
  if (bundled) {
    return bundled;
  }

  return createAppIcon(size);
}
