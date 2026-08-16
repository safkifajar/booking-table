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
  Pencil,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  inviteStaff,
  updateStaff,
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
    description: "Full access · manage menu, banners, staff, view all reports",
  },
  manager: {
    label: "Manager",
    icon: <Briefcase className="h-3.5 w-3.5" />,
    color: "text-purple-400 bg-purple-500/10 border-purple-500/30",
    description: "Manage menu + banners + payments + close tables + reports",
  },
  cashier: {
    label: "Cashier",
    icon: <User className="h-3.5 w-3.5" />,
    color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
    description: "Accept payments + close tables + view own shift",
  },
  waiter: {
    label: "Waiter",
    icon: <ChefHat className="h-3.5 w-3.5" />,
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    description: "Queue order management + help order at tables",
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
  const [editTarget, setEditTarget] = React.useState<AdminStaffRow | null>(null);
  const [inviteSuccess, setInviteSuccess] =
    React.useState<InviteSuccessInfo | null>(null);

  async function handleResend(row: AdminStaffRow) {
    setResending(row.id);
    try {
      const result = await resendInvite(row.id);
      // WAJIB: tanpa ini kegagalan (mis. user sudah punya password) tetap
      // membuka dialog sukses dengan URL kosong.
      if (!result.ok) {
        toast.error(result.error ?? "Failed to resend");
        return;
      }
      setInviteSuccess({
        email: row.email,
        displayName: row.displayName,
        setupUrl: result.setupUrl ?? "",
        emailSent: !!result.emailSent,
      });
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to resend"));
    } finally {
      setResending(null);
    }
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {staff.length} staff registered ·{" "}
          {staff.filter((s) => s.isActive).length} active ·{" "}
          {staff.filter((s) => !s.hasPassword).length} pending setup
        </div>
        <Button variant="gold" size="sm" onClick={() => setInviting(true)}>
          <Plus className="h-3.5 w-3.5" />
          Invite New Staff
        </Button>
      </div>

      {staff.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Shield className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium mb-1">No staff yet</p>
          <p className="text-xs text-muted-foreground mb-4">
            Invite your first staff with email + name + role. A password setup
            email will be sent automatically.
          </p>
          <Button variant="outline" onClick={() => setInviting(true)}>
            <Plus className="h-4 w-4" />
            Invite New Staff
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium w-40">Role</th>
                  <th className="px-4 py-3 font-medium w-28">Status</th>
                  <th className="px-4 py-3 font-medium w-36 text-right">Actions</th>
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
                              Password not set
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-xs">
                      {row.email}
                    </td>

                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium",
                          ROLE_META[row.role as Role].color
                        )}
                      >
                        {ROLE_META[row.role as Role].icon}
                        {ROLE_META[row.role as Role].label}
                      </span>
                    </td>

                    <td className="px-4 py-2.5">
                      <Badge
                        variant={row.isActive ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {row.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditTarget(row)}
                          title="Edit staff"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {!row.hasPassword && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResend(row)}
                            disabled={resending === row.id}
                            className="text-amber-400 hover:text-amber-300"
                            title="Resend password setup email"
                          >
                            {resending === row.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
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
                `${newRow.displayName} already has an account. Role assigned directly without email.`
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

      {editTarget && (
        <EditStaffModal
          row={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(updated) => {
            setStaff((arr) =>
              arr.map((s) => (s.id === updated.id ? updated : s))
            );
            setEditTarget(null);
          }}
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
      toast.success("URL copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy. Copy manually from the field");
    }
  }

  function handleWhatsApp() {
    const message = `Hi ${info.displayName}, you've been invited to be a staff member at SOHO Social House. Click the link below to set your password & log in:\n\n${info.setupUrl}\n\nLink valid for 7 days.`;
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
            <h2 className="font-semibold">Invite Created Successfully</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted/60 transition"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Recipient info */}
          <div>
            <p className="text-sm">
              For <strong>{info.displayName}</strong> ({info.email})
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
                  Email sent successfully. Make sure the employee checks their
                  inbox/spam.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <Mail className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Email failed to send (domain not yet verified in Resend). No
                  problem — copy the URL below & send it manually to the
                  employee via WhatsApp/SMS/etc.
                </span>
              </div>
            )}
          </div>

          {/* Setup URL */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
              <LinkIcon className="h-3 w-3" />
              Setup URL (valid 7 days)
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
              Give this URL to the employee so they can set their password & log
              in.
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
              Done
            </Button>
          </div>
        </div>
      </Card>
    </div>
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
      toast.error("Invalid email");
      return;
    }
    if (cleanName.length < 2) {
      toast.error("Name must be at least 2 characters");
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
      toast.error(getActionErrorMessage(err, "Failed to invite staff"));
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center overflow-y-auto p-4">
      <Card className="w-full max-w-lg my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Invite New Staff</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted/60 transition"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Info box */}
          <div className="flex items-start gap-2 p-3 rounded-md bg-primary/[0.05] border border-primary/20">
            <MailCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              The employee will receive an email with a link to set their
              password. They don&apos;t need to register manually in the app.
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Employee email
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
              Nickname
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              minLength={2}
              maxLength={40}
              placeholder="e.g. Andi"
              className="w-full h-11 px-3 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition"
            />
          </div>

          {/* Role picker */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Select role
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
              Cancel
            </Button>
            <Button type="submit" variant="gold" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending invite...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send Invite
                </>
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ============================================================
// EDIT STAFF MODAL — ubah nama, email, role (pola dialog Customer)
// ============================================================

function EditStaffModal({
  row,
  onClose,
  onSaved,
}: {
  row: AdminStaffRow;
  onClose: () => void;
  onSaved: (updated: AdminStaffRow) => void;
}) {
  const [displayName, setDisplayName] = React.useState(row.displayName);
  const [email, setEmail] = React.useState(row.email);
  const [role, setRole] = React.useState<Role>(row.role as Role);
  const [isActive, setIsActive] = React.useState(row.isActive);
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Validasi reset password (kalau diisi).
    if (password || confirmPassword) {
      if (password.length < 6) {
        toast.error("Password must be at least 6 characters");
        return;
      }
      if (password !== confirmPassword) {
        toast.error("Password confirmation does not match");
        return;
      }
    }
    setSaving(true);
    try {
      // WAJIB: tanpa ini kegagalan (mis. email sudah dipakai akun lain)
      // tetap tampil "Staff details updated" & menutup dialog.
      const res = await updateStaff({
        staffRoleId: row.id,
        displayName: displayName.trim(),
        email: email.trim(),
        role,
        isActive,
        password: password || undefined,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Failed to update staff");
        setSaving(false);
        return;
      }
      toast.success("Staff details updated");
      onSaved({
        ...row,
        displayName: displayName.trim(),
        email: email.trim(),
        role,
        isActive,
        // Password baru → user dianggap sudah punya password.
        hasPassword: password ? true : row.hasPassword,
      });
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to update staff"));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Staff</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={80}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={120}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">
              Role
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["waiter", "cashier", "manager", "admin"] as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-left transition",
                    role === r
                      ? ROLE_META[r].color
                      : "border-border text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  {ROLE_META[r].icon}
                  {ROLE_META[r].label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {ROLE_META[role].description}
            </p>
          </div>

          {/* Status aktif */}
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">
              Status
            </label>
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition",
                isActive
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              )}
            >
              <span>{isActive ? "Active" : "Inactive"}</span>
              {isActive ? (
                <ToggleRight className="h-5 w-5" />
              ) : (
                <ToggleLeft className="h-5 w-5" />
              )}
            </button>
          </div>

          {/* Reset password (opsional) */}
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
            <p className="text-xs font-medium">Reset password (optional)</p>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Leave blank if you don&apos;t want to change the password.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              minLength={6}
              maxLength={100}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              minLength={6}
              maxLength={100}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
