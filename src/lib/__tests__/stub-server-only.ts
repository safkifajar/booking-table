/**
 * Pengganti paket `server-only` saat pengujian.
 *
 * Paket aslinya sengaja melempar galat begitu dimuat di luar Server
 * Component — itu penanda build, bukan perilaku yang perlu diuji. Tanpa
 * pengganti ini, fungsi hitung MURNI di berkas ber-penanda (mis.
 * computeSplit di revenue-split.ts) tak bisa diuji sama sekali.
 */
export {};
