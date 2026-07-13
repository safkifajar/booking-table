/**
 * Bungkus gambar QR (data-URL) dalam frame branded SOHO untuk di-download:
 * kartu putih, header logo + nama SOHO, QR di tengah, nominal + label bayar
 * di bawah. Return PNG data-URL. Client-only (pakai Canvas + Image).
 */

const LOGO_SRC = "/logo-soho.jpeg";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function buildQrisFramePng(opts: {
  qrDataUrl: string;
  amountLabel: string;
  transactionId?: string;
}): Promise<string> {
  const { qrDataUrl, amountLabel, transactionId } = opts;

  // Ukuran kanvas (retina 2x untuk hasil tajam saat di-print / zoom).
  const scale = 2;
  const W = 480;
  const H = 640;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.scale(scale, scale);

  // Latar kartu putih dengan sedikit rounded (border tipis).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Pita atas warna primary SOHO (gold/maroon) sebagai aksen brand.
  const ACCENT = "#8b1a1a"; // maroon SOHO
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, 12);

  // Header: logo (bulat) + nama SOHO.
  const logoSize = 56;
  const logoX = (W - logoSize) / 2;
  const logoY = 40;
  try {
    const logo = await loadImage(LOGO_SRC);
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
    ctx.restore();
  } catch {
    // logo gagal → lewati, tetap render sisanya.
  }

  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.font = "700 30px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("SOHO", W / 2, logoY + logoSize + 34);

  ctx.fillStyle = "#6b7280";
  ctx.font = "500 13px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("Scan untuk bayar (QRIS)", W / 2, logoY + logoSize + 56);

  // QR di tengah dalam kotak putih dengan border.
  const qr = await loadImage(qrDataUrl);
  const qrSize = 260;
  const qrX = (W - qrSize) / 2;
  const qrY = 190;
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.strokeRect(qrX - 12, qrY - 12, qrSize + 24, qrSize + 24);
  ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);

  // Nominal (besar, warna aksen).
  ctx.fillStyle = ACCENT;
  ctx.font = "800 36px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(amountLabel, W / 2, qrY + qrSize + 62);

  // Label + transaction id.
  ctx.fillStyle = "#6b7280";
  ctx.font = "500 12px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("Total amount due", W / 2, qrY + qrSize + 84);

  if (transactionId) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "400 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`ID: ${transactionId}`, W / 2, H - 24);
  }

  return canvas.toDataURL("image/png");
}
