import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Layani /favicon.ico.
 *
 * Aplikasi ini memakai src/app/icon.png (cara Next.js modern), tapi browser
 * TETAP meminta /favicon.ico sendiri — kebiasaan lama yang tak bisa
 * dimatikan. Permintaan itu jatuh ke halaman 404, dan di sana Next.js 16
 * melempar InvariantError ("client reference manifest for route /_not-found
 * does not exist") yang memenuhi Sentry.
 *
 * Ditulis sebagai route, bukan berkas src/app/favicon.ico: Turbopack menolak
 * ICO yang PNG-nya bukan RGBA, sedangkan ikon kita RGB. Cara ini juga
 * menghindari menambah berkas biner kembar ke repo.
 */
export const dynamic = "force-static";

export async function GET() {
  const file = await readFile(
    path.join(process.cwd(), "public", "icon-192.png")
  );
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "image/png",
      // Ikon jarang berubah; biarkan browser & CDN menyimpannya lama.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
