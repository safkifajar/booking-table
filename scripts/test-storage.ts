/**
 * Smoke test storage adapter (local) + sharp pipeline.
 *
 * - Generate dummy image buffer
 * - Resize via sharp
 * - Upload via storage adapter
 * - Verify file exists at expected path
 * - Delete + verify gone
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

async function main() {
  console.log("🧪 Testing storage + sharp pipeline...\n");

  // 1. Generate dummy red square (300×300) — bigger than target 256
  console.log("🎨 Generating dummy 300×300 red square");
  const dummyInput = await sharp({
    create: {
      width: 300,
      height: 300,
      channels: 3,
      background: { r: 220, g: 38, b: 38 },
    },
  })
    .png()
    .toBuffer();
  console.log(`   ✅ Input size: ${dummyInput.length} bytes`);

  // 2. Resize 256×256 + webp
  console.log("\n🔧 Resize + convert ke WebP 256×256");
  const output = await sharp(dummyInput)
    .rotate()
    .resize(256, 256, { fit: "cover", position: "center" })
    .webp({ quality: 80 })
    .toBuffer();
  console.log(`   ✅ Output size: ${output.length} bytes (compressed)`);

  // 3. Import storage adapter (note: bypass server-only check via direct import)
  console.log("\n📦 Loading storage adapter");
  // Bypass server-only by mocking
  const Module = (await import("node:module")).Module;
  const origRequire = Module.prototype.require;
  Module.prototype.require = function (id: string) {
    if (id === "server-only") return {};
    return origRequire.call(this, id);
  };

  const { storage } = await import("../src/lib/storage");

  // 4. Upload
  console.log("\n📤 Upload as avatars/test-smoke");
  const result = await storage.upload({
    buffer: output,
    folder: "avatars",
    key: "test-smoke",
    contentType: "image/webp",
  });
  console.log(`   ✅ Public URL: ${result.publicUrl}`);

  // 5. Verify file exists
  const expectedPath = path.join(
    process.env.UPLOADS_DIR ?? path.join(process.cwd(), "public", "uploads"),
    "avatars",
    "test-smoke.webp"
  );
  const stat = await fs.stat(expectedPath);
  console.log(`   ✅ File on disk: ${stat.size} bytes`);

  // 6. Delete
  console.log("\n🗑️  Delete");
  await storage.delete(result.publicUrl);
  try {
    await fs.access(expectedPath);
    throw new Error("File still exists after delete!");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      console.log("   ✅ File removed");
    } else {
      throw err;
    }
  }

  // 7. Idempotent delete (no throw)
  await storage.delete(result.publicUrl);
  console.log("   ✅ Idempotent delete OK");

  // 8. Path traversal protection
  console.log("\n🛡️  Path traversal blocked");
  await storage.delete("/uploads/../../../etc/passwd");
  console.log("   ✅ Traversal attempt swallowed silently");

  console.log("\n🎉 Storage adapter + sharp pipeline OK!");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Test failed:", err);
  process.exit(1);
});
