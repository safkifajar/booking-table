"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Plus,
  User,
  Shield,
  Briefcase,
  ChefHat,
  Loader2,
  X,
  ToggleLeft,
  ToggleRight,
  Mail,
  MailCheck,
  Send,
  Copy,
  CheckCircle2,
  MessageCircle,
  Link as LinkIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  inviteStaff,
  updateStaffRole,
  toggleStaffActive,
  resendInvite,
  type AdminStaffRow,
} from "@/lib/staff-actions";
import { getActionErrorMessage, cn, initials } from "@/lib/utils";

type Role = "waiter" | "cashier" | "manager" | "admin";

interface Props {
  barId: string;
  initialStaff: AdminStaffRow[];
  currentRole: string;
}

const ROLE_META: Record<
  Role,
  { label: string; icon: React.ReactNode; color: string; description: string }
> = {
  admin: {
    label: "Admin",
    icon: <Shield className="h-3.5 w-3.5" />,
    color: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    description: "Akses penuh — manage menu, banner, staff, lihat semua laporan",
  },
  manager: {
    label: "Manager",
    icon: <Briefcase className="h-3.5 w-3.5" />,
    color: "text-purple-400 bg-purple-500/10 border-purple-500/30",
    description: "Manage menu + banner + payment + close meja + laporan",
  },
  cashier: {
    label: "Kasir",
    icon: <User className="h-3.5 w-3.5" />,
    color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
    description: "Terima payment + close meja + lihat shift sendiri",
  },
  waiter: {
    label: "Waiter",
    icon: <ChefHat className="h-3.5 w-3.5" />,
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    description: "Queue order management + bantu pesan di meja",
  },
};

interface InviteSuccessInfo {
  email: string;
  displayName: string;
  setupUrl: string;
  emailSent: boolean;
}

