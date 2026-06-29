// emailService.js
// ─────────────────────────────────────────────────────────────────────────────
// Nodemailer + SendGrid SMTP email service for Thah_Bowh's POS System.
// Handles OTP generation, hashed storage, expiry, verification, and two
// transactional emails (OTP email + password-changed confirmation).
// ─────────────────────────────────────────────────────────────────────────────

const nodemailer = require('nodemailer');
const crypto     = require('crypto');

// ── SendGrid SMTP transporter ─────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   'smtp.sendgrid.net',
  port:   587,
  secure: false,          // TLS via STARTTLS on port 587
  auth: {
    user: 'apikey',       // ALWAYS the literal string "apikey"
    pass: process.env.SENDGRID_API_KEY,
  },
});

// ── OTP in-memory store ───────────────────────────────────────────────────────
// Structure: Map { email => { otpHash, expiresAt, attempts } }
// In production replace with Redis: set(email, JSON.stringify(record), 'EX', 600)
const otpStore = new Map();

const OTP_EXPIRY_MS  = 10 * 60 * 1000;   // 10 minutes
const OTP_LENGTH     = 6;
const MAX_ATTEMPTS   = 5;
const OTP_SALT       = process.env.OTP_SALT || 'thahbowhs-pos-otp-salt';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashOTP(otp) {
  return crypto
    .createHmac('sha256', OTP_SALT)
    .update(otp)
    .digest('hex');
}

function generateOTP(email) {
  // Cryptographically random 6-digit code
  const otp = String(crypto.randomInt(100000, 999999));

  otpStore.set(email.toLowerCase(), {
    otpHash:   hashOTP(otp),
    expiresAt: Date.now() + OTP_EXPIRY_MS,
    attempts:  0,
  });

  return otp;
}

function verifyOTP(email, otp) {
  const key    = email.toLowerCase();
  const record = otpStore.get(key);

  if (!record) {
    return { valid: false, message: 'No reset request found. Please start again.' };
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(key);
    return { valid: false, message: 'Code has expired. Please request a new one.' };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(key);
    return { valid: false, message: 'Too many attempts. Please request a new code.' };
  }

  record.attempts += 1;

  if (hashOTP(otp) !== record.otpHash) {
    const remaining = MAX_ATTEMPTS - record.attempts;
    return { valid: false, message: `Incorrect code. ${remaining} attempt(s) remaining.` };
  }

  // ✅ Valid — delete immediately, single-use only
  otpStore.delete(key);
  return { valid: true, message: 'OK' };
}

function invalidateOTP(email) {
  otpStore.delete(email.toLowerCase());
}

// ── OTP Email ─────────────────────────────────────────────────────────────────

