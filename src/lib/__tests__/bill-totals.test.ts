import { describe, it, expect } from "vitest";
import {
  computeBillTotals,
  calculateDP,
  DEFAULT_CHARGE_CONFIG,
  type ChargeConfig,
} from "@/lib/settings-constants";

/**
 * Pengujian perhitungan tagihan & DP.
 *
 * Dua fungsi ini menentukan angka yang DIBAYAR tamu dan tampil di struk.
 * Kalau salah, tak ada pesan error — angkanya hanya keliru, dan baru
 * ketahuan saat ada yang protes.
 *
 * Yang diuji di sini adalah SIFAT yang harus selalu benar, bukan sekadar
 * mengulang isi rumusnya: tak ada tagihan negatif, DP tak melebihi total,
 * DP 100% benar-benar melunasi, dan label mengikuti komponen yang aktif.
 */

const cfg = (over: Partial<ChargeConfig> = {}): ChargeConfig => ({
  ...DEFAULT_CHARGE_CONFIG,
  ...over,
});

describe("computeBillTotals", () => {
  it("tanpa pajak & service, total = subtotal", () => {
    const r = computeBillTotals(100_000, cfg());
    expect(r.subtotal).toBe(100_000);
    expect(r.tax).toBe(0);
    expect(r.service).toBe(0);
    expect(r.total).toBe(100_000);
    // Tak ada komponen aktif → tak ada baris charge yang perlu dilabeli.
    expect(r.chargeLabel).toBe("");
  });

  it("pajak & service dihitung dari SUBTOTAL, bukan bertingkat", () => {
    const r = computeBillTotals(100_000, cfg({ taxPercent: 10, servicePercent: 5 }));
    expect(r.tax).toBe(10_000);
    // 5% dari subtotal (5.000), bukan dari subtotal+pajak (5.500).
    expect(r.service).toBe(5_000);
    expect(r.total).toBe(115_000);
  });

  it("komponen yang dimatikan tak ikut dihitung, nilai persennya tetap tersimpan", () => {
    const r = computeBillTotals(
      100_000,
      cfg({ taxPercent: 10, servicePercent: 5, taxEnabled: false })
    );
    expect(r.tax).toBe(0);
    expect(r.service).toBe(5_000);
    expect(r.chargeLabel).toBe("Service charge");
  });

  it("label mengikuti komponen yang aktif DAN bernilai", () => {
    expect(
      computeBillTotals(100_000, cfg({ taxPercent: 10, servicePercent: 5 }))
        .chargeLabel
    ).toBe("Tax & Service");
    expect(
      computeBillTotals(100_000, cfg({ taxPercent: 10 })).chargeLabel
    ).toBe("Tax");
    expect(
      computeBillTotals(100_000, cfg({ servicePercent: 5 })).chargeLabel
    ).toBe("Service charge");
  });

  it("subtotal negatif dijepit ke nol — tagihan tak boleh minus", () => {
    const r = computeBillTotals(-50_000, cfg({ taxPercent: 10 }));
    expect(r.subtotal).toBe(0);
    expect(r.total).toBe(0);
  });

  it("config kosong dianggap default, tidak melempar galat", () => {
    expect(() => computeBillTotals(100_000, null)).not.toThrow();
    expect(computeBillTotals(100_000, undefined).total).toBe(100_000);
  });

  it("config LAMA tanpa flag enabled dianggap AKTIF (kompatibel)", () => {
    // Baris config yang tersimpan sebelum flag ini ada tak punya
    // taxEnabled/serviceEnabled. Kalau undefined dianggap "mati", tagihan
    // seluruh bar mendadak kehilangan pajak.
    const lama = {
      taxPercent: 10,
      servicePercent: 5,
      rounding: "none",
    } as unknown as ChargeConfig;
    const r = computeBillTotals(100_000, lama);
    expect(r.tax).toBe(10_000);
    expect(r.service).toBe(5_000);
  });

  it("pembulatan ke atas & ke bawah bekerja per komponen", () => {
    // 7% dari 10.050 = 703,5
    const atas = computeBillTotals(10_050, cfg({ taxPercent: 7, rounding: "up" }));
    const bawah = computeBillTotals(10_050, cfg({ taxPercent: 7, rounding: "down" }));
    expect(atas.tax).toBe(704);
    expect(bawah.tax).toBe(703);
  });

  it("total SELALU sama dengan subtotal + tax + service", () => {
    const kasus: Array<[number, Partial<ChargeConfig>]> = [
      [1, { taxPercent: 11, servicePercent: 7 }],
      [999, { taxPercent: 10, servicePercent: 5, rounding: "up" }],
      [123_456, { taxPercent: 11, servicePercent: 6, rounding: "down" }],
      [7_777_777, { taxPercent: 10 }],
    ];
    for (const [sub, over] of kasus) {
      const r = computeBillTotals(sub, cfg(over));
      expect(r.total).toBe(r.subtotal + r.tax + r.service);
      expect(r.charge).toBe(r.tax + r.service);
    }
  });
});

describe("calculateDP", () => {
  it("persen nol atau negatif berarti tanpa DP", () => {
    expect(calculateDP(100_000, 0)).toBe(0);
    expect(calculateDP(100_000, -10)).toBe(0);
  });

  it("DP 100% melunasi PERSIS, tanpa dibulatkan ke atas", () => {
    // Dulu DP dihitung dari subtotal & dibulatkan, sehingga DP 100% tak
    // pernah benar-benar lunas — sisa sebesar tax & service menggantung.
    expect(calculateDP(115_049, 100)).toBe(115_049);
    expect(calculateDP(1, 100)).toBe(1);
  });

  it("DP sebagian dibulatkan ke ATAS ke kelipatan Rp100", () => {
    // 50% dari 115.049 = 57.524,5 → 57.600
    expect(calculateDP(115_049, 50)).toBe(57_600);
  });

  it("DP tak pernah melebihi total tagihan", () => {
    // 99% dari 150 = 148,5 → dibulatkan jadi 200, tapi harus dijepit ke 150.
    expect(calculateDP(150, 99)).toBe(150);
    for (const total of [1, 50, 99, 100, 101, 12_345]) {
      for (const pct of [1, 25, 50, 99, 100]) {
        expect(calculateDP(total, pct)).toBeLessThanOrEqual(total);
      }
    }
  });

  it("DP tak pernah negatif", () => {
    expect(calculateDP(-1000, 50)).toBe(0);
    expect(calculateDP(0, 50)).toBe(0);
  });
});
