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
      from:     '1UP Connect Website <onboarding@resend.dev>',
      to:       ['info@1up-connect.com'],
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
      from:    '1UP Connect <onboarding@resend.dev>',
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
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0d1117;color:#ffffff;padding:32px;border-radius:8px">
          <div style="text-align:center;padding-bottom:24px;border-bottom:1px solid rgba(41,171,226,0.2);margin-bottom:24px">
            <h1 style="margin:0;color:#29ABE2;font-size:28px;font-style:italic;text-transform:uppercase;letter-spacing:2px">1UP CONNECT</h1>
          </div>
          <h2 style="color:#ffffff;font-size:20px;margin:0 0 12px">Hey ${firstName}! 👋</h2>
          <p style="color:#a0a8b0;line-height:1.7;margin:0 0 16px">Thanks for reaching out. We've received your message and will get back to you shortly.</p>
          <div style="background:#111820;border-left:3px solid #29ABE2;padding:16px;border-radius:0 6px 6px 0;margin:24px 0">
            <p style="margin:0 0 6px;color:#a0a8b0;font-size:12px;text-transform:uppercase;letter-spacing:1px">Your message</p>
            <p style="margin:0;line-height:1.6;white-space:pre-wrap;font-size:14px">${message}</p>
          </div>
          <p style="color:#a0a8b0;line-height:1.7;margin:0 0 24px">Follow us on Instagram <a href="https://instagram.com/1upconnect" style="color:#29ABE2">@1upconnect</a> for the latest events and updates.</p>
          <p style="color:#a0a8b0;font-size:13px;margin:0">— The 1UP Connect Team</p>
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
