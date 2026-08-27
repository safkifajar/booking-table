import { describe, it, expect } from "vitest";
import { computeSplit, type SchemeCategory } from "@/lib/revenue-split-math";

/**
 * Pengujian pembagian hasil pendapatan.
 *
 * Sifat yang WAJIB dijaga — tertulis di kode aslinya sebagai
 * "Σ selalu = serviceCollected": jumlah seluruh porsi harus sama persis
 * dengan service yang terkumpul. Kalau meleset satu rupiah pun, pembagian
 * ke pihak-pihak jadi tak seimbang dan selisihnya menumpuk tiap transaksi.
 *
 * Penampung sisa (remainder sink) ada justru untuk menyerap sisa pembulatan.
 * Pengujian di bawah menekan sifat itu dengan angka-angka yang pembagiannya
 * tak bulat.
 */

const kat = (
  name: string,
  percentMilli: number,
  over: Partial<SchemeCategory> = {}
): SchemeCategory => ({
  name,
  percentMilli,
  method: null,
  isRemainderSink: false,
  ...over,
});

/** 10% ditulis sebagai 10.000 permil-mili. */
const persen = (p: number) => p * 1000;

describe("computeSplit", () => {
  it("membagi sesuai persentase", () => {
    const hasil = computeSplit({
      base: 1_000_000,
      serviceCollected: 100_000,
      method: "qris",
      categories: [kat("A", persen(6)), kat("B", persen(4))],
    });
    expect(hasil).toEqual([
      { category: "A", amount: 60_000 },
      { category: "B", amount: 40_000 },
    ]);
  });

  it("penampung sisa menerima selisihnya, Σ = serviceCollected", () => {
    const hasil = computeSplit({
      base: 1_000_000,
      serviceCollected: 100_000,
      method: "qris",
      categories: [
        kat("A", persen(6)),
        kat("Sisa", 0, { isRemainderSink: true }),
      ],
    });
    const total = hasil.reduce((s, x) => s + x.amount, 0);
    expect(total).toBe(100_000);
    expect(hasil.find((x) => x.category === "Sisa")?.amount).toBe(40_000);
  });

  it("Σ tetap PERSIS meski pembagiannya tak bulat", () => {
    // Angka-angka yang sengaja menghasilkan pecahan saat dibagi.
    const kasus = [
      { base: 333_333, service: 33_333 },
      { base: 1, service: 1 },
      { base: 99_999, service: 9_999 },
      { base: 7_777_777, service: 777_777 },
      { base: 123_457, service: 12_345 },
    ];
    for (const { base, service } of kasus) {
      const hasil = computeSplit({
        base,
        serviceCollected: service,
        method: "qris",
        categories: [
          kat("A", persen(3.3)),
          kat("B", persen(2.7)),
          kat("Sisa", 0, { isRemainderSink: true }),
        ],
      });
      const total = hasil.reduce((s, x) => s + x.amount, 0);
      expect(total).toBe(service);
    }
  });

  it("penampung sisa bisa NEGATIF kalau alokasi melebihi yang terkumpul", () => {
    // Ini disengaja: Σ harus tetap = serviceCollected. Sisa negatif adalah
    // tanda skemanya salah setel, bukan sesuatu yang boleh disembunyikan
    // dengan menjepit ke nol — kalau dijepit, uangnya jadi tak seimbang.
    const hasil = computeSplit({
      base: 1_000_000,
      serviceCollected: 10_000,
      method: "qris",
      categories: [
        kat("A", persen(6)),
        kat("Sisa", 0, { isRemainderSink: true }),
      ],
    });
    expect(hasil.find((x) => x.category === "Sisa")?.amount).toBe(-50_000);
    expect(hasil.reduce((s, x) => s + x.amount, 0)).toBe(10_000);
  });

  it("kategori khusus metode lain dilewati", () => {
    const hasil = computeSplit({
      base: 1_000_000,
      serviceCollected: 100_000,
      method: "qris",
      categories: [
        kat("Umum", persen(5)),
        kat("Khusus tunai", persen(3), { method: "cash" }),
        kat("Khusus qris", persen(2), { method: "qris" }),
      ],
    });
    expect(hasil.map((x) => x.category)).toEqual(["Umum", "Khusus qris"]);
    expect(hasil.find((x) => x.category === "Khusus qris")?.amount).toBe(20_000);
  });

  it("tanpa penampung sisa, Σ mengikuti persentase apa adanya", () => {
    // Tanpa sink tak ada yang menyeimbangkan — memang begitu perilakunya,
    // dan justru itu alasan sink diperlukan.
    const hasil = computeSplit({
      base: 1_000_000,
      serviceCollected: 100_000,
      method: "qris",
      categories: [kat("A", persen(6))],
    });
    expect(hasil.reduce((s, x) => s + x.amount, 0)).toBe(60_000);
  });

  it("daftar kategori kosong menghasilkan daftar kosong, bukan galat", () => {
    expect(
      computeSplit({
        base: 1_000_000,
        serviceCollected: 100_000,
        method: "qris",
        categories: [],
      })
    ).toEqual([]);
  });

  it("base nol menghasilkan semua porsi nol", () => {
    const hasil = computeSplit({
      base: 0,
      serviceCollected: 0,
      method: "qris",
      categories: [
        kat("A", persen(6)),
        kat("Sisa", 0, { isRemainderSink: true }),
      ],
    });
    expect(hasil.every((x) => x.amount === 0)).toBe(true);
  });

  it("penampung sisa dihitung TERAKHIR walau ditulis pertama", () => {
    const hasil = computeSplit({
      base: 1_000_000,
      serviceCollected: 100_000,
      method: "qris",
      categories: [
        kat("Sisa", 0, { isRemainderSink: true }),
        kat("A", persen(6)),
      ],
    });
    // Urutan keluaran menaruh sink di akhir, dan nilainya sudah memperhitungkan A.
    expect(hasil[hasil.length - 1].category).toBe("Sisa");
    expect(hasil.find((x) => x.category === "Sisa")?.amount).toBe(40_000);
  });
});
