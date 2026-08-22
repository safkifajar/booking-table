/**
 * HTML email templates — branded SOHO Social House (dark + gold).
 *
 * Pakai inline styles karena banyak email client (Outlook, Gmail web)
 * tidak support <style> blocks. Inline CSS = compatible everywhere.
 *
 * Generate text fallback juga (plaintext version untuk client yang
 * tidak render HTML, plus untuk spam score).
 */

const COLORS = {
  bg: "#0a0a0a",
  card: "#131313",
  border: "#262626",
  text: "#f5f5f0",
  muted: "#a3a3a3",
  primary: "#e11d2a",
  primaryLight: "#ff4d57",
  primaryDark: "#b3141f",
};

interface MagicLinkInput {
  url: string;
  email: string;
  /** Berapa lama link valid, contoh: "10 menit" */
  expiresIn?: string;
}

/**
 * Magic link email — sign in tanpa password.
 */
export function magicLinkEmail(input: MagicLinkInput): { html: string; text: string } {
  const { url, email, expiresIn = "10 menit" } = input;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in ke booking-table</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};color:${COLORS.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${COLORS.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:520px;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">

          <!-- Header dengan gold accent -->
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <div style="display:inline-block;width:48px;height:1px;background:${COLORS.primary};vertical-align:middle;"></div>
              <span style="margin-left:12px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${COLORS.primary};font-weight:600;vertical-align:middle;">
                booking-table
              </span>
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td style="padding:8px 32px 16px 32px;">
              <h1 style="margin:0;font-size:28px;line-height:1.2;font-weight:700;color:${COLORS.text};">
                Sign in ke akunmu
              </h1>
            </td>
          </tr>

          <!-- Body text -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:15px;line-height:1.5;color:${COLORS.muted};">
                Klik tombol di bawah untuk sign in. Link ini valid selama <strong style="color:${COLORS.text};">${expiresIn}</strong> dan hanya bisa dipakai sekali.
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,${COLORS.primaryLight} 0%,${COLORS.primary} 50%,${COLORS.primaryDark} 100%);color:${COLORS.bg};text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">
                Sign in sekarang →
              </a>
            </td>
          </tr>

          <!-- Fallback URL -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0 0 8px 0;font-size:12px;color:${COLORS.muted};">
                Atau copy paste URL berikut ke browser:
              </p>
              <p style="margin:0;font-size:12px;color:${COLORS.primary};word-break:break-all;">
                <a href="${url}" style="color:${COLORS.primary};text-decoration:underline;">${url}</a>
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <div style="height:1px;background:${COLORS.border};"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px 32px;">
              <p style="margin:0 0 8px 0;font-size:12px;color:${COLORS.muted};">
                This email was sent to <strong style="color:${COLORS.text};">${email}</strong>.
              </p>
              <p style="margin:0;font-size:12px;color:${COLORS.muted};">
                If you didn't request this, you can safely ignore it — your account is secure.
              </p>
            </td>
          </tr>

        </table>

        <!-- Outside footer -->
        <p style="margin:24px 0 0 0;font-size:11px;color:${COLORS.muted};letter-spacing:1px;">
          © ${new Date().getFullYear()} booking-table · social table booking
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Sign in ke booking-table

Klik link di bawah untuk sign in (valid ${expiresIn}):

${url}

This email was sent to ${email}. If you didn't request this, you can ignore it.

© ${new Date().getFullYear()} booking-table`;

  return { html, text };
}

// ============================================================
// STAFF INVITE EMAIL
// ============================================================

interface StaffInviteInput {
  setupUrl: string;
  email: string;
  displayName: string;
  /** "Waiter" / "Kasir" / "Manager" / "Admin" — human readable */
  roleLabel: string;
  /** Nama venue/bar */
  barName: string;
  /** Berapa lama link valid, default "7 hari" */
  expiresIn?: string;
}

/**
 * Staff invitation email — admin invite karyawan baru.
 *
 * Karyawan klik link → set password → otomatis login → akses dashboard.
 */
export function staffInviteEmail(
  input: StaffInviteInput
): { html: string; text: string } {
  const {
    setupUrl,
    email,
    displayName,
    roleLabel,
    barName,
    expiresIn = "7 hari",
  } = input;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>You have been invited as ${roleLabel} at ${barName}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};color:${COLORS.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${COLORS.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:520px;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">

          <!-- Header dengan gold accent -->
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <div style="display:inline-block;width:48px;height:1px;background:${COLORS.primary};vertical-align:middle;"></div>
              <span style="margin-left:12px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${COLORS.primary};font-weight:600;vertical-align:middle;">
                ${barName}
              </span>
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td style="padding:8px 32px 8px 32px;">
              <h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:700;color:${COLORS.text};">
                Halo ${displayName},
              </h1>
              <p style="margin:8px 0 0 0;font-size:18px;line-height:1.4;color:${COLORS.primary};">
                You have been invited as <strong>${roleLabel}</strong>
              </p>
            </td>
          </tr>

          <!-- Body text -->
          <tr>
            <td style="padding:16px 32px 24px 32px;">
              <p style="margin:0 0 12px 0;font-size:15px;line-height:1.55;color:${COLORS.muted};">
                Selamat bergabung di tim ${barName}! Untuk mulai akses panel staff, klik tombol di bawah untuk set password kamu.
              </p>
              <p style="margin:0;font-size:14px;line-height:1.55;color:${COLORS.muted};">
                Link ini valid selama <strong style="color:${COLORS.text};">${expiresIn}</strong>.
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <a href="${setupUrl}" target="_blank" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,${COLORS.primaryLight} 0%,${COLORS.primary} 50%,${COLORS.primaryDark} 100%);color:${COLORS.bg};text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">
                Set Password & Login →
              </a>
            </td>
          </tr>

          <!-- Fallback URL -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0 0 8px 0;font-size:12px;color:${COLORS.muted};">
                Atau copy paste URL berikut ke browser:
              </p>
              <p style="margin:0;font-size:12px;color:${COLORS.primary};word-break:break-all;">
                <a href="${setupUrl}" style="color:${COLORS.primary};text-decoration:underline;">${setupUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <div style="height:1px;background:${COLORS.border};"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px 32px;">
              <p style="margin:0 0 8px 0;font-size:12px;color:${COLORS.muted};">
                This invitation was sent to <strong style="color:${COLORS.text};">${email}</strong>.
              </p>
              <p style="margin:0;font-size:12px;color:${COLORS.muted};">
                If you weren't expecting this invite, you can ignore this email.
              </p>
            </td>
          </tr>

        </table>

        <!-- Outside footer -->
        <p style="margin:24px 0 0 0;font-size:11px;color:${COLORS.muted};letter-spacing:1px;">
          © ${new Date().getFullYear()} ${barName}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Halo ${displayName},

You have been invited as ${roleLabel} at ${barName}.

Klik link di bawah untuk set password & login (valid ${expiresIn}):

${setupUrl}

This email was sent to ${email}. If this wasn't you, you can ignore it.

© ${new Date().getFullYear()} ${barName}`;

  return { html, text };
}

