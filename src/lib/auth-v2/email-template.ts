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
  primary: "#c9a961",
  primaryLight: "#e6c478",
  primaryDark: "#a8893f",
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
<html lang="id">
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
                Email ini dikirim ke <strong style="color:${COLORS.text};">${email}</strong>.
              </p>
              <p style="margin:0;font-size:12px;color:${COLORS.muted};">
                Kalau bukan kamu yang request, abaikan saja — akunmu aman.
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

Email ini dikirim ke ${email}. Kalau bukan kamu yang request, abaikan saja.

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
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kamu di-invite jadi ${roleLabel} di ${barName}</title>
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
                Kamu di-invite jadi <strong>${roleLabel}</strong>
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
                Invitation ini dikirim ke <strong style="color:${COLORS.text};">${email}</strong>.
              </p>
              <p style="margin:0;font-size:12px;color:${COLORS.muted};">
                Kalau kamu merasa tidak diundang, abaikan email ini.
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

Kamu di-invite jadi ${roleLabel} di ${barName}.

Klik link di bawah untuk set password & login (valid ${expiresIn}):

${setupUrl}

Email ini dikirim ke ${email}. Kalau bukan kamu, abaikan saja.

© ${new Date().getFullYear()} ${barName}`;

  return { html, text };
}
