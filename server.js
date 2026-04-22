'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express      = require('express');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { Resend }   = require('resend');
const path         = require('path');

const app      = express();
const PORT     = parseInt(process.env.PORT || '3000', 10);
const IS_PROD  = process.env.NODE_ENV === 'production';

/* ============================================================
   PROXY TRUST (required for accurate IP rate-limiting behind
   a reverse proxy / cloud provider)
   ============================================================ */
if (IS_PROD) app.set('trust proxy', 1);

/* ============================================================
   SECURITY HEADERS (helmet)
   ============================================================ */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc:   ["'self'"],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
      ...(IS_PROD ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

/* ============================================================
   BODY PARSING  (10 KB limit prevents large payload attacks)
   ============================================================ */
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

/* ============================================================
   RATE LIMITING
   ============================================================ */
// General: 300 requests / 15 min per IP
app.use(rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             300,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests. Please try again later.' },
}));

// Contact form: 5 submissions / 15 min per IP
const contactLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many messages sent. Please wait 15 minutes and try again.' },
});

/* ============================================================
   HTTPS REDIRECT (production only)
   ============================================================ */
if (IS_PROD) {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

/* ============================================================
   STATIC FILES
   ============================================================ */
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PROD ? '1d' : 0,
  etag:   true,
  index:  'index.html',
}));

/* ============================================================
   RESEND — HTTP EMAIL API
   ============================================================ */
const resend = new Resend(process.env.RESEND_API_KEY);

if (!process.env.RESEND_API_KEY) {
  console.warn('⚠ RESEND_API_KEY not set — email delivery will fail');
} else {
  console.log('✓ Resend email client initialised');
}

/* ============================================================
   CONTACT FORM — INPUT VALIDATION RULES
   ============================================================ */
const contactValidation = [
  body('firstName')
    .trim()
    .notEmpty().withMessage('First name is required.')
    .isLength({ max: 50 }).withMessage('First name is too long.')
    .escape(),

  body('lastName')
    .trim()
    .notEmpty().withMessage('Last name is required.')
    .isLength({ max: 50 }).withMessage('Last name is too long.')
    .escape(),

  body('email')
    .trim()
    .isEmail().withMessage('A valid email address is required.')
    .isLength({ max: 100 })
    .normalizeEmail(),

  body('phone')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 20 }).withMessage('Phone number is too long.')
    .matches(/^[\d\s+\-()\\.]+$/).withMessage('Invalid phone number format.'),

  body('enquiryType')
    .trim()
    .notEmpty().withMessage('Please select an enquiry type.')
    .isIn(['general', 'events', 'venues', 'schools', 'mental-health', 'sponsorship'])
    .withMessage('Invalid enquiry type.'),

  body('message')
    .trim()
    .notEmpty().withMessage('Message is required.')
    .isLength({ min: 10, max: 1000 })
    .withMessage('Message must be between 10 and 1000 characters.')
    .escape(),
];

/* ============================================================
   POST /api/contact
   ============================================================ */