interface TableInviteInput {
  email: string;
  /** Nama orang yg mengajak/mengundang */
  inviterName: string;
  /** Label meja, mis "T4" */
  tableLabel: string;
  /** Nama venue */
  barName: string;
  /** Link ke session (mis. https://.../session/<id>) */
  link: string;
  /**
   * "joined" = friends, sudah otomatis gabung.
   * "invited" = invite_only, perlu terima undangan dulu.
   */
  mode: "joined" | "invited";
}

/**
 * Email ajak/undang gabung meja.
 * - mode "joined": "kamu sudah digabung" (friends auto-join).
 * - mode "invited": "kamu diundang, buka untuk terima" (invite_only).
 */
export function tableInviteEmail(
  input: TableInviteInput
): { html: string; text: string } {
  const { email, inviterName, tableLabel, barName, link, mode } = input;
  const joined = mode === "joined";
  const heading = joined
    ? `You have been added to table ${tableLabel}`
    : `You are invited to table ${tableLabel}`;
  const bodyLine = joined
    ? `<strong style="color:${COLORS.text};">${inviterName}</strong> added you to table <strong style="color:${COLORS.text};">${tableLabel}</strong> at ${barName}. You have already been added. Open to see the table.`
    : `<strong style="color:${COLORS.text};">${inviterName}</strong> invited you to table <strong style="color:${COLORS.text};">${tableLabel}</strong> at ${barName}. Open to <strong style="color:${COLORS.text};">accept the invite</strong>.`;
  const cta = joined ? "View table →" : "Accept invite →";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};color:${COLORS.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${COLORS.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:520px;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <div style="display:inline-block;width:48px;height:1px;background:${COLORS.primary};vertical-align:middle;"></div>
              <span style="margin-left:12px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${COLORS.primary};font-weight:600;vertical-align:middle;">
                ${barName}
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 8px 32px;">
              <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700;color:${COLORS.text};">
                ${heading}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 24px 32px;">
              <p style="margin:0;font-size:15px;line-height:1.55;color:${COLORS.muted};">
                ${bodyLine}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <a href="${link}" target="_blank" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,${COLORS.primaryLight} 0%,${COLORS.primary} 50%,${COLORS.primaryDark} 100%);color:${COLORS.bg};text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">
                ${cta}
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0 0 8px 0;font-size:12px;color:${COLORS.muted};">
                Atau buka URL berikut:
              </p>
              <p style="margin:0;font-size:12px;color:${COLORS.primary};word-break:break-all;">
                <a href="${link}" style="color:${COLORS.primary};text-decoration:underline;">${link}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px;">
              <div style="height:1px;background:${COLORS.border};"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px 32px;">
              <p style="margin:0;font-size:12px;color:${COLORS.muted};">
                This email was sent to <strong style="color:${COLORS.text};">${email}</strong>. If you don't recognise the sender, you can ignore it.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 0 0;font-size:11px;color:${COLORS.muted};letter-spacing:1px;">
          © ${new Date().getFullYear()} ${barName}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${heading}

${inviterName} ${joined ? "added you to" : "invited you to"} table ${tableLabel} at ${barName}.
${joined ? "You have already been added." : "Open to accept the invite."}

${link}

This email was sent to ${email}.

© ${new Date().getFullYear()} ${barName}`;

  return { html, text };
}

// ============================================================
// PASSWORD RESET EMAIL
// ============================================================

/**
 * Email tautan reset password.
 *
 * Mengembalikan `subject` juga (beda dari template lain yang subjek-nya
 * ditentukan pemanggil) supaya judul & isi email tetap sepasang.
 */
export function passwordResetEmail(
  url: string,
  expiresInMinutes: number
): { subject: string; html: string; text: string } {
  const subject = "Reset your SOHO password";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};color:${COLORS.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${COLORS.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:520px;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">

          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <div style="display:inline-block;width:48px;height:1px;background:${COLORS.primary};vertical-align:middle;"></div>
              <span style="margin-left:12px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${COLORS.primary};font-weight:600;vertical-align:middle;">
                SOHO Social House
              </span>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 16px 32px;">
              <h1 style="margin:0;font-size:24px;line-height:1.3;font-weight:700;color:${COLORS.text};">
                Reset your password
              </h1>
              <p style="margin:12px 0 0 0;font-size:14px;line-height:1.6;color:${COLORS.muted};">
                Tap the button below to choose a new password. This link works
                once and expires in ${expiresInMinutes} minutes.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 24px 32px;">
              <a href="${url}"
                 style="display:inline-block;padding:14px 28px;background:${COLORS.primary};color:#ffffff;text-decoration:none;border-radius:999px;font-size:15px;font-weight:600;">
                Choose a new password
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:${COLORS.muted};">
                If the button doesn't work, copy this link into your browser:
              </p>
              <p style="margin:8px 0 0 0;font-size:12px;line-height:1.5;word-break:break-all;color:${COLORS.primaryLight};">
                ${url}
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 32px 32px;border-top:1px solid ${COLORS.border};">
              <p style="margin:16px 0 0 0;font-size:12px;line-height:1.6;color:${COLORS.muted};">
                Didn't ask for this? You can ignore this email — your password
                stays the same.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Reset your SOHO password

Open this link to choose a new password:
${url}

The link works once and expires in ${expiresInMinutes} minutes.

Didn't ask for this? Ignore this email — your password stays the same.`;

  return { subject, html, text };
}