async function sendOTPEmail(toEmail, otp, firstName = 'there') {
  const subject = "🔐 Your Thah_Bowh's Password Reset Code";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#090909;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#090909;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
             style="background:#111111;border-radius:20px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;max-width:520px;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#FFB800,#ff6b00);padding:28px 40px;text-align:center;">
            <span style="font-size:20px;font-weight:800;color:#000;letter-spacing:3px;font-family:'Helvetica Neue',Arial;">
              THAH_BOWH'S POS
            </span>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="color:#888;font-size:14px;margin:0 0 6px;">
              Hi <strong style="color:#F0F0F0;">${firstName}</strong>,
            </p>
            <h1 style="color:#F0F0F0;font-size:22px;margin:0 0 14px;font-weight:700;">
              Password Reset Request
            </h1>
            <p style="color:#777;font-size:14px;line-height:1.7;margin:0 0 28px;">
              We received a request to reset your password. Use the code below.
              It expires in <strong style="color:#FFB800;">10 minutes</strong> and works only once.
            </p>

            <!-- OTP display -->
            <div style="background:#181818;border:1px solid rgba(255,184,0,0.3);border-radius:16px;
                        padding:28px 20px;text-align:center;margin-bottom:28px;">
              <p style="color:#555;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 14px;">
                Your verification code
              </p>
              <div style="letter-spacing:18px;font-size:44px;font-weight:800;color:#FFB800;
                          font-family:'Courier New',monospace;padding-left:18px;">
                ${otp}
              </div>
            </div>

            <!-- Security notes -->
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background:#181818;border-radius:12px;border:1px solid rgba(255,255,255,0.05);margin-bottom:28px;">
              <tr><td style="padding:18px 20px;">
                <p style="color:#555;font-size:12px;margin:0 0 7px;">⏳&nbsp; Expires in 10 minutes</p>
                <p style="color:#555;font-size:12px;margin:0 0 7px;">🔁&nbsp; Single-use — cannot be reused after verification</p>
                <p style="color:#555;font-size:12px;margin:0;">
                  🛡️&nbsp; Didn't request this?
                  <a href="mailto:support@thahbowhs.co.za" style="color:#FFB800;text-decoration:none;">
                    Contact us immediately
                  </a>
                </p>
              </td></tr>
            </table>

            <p style="color:#444;font-size:12px;text-align:center;margin:0;">
              Need help?
              <a href="mailto:support@thahbowhs.co.za" style="color:#FFB800;text-decoration:none;">
                support@thahbowhs.co.za
              </a>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0d0d0d;padding:18px 40px;border-top:1px solid rgba(255,255,255,0.05);">
            <p style="color:#333;font-size:11px;text-align:center;margin:0;">
              © ${new Date().getFullYear()} Thah_Bowh's POS System · Phuthaditjhaba, South Africa<br>
              This is an automated message — please do not reply directly.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi ${firstName},\n\nYour password reset code is: ${otp}\n\nThis code expires in 10 minutes and can only be used once.\n\nIf you didn't request this, please ignore this email.\n\n— Thah_Bowh's POS System`;

  try {
    await transporter.sendMail({
      from:    `"Thah_Bowh's POS" <${process.env.MAIL_SENDER}>`,
      to:      toEmail,
      subject,
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error('[emailService] OTP email failed:', err.message);
    return false;
  }
}

// ── Password Changed Confirmation Email ───────────────────────────────────────

async function sendPasswordChangedEmail(toEmail, firstName = 'there') {
  const subject = "✅ Your Thah_Bowh's Password Has Been Changed";
  const now     = new Date().toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#090909;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#090909;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
             style="background:#111111;border-radius:20px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;max-width:520px;">
        <tr>
          <td style="background:linear-gradient(135deg,#00E096,#00b371);padding:28px 40px;text-align:center;">
            <span style="font-size:20px;font-weight:800;color:#000;letter-spacing:3px;">THAH_BOWH'S POS</span>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="display:inline-block;width:64px;height:64px;border-radius:50%;
                          background:rgba(0,224,150,0.12);border:2px solid #00E096;
                          font-size:28px;line-height:64px;text-align:center;">✓</div>
            </div>
            <h1 style="color:#F0F0F0;font-size:22px;text-align:center;margin:0 0 12px;">
              Password Changed Successfully
            </h1>
            <p style="color:#777;font-size:14px;text-align:center;line-height:1.7;margin:0 0 28px;">
              Hi <strong style="color:#F0F0F0;">${firstName}</strong>, your password was updated on
              <strong style="color:#00E096;">${now}</strong>.
            </p>
            <div style="background:#181818;border:1px solid rgba(255,77,109,0.2);border-radius:12px;
                        padding:18px 20px;margin-bottom:24px;">
              <p style="color:#FF4D6D;font-size:13px;font-weight:700;margin:0 0 6px;">⚠️ Wasn't you?</p>
              <p style="color:#666;font-size:13px;line-height:1.6;margin:0;">
                Contact us immediately at
                <a href="mailto:support@thahbowhs.co.za" style="color:#FFB800;">support@thahbowhs.co.za</a>
                or reset your password again right away.
              </p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#0d0d0d;padding:18px 40px;border-top:1px solid rgba(255,255,255,0.05);">
            <p style="color:#333;font-size:11px;text-align:center;margin:0;">
              © ${new Date().getFullYear()} Thah_Bowh's POS System · Phuthaditjhaba, South Africa
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from:    `"Thah_Bowh's POS" <${process.env.MAIL_SENDER}>`,
      to:      toEmail,
      subject,
      html,
    });
    return true;
  } catch (err) {
    console.error('[emailService] Confirmation email failed:', err.message);
    return false;
  }
}

// ── Verify transporter on startup ─────────────────────────────────────────────
transporter.verify((err) => {
  if (err) {
    console.error('❌ [emailService] SendGrid SMTP connection failed:', err.message);
    console.error('   Check SENDGRID_API_KEY and MAIL_SENDER in your .env file.');
  } else {
    console.log('✅ [emailService] SendGrid SMTP ready');
  }
});

module.exports = { generateOTP, verifyOTP, invalidateOTP, sendOTPEmail, sendPasswordChangedEmail };