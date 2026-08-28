/**
 * Bangkitkan docs/schema.md dari database yang sedang berjalan.
 *
 * Jalankan:  npm run docs:schema
 *
 * DITULIS SEBAGAI PEMBANGKIT, bukan dokumen manual. Versi lama ditulis
 * tangan lalu ditinggalkan — ia masih menggambarkan 13 tabel era Supabase
 * sementara skema yang berlaku sudah 45 tabel. Dokumen yang salah lebih
 * berbahaya daripada tak ada dokumen, karena orang memercayainya.
 *
 * Sumbernya database lokal (bukan berkas skema Drizzle) supaya yang
 * terdokumentasi adalah keadaan SESUNGGUHNYA — termasuk index & constraint
 * yang dibuat lewat SQL migrasi manual, yang tak terlihat di berkas Drizzle.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import postgres from "postgres";

interface Kolom {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
}

interface Fk {
  table_name: string;
  column_name: string;
  ref_table: string;
  ref_column: string;
  delete_rule: string;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tidak ada di .env.local");
  const sql = postgres(url, { max: 1 });

  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`;

  const columns = await sql<Kolom[]>`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position`;

  const fks = await sql<Fk[]>`
    SELECT tc.table_name, kcu.column_name,
           ccu.table_name AS ref_table, ccu.column_name AS ref_column,
           rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name`;

  const enums = await sql<{ typname: string; nilai: string[] }[]>`
    SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS nilai
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    GROUP BY t.typname ORDER BY t.typname`;

  const indexes = await sql<{ tablename: string; indexdef: string }[]>`
    SELECT tablename, indexdef FROM pg_indexes
    WHERE schemaname = 'public' ORDER BY tablename, indexname`;

  const kolomPer = new Map<string, Kolom[]>();
  for (const c of columns) {
    const arr = kolomPer.get(c.table_name) ?? [];
    arr.push(c);
    kolomPer.set(c.table_name, arr);
  }
  const fkPer = new Map<string, Fk[]>();
  for (const f of fks) {
    const arr = fkPer.get(f.table_name) ?? [];
    arr.push(f);
    fkPer.set(f.table_name, arr);
  }
  const idxPer = new Map<string, string[]>();
  for (const i of indexes) {
    // PRIMARY KEY sudah terlihat dari kolomnya — tak perlu diulang.
    if (i.indexdef.includes("_pkey")) continue;
    const arr = idxPer.get(i.tablename) ?? [];
    arr.push(i.indexdef);
    idxPer.set(i.tablename, arr);
  }

  /** Nama tipe yang ringkas & bisa dibaca. */
  function tipe(c: Kolom): string {
    if (c.data_type === "USER-DEFINED") return `${c.udt_name} (enum)`;
    if (c.data_type === "timestamp with time zone") return "timestamptz";
    if (c.data_type === "timestamp without time zone") return "timestamp";
    if (c.data_type === "character varying") return "varchar";
    if (c.data_type === "ARRAY") return `${c.udt_name.replace(/^_/, "")}[]`;
    return c.data_type;
  }

  const baris: string[] = [];
  baris.push("# Skema Database — Booking Table (SOHO Social House)");
  baris.push("");
  baris.push(
    "> **Berkas ini DIBANGKITKAN OTOMATIS.** Jangan disunting manual —"
  );
  baris.push(
    "> perubahannya akan tertimpa. Jalankan `npm run docs:schema` setelah"
  );
  baris.push("> mengubah skema.");
  baris.push("");
  baris.push(
    `Ringkasan: **${tables.length} tabel**, **${enums.length} enum**, **${fks.length} foreign key**.`
  );
  baris.push("");
  baris.push(
    "Definisi skema ada di `src/lib/db/schema/` (Drizzle ORM). Migrasi SQL " +
      "di `drizzle/`. Dokumen ini dibaca dari database yang berjalan, jadi " +
      "ikut memuat index & constraint yang dibuat lewat SQL manual — yang " +
      "tak terlihat di berkas Drizzle."
  );
  baris.push("");

  // ENUM
  baris.push("## Enum");
  baris.push("");
  for (const e of enums) {
    baris.push(`- **${e.typname}** — ${e.nilai.map((v) => `\`${v}\``).join(", ")}`);
  }
  baris.push("");

  // TABEL
  baris.push("## Tabel");
  baris.push("");
  for (const t of tables) {
    const nama = t.table_name;
    baris.push(`### ${nama}`);
    baris.push("");
    baris.push("| Kolom | Tipe | Null | Default |");
    baris.push("|---|---|---|---|");
    for (const c of kolomPer.get(nama) ?? []) {
      const def = c.column_default
        ? `\`${c.column_default.replace(/::[a-z ]+$/i, "").slice(0, 40)}\``
        : "";
      baris.push(
        `| \`${c.column_name}\` | ${tipe(c)} | ${c.is_nullable === "YES" ? "ya" : "—"} | ${def} |`
      );
    }
    baris.push("");

    const relasi = fkPer.get(nama);
    if (relasi?.length) {
      baris.push("**Relasi:**");
      baris.push("");
      for (const f of relasi) {
        baris.push(
          `- \`${f.column_name}\` → \`${f.ref_table}.${f.ref_column}\` (ON DELETE ${f.delete_rule})`
        );
      }
      baris.push("");
    }

    const idx = idxPer.get(nama);
    if (idx?.length) {
      baris.push("**Index:**");
      baris.push("");
      for (const d of idx) {
        // Ringkas: buang awalan "CREATE INDEX ... ON public.<tabel> "
        const ringkas = d
          .replace(/^CREATE (UNIQUE )?INDEX (\S+) ON public\.\S+ USING \w+ /, "$1$2 ")
          .trim();
        baris.push(`- \`${ringkas}\``);
      }
      baris.push("");
    }
  }

  writeFileSync("docs/schema.md", baris.join("\n") + "\n", "utf8");
  console.log(
    `docs/schema.md diperbarui — ${tables.length} tabel, ${enums.length} enum, ${fks.length} relasi`
  );
  await sql.end();
}

main().catch((e) => {
  console.error("GAGAL:", e.message);
  process.exit(1);
});