app.post('/api/contact', contactLimiter, contactValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error:  errors.array()[0].msg,
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const { firstName, lastName, email, phone, enquiryType, message } = req.body;

  const enquiryLabels = {
    'general':      'General Enquiry',
    'events':       'Events',
    'venues':       'Venue Partnership',
    'schools':      'School Programs',
    'mental-health':'Mental Health Workshops',
    'sponsorship':  'Sponsorship',
  };
  const enquiryLabel = enquiryLabels[enquiryType] || enquiryType;

  try {
    // ── 1. Notification email to 1UP Connect ────────────────
    await resend.emails.send({
      from:     '1UP Connect Website <contact@1up-connect.com>',
      to:       ['contact@1up-connect.com'],
      reply_to: `${firstName} ${lastName} <${email}>`,
      subject:  `[1UP Connect] New ${enquiryLabel} enquiry — ${firstName} ${lastName}`,
      text: [
        `New contact form submission`,
        `──────────────────────────`,
        `Name:    ${firstName} ${lastName}`,
        `Email:   ${email}`,
        `Phone:   ${phone || 'Not provided'}`,
        `Type:    ${enquiryLabel}`,
        ``,
        `Message:`,
        message,
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0d1117;color:#ffffff;padding:32px;border-radius:8px">
          <div style="border-bottom:2px solid #29ABE2;padding-bottom:16px;margin-bottom:24px">
            <h2 style="margin:0;color:#29ABE2;font-size:22px">New Contact Form Submission</h2>
            <p style="margin:4px 0 0;color:#a0a8b0;font-size:14px">1UP Connect Website</p>
          </div>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#a0a8b0;width:100px">Name</td><td style="padding:8px 0;font-weight:600">${firstName} ${lastName}</td></tr>
            <tr><td style="padding:8px 0;color:#a0a8b0">Email</td><td style="padding:8px 0"><a href="mailto:${email}" style="color:#29ABE2">${email}</a></td></tr>
            <tr><td style="padding:8px 0;color:#a0a8b0">Phone</td><td style="padding:8px 0">${phone || 'Not provided'}</td></tr>
            <tr><td style="padding:8px 0;color:#a0a8b0">Enquiry</td><td style="padding:8px 0"><span style="background:rgba(41,171,226,0.15);color:#29ABE2;padding:3px 10px;border-radius:4px;font-size:13px;font-weight:700">${enquiryLabel}</span></td></tr>
          </table>
          <div style="margin-top:24px;background:#111820;border-left:3px solid #29ABE2;padding:16px;border-radius:0 6px 6px 0">
            <p style="margin:0 0 8px;color:#a0a8b0;font-size:13px;text-transform:uppercase;letter-spacing:1px">Message</p>
            <p style="margin:0;line-height:1.6;white-space:pre-wrap">${message}</p>
          </div>
          <p style="margin-top:24px;font-size:13px;color:#a0a8b0">Hit reply to respond directly to ${firstName}.</p>
        </div>
      `,
    });

    // ── 2. Auto-reply confirmation to the sender ─────────────
    await resend.emails.send({
      from:    '1UP Connect <contact@1up-connect.com>',
      to:      [`${firstName} ${lastName} <${email}>`],
      subject: `We got your message, ${firstName}! 👋`,
      text: [
        `Hey ${firstName},`,
        ``,
        `Thanks for reaching out to 1UP Connect! We've received your message and will get back to you soon.`,
        ``,
        `Here's a quick summary of what you sent us:`,
        `  Enquiry type: ${enquiryLabel}`,
        `  Message: ${message}`,
        ``,
        `In the meantime, follow us on Instagram @1upconnect for the latest events and updates.`,
        ``,
        `— The 1UP Connect Team`,
        `1up-connect.com`,
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f6f8;padding:32px 16px">

          <!-- Header -->
          <div style="background:linear-gradient(135deg,#0d1117 0%,#111820 100%);border-radius:12px 12px 0 0;padding:36px 32px;text-align:center">
            <img src="https://1up-connect.com/assets/Glow1UpConnect%20copy.png" alt="1UP Connect" width="200" style="display:block;margin:0 auto;max-width:200px" />
          </div>

          <!-- Body -->
          <div style="background:#ffffff;padding:36px 32px">
            <h2 style="margin:0 0 8px;color:#0d1117;font-size:22px;font-weight:700">Hey ${firstName}, we got your message!</h2>
            <p style="margin:0 0 24px;color:#555e6b;font-size:15px;line-height:1.7">Thanks for reaching out to 1UP Connect. We've received your enquiry and will get back to you within 1–2 business days.</p>

            <!-- Summary card -->
            <div style="background:#f4f6f8;border-radius:8px;padding:20px 24px;margin:0 0 24px">
              <p style="margin:0 0 14px;color:#29ABE2;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Your Enquiry Summary</p>
              <table style="width:100%;border-collapse:collapse">
                <tr>
                  <td style="padding:6px 0;color:#888f99;font-size:13px;width:110px;vertical-align:top">Enquiry type</td>
                  <td style="padding:6px 0;color:#0d1117;font-size:13px;font-weight:600">
                    <span style="background:#e8f6fd;color:#29ABE2;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:700">${enquiryLabel}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#888f99;font-size:13px;vertical-align:top">Message</td>
                  <td style="padding:6px 0;color:#333c48;font-size:13px;line-height:1.6">${message}</td>
                </tr>
              </table>
            </div>

            <!-- Divider -->
            <div style="border-top:1px solid #e8ebef;margin:24px 0"></div>

            <!-- Instagram CTA -->
            <p style="margin:0 0 20px;color:#555e6b;font-size:14px;line-height:1.7">In the meantime, follow us on Instagram for the latest events, tournaments, and updates from the community.</p>
            <div style="text-align:center;margin:0 0 8px">
              <a href="https://instagram.com/1upconnect" style="display:inline-block;background:#29ABE2;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:6px;letter-spacing:0.5px">
                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Instagram_icon.png/240px-Instagram_icon.png" alt="" width="16" height="16" style="vertical-align:middle;margin-right:8px;border-radius:3px" />
                Follow @1upconnect
              </a>
            </div>
          </div>

          <!-- Footer -->
          <div style="background:#0d1117;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center">
            <p style="margin:0 0 4px;color:#ffffff;font-size:13px;font-weight:600">1UP Connect &mdash; West Melbourne, VIC</p>
            <p style="margin:0;font-size:12px"><a href="https://1up-connect.com" style="color:#29ABE2;text-decoration:none">1up-connect.com</a></p>
          </div>

        </div>
      `,
    });

    console.log(JSON.stringify({
      event:       'contact_email_sent',
      enquiryType,
      timestamp:   new Date().toISOString(),
    }));

    res.json({ success: true, message: "Message received! We'll be in touch soon." });

  } catch (err) {
    console.error('EMAIL ERROR:', err.message, '| RESEND_API_KEY set:', !!process.env.RESEND_API_KEY);
    // Still respond success — don't expose email errors to the public
    res.json({ success: true, message: "Message received! We'll be in touch soon." });
  }
});

/* ============================================================
   HEALTH CHECK
   ============================================================ */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/* ============================================================
   SPA FALLBACK
   ============================================================ */
app.use((_req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ============================================================
   GLOBAL ERROR HANDLER
   ============================================================ */
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(JSON.stringify({
    event:   'unhandled_error',
    message: err.message,
    stack:   IS_PROD ? undefined : err.stack,
  }));
  res.status(500).json({ error: 'Internal server error.' });
});

/* ============================================================
   START
   ============================================================ */
app.listen(PORT, () => {
  console.log(`1UP Connect server running → http://localhost:${PORT} [${process.env.NODE_ENV || 'development'}]`);
});