export function StaffManager({ barId, initialStaff }: Props) {
  const [staff, setStaff] = React.useState(initialStaff);
  const [inviting, setInviting] = React.useState(false);
  const [resending, setResending] = React.useState<string | null>(null);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);
  const [changingRoleId, setChangingRoleId] = React.useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] =
    React.useState<InviteSuccessInfo | null>(null);
  const confirm = useConfirm();

  async function handleToggle(row: AdminStaffRow) {
    const newActive = !row.isActive;
    const ok = await confirm({
      title: newActive
        ? `Aktifkan ${row.displayName}?`
        : `Nonaktifkan ${row.displayName}?`,
      description: newActive
        ? "User akan bisa akses dashboard staff lagi."
        : "User tidak bisa akses dashboard staff sampai diaktifkan lagi.",
      confirmText: newActive ? "Aktifkan" : "Nonaktifkan",
      cancelText: "Batal",
      variant: newActive ? "default" : "danger",
    });
    if (!ok) return;

    setTogglingId(row.id);
    try {
      await toggleStaffActive(row.id, newActive);
      setStaff((arr) =>
        arr.map((s) => (s.id === row.id ? { ...s, isActive: newActive } : s))
      );
      toast.success(newActive ? "Staff diaktifkan" : "Staff dinonaktifkan");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal update status"));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleRoleChange(row: AdminStaffRow, newRole: Role) {
    if (row.role === newRole) return;
    setChangingRoleId(row.id);
    try {
      await updateStaffRole({ staffRoleId: row.id, role: newRole });
      setStaff((arr) =>
        arr.map((s) => (s.id === row.id ? { ...s, role: newRole } : s))
      );
      toast.success(`Role ${row.displayName} → ${ROLE_META[newRole].label}`);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal ubah role"));
    } finally {
      setChangingRoleId(null);
    }
  }

  async function handleResend(row: AdminStaffRow) {
    setResending(row.id);
    try {
      const result = await resendInvite(row.id);
      setInviteSuccess({
        email: row.email,
        displayName: row.displayName,
        setupUrl: result.setupUrl,
        emailSent: result.emailSent,
      });
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal kirim ulang"));
    } finally {
      setResending(null);
    }
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {staff.length} staff terdaftar ·{" "}
          {staff.filter((s) => s.isActive).length} aktif ·{" "}
          {staff.filter((s) => !s.hasPassword).length} pending setup
        </div>
        <Button variant="gold" size="sm" onClick={() => setInviting(true)}>
          <Plus className="h-3.5 w-3.5" />
          Invite Staff Baru
        </Button>
      </div>

      {staff.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Shield className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium mb-1">Belum ada staff</p>
          <p className="text-xs text-muted-foreground mb-4">
            Invite staff pertama dengan input email + nama + role. Email setup
            password akan dikirim otomatis.
          </p>
          <Button variant="outline" onClick={() => setInviting(true)}>
            <Plus className="h-4 w-4" />
            Invite Staff Baru
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Nama</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium w-40">Role</th>
                  <th className="px-4 py-3 font-medium w-28">Status</th>
                  <th className="px-4 py-3 font-medium w-36 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {staff.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30 transition">
                    {/* Nama */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar className="h-8 w-8 shrink-0">
                          {row.avatarUrl && (
                            <AvatarImage src={row.avatarUrl} alt={row.displayName} />
                          )}
                          <AvatarFallback className="text-[10px]">
                            {initials(row.displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {row.displayName}
                          </div>
                          {!row.hasPassword && (
                            <div className="text-[10px] text-amber-400 flex items-center gap-0.5 mt-0.5">
                              <Mail className="h-2.5 w-2.5" />
                              Belum set password
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-xs">
                      {row.email}
                    </td>

                    <td className="px-4 py-2.5">
                      <RoleSelect
                        currentRole={row.role}
                        onChange={(newRole) => handleRoleChange(row, newRole)}
                        disabled={changingRoleId === row.id}
                      />
                    </td>

                    <td className="px-4 py-2.5">
                      <Badge
                        variant={row.isActive ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {row.isActive ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!row.hasPassword && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResend(row)}
                            disabled={resending === row.id}
                            className="text-amber-400 hover:text-amber-300"
                            title="Kirim ulang email setup password"
                          >
                            {resending === row.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggle(row)}
                          disabled={togglingId === row.id}
                          className={cn(
                            row.isActive
                              ? "text-emerald-400 hover:text-emerald-300"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                          title={row.isActive ? "Nonaktifkan" : "Aktifkan"}
                        >
                          {togglingId === row.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : row.isActive ? (
                            <ToggleRight className="h-4 w-4" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {inviting && (
        <InviteStaffModal
          barId={barId}
          onClose={() => setInviting(false)}
          onInvited={(newRow, isNewUser, emailSent, setupUrl) => {
            setStaff((arr) => {
              const idx = arr.findIndex((s) => s.id === newRow.id);
              if (idx >= 0) {
                const next = [...arr];
                next[idx] = newRow;
                return next;
              }
              return [...arr, newRow];
            });
            setInviting(false);

            if (!isNewUser) {
              toast.success(
                `${newRow.displayName} sudah punya akun — role di-assign langsung tanpa email.`
              );
              return;
            }

            // User baru / belum set password → tampilkan modal sukses dengan
            // setup URL untuk admin copy/share manual
            if (setupUrl) {
              setInviteSuccess({
                email: newRow.email,
                displayName: newRow.displayName,
                setupUrl,
                emailSent,
              });
            }
          }}
        />
      )}

      {inviteSuccess && (
        <InviteSuccessModal
          info={inviteSuccess}
          onClose={() => setInviteSuccess(null)}
        />
      )}
    </>
  );
}

// ============================================================
// INVITE SUCCESS MODAL — tampil setelah invite sukses
// ============================================================

function InviteSuccessModal({
  info,
  onClose,
}: {
  info: InviteSuccessInfo;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(info.setupUrl);
      setCopied(true);
      toast.success("URL ter-copy");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Gagal copy — copy manual dari field");
    }
  }

  function handleWhatsApp() {
    const message = `Halo ${info.displayName}, kamu di-invite jadi staff SOHO Social House. Klik link berikut untuk set password & login:\n\n${info.setupUrl}\n\nLink valid 7 hari.`;
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center overflow-y-auto p-4">
      <Card className="w-full max-w-lg my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <h2 className="font-semibold">Invite Berhasil Dibuat</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted/60 transition"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Recipient info */}
          <div>
            <p className="text-sm">
              Untuk <strong>{info.displayName}</strong> ({info.email})
            </p>
          </div>

          {/* Email status */}
          <div
            className={cn(
              "rounded-md border p-3 text-xs",
              info.emailSent
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                : "border-amber-500/30 bg-amber-500/5 text-amber-400"
            )}
          >
            {info.emailSent ? (
              <div className="flex items-start gap-2">
                <MailCheck className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Email berhasil dikirim. Pastikan karyawan cek inbox/spam.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <Mail className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Email gagal dikirim (domain belum verified di Resend). Tidak
                  masalah — copy URL di bawah & kirim manual ke karyawan via
                  WhatsApp/SMS/dll.
                </span>
              </div>
            )}
          </div>

          {/* Setup URL */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
              <LinkIcon className="h-3 w-3" />
              Setup URL (valid 7 hari)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={info.setupUrl}
                readOnly
                onFocus={(e) => e.target.select()}
                className="flex-1 h-10 px-3 rounded-md bg-input border border-border text-xs font-mono focus:outline-none focus:border-primary/60"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="shrink-0"
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Kasih URL ini ke karyawan supaya mereka bisa set password & login.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button
              type="button"
              variant="default"
              onClick={handleWhatsApp}
              className="flex-1 bg-[#25D366] text-white hover:bg-[#1ea952] focus:bg-[#1ea952]"
            >
              <MessageCircle className="h-4 w-4" />
              Share via WhatsApp
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Selesai
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function RoleSelect({
  currentRole,
  onChange,
  disabled,
}: {
  currentRole: Role;
  onChange: (r: Role) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={currentRole}
      onChange={(e) => onChange(e.target.value as Role)}
      disabled={disabled}
      className={cn(
        "text-xs h-8 px-2 rounded-md border bg-input focus:outline-none focus:border-primary/60 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        ROLE_META[currentRole].color
      )}
    >
      {(["waiter", "cashier", "manager", "admin"] as Role[]).map((r) => (
        <option key={r} value={r} className="bg-background text-foreground">
          {ROLE_META[r].label}
        </option>
      ))}
    </select>
  );
}

// ============================================================
// INVITE MODAL
// ============================================================

function InviteStaffModal({
  barId,
  onClose,
  onInvited,
}: {
  barId: string;
  onClose: () => void;
  onInvited: (
    row: AdminStaffRow,
    isNewUser: boolean,
    emailSent: boolean,
    setupUrl: string | null
  ) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [role, setRole] = React.useState<Role>("waiter");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, loading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = displayName.trim();
    if (!cleanEmail.includes("@")) {
      toast.error("Email tidak valid");
      return;
    }
    if (cleanName.length < 2) {
      toast.error("Nama minimal 2 karakter");
      return;
    }

    setLoading(true);
    try {
      const result = await inviteStaff({
        barId,
        email: cleanEmail,
        displayName: cleanName,
        role,
      });

      onInvited(
        {
          id: result.staffRoleId,
          userId: "",
          displayName: cleanName,
          email: cleanEmail,
          avatarUrl: null,
          role,
          isActive: true,
          hasPassword: !result.isNewUser,
          createdAt: new Date(),
        },
        result.isNewUser,
        result.emailSent,
        result.setupUrl
      );
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal invite staff"));
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center overflow-y-auto p-4">
      <Card className="w-full max-w-lg my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Invite Staff Baru</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted/60 transition"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Info box */}
          <div className="flex items-start gap-2 p-3 rounded-md bg-primary/[0.05] border border-primary/20">
            <MailCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              Karyawan akan dapat email berisi link untuk set password. Mereka
              tidak perlu daftar manual di app.
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Email karyawan
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="andi@sohosocialhouse.com"
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Display name */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Nama panggilan
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              minLength={2}
              maxLength={40}
              placeholder="cth: Andi"
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Role picker */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Pilih role
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["waiter", "cashier", "manager", "admin"] as Role[]).map((r) => {
                const meta = ROLE_META[r];
                const isSelected = role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={cn(
                      "flex flex-col items-start gap-1 p-3 rounded-md border text-left transition",
                      isSelected
                        ? `${meta.color} border-2`
                        : "border-border hover:border-foreground/30"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "h-7 w-7 rounded-md flex items-center justify-center",
                          isSelected
                            ? meta.color
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {meta.icon}
                      </span>
                      <span className="text-sm font-semibold">{meta.label}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      {meta.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={loading}
            >
              Batal
            </Button>
            <Button type="submit" variant="gold" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Mengirim invite...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Kirim Invite
                </>
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
