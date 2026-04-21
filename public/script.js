'use strict';

/* ============================================================
   CURSOR GLOW
   ============================================================ */
const cursorGlow = document.getElementById('cursor-glow');
if (cursorGlow) {
  document.addEventListener('mousemove', e => {
    cursorGlow.style.left = e.clientX + 'px';
    cursorGlow.style.top  = e.clientY + 'px';
  }, { passive: true });
}

/* ============================================================
   SCROLL FADE-UP ANIMATIONS
   ============================================================ */
const fadeObserver = new IntersectionObserver(
  entries => entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      fadeObserver.unobserve(entry.target);
    }
  }),
  { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
);
document.querySelectorAll('.fade-up').forEach(el => fadeObserver.observe(el));

/* ============================================================
   ACTIVE NAV LINK (intersection-based)
   ============================================================ */
const navLinks  = document.querySelectorAll('.nav-links a');
const sections  = document.querySelectorAll('section[id]');

const activeObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navLinks.forEach(link => {
          link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
        });
      }
    });
  },
  { threshold: 0.45 }
);
sections.forEach(s => activeObserver.observe(s));

/* ============================================================
   HAMBURGER MENU
   ============================================================ */
const navToggle = document.querySelector('.nav-toggle');
const navMenu   = document.getElementById('nav-menu');

if (navToggle && navMenu) {
  const closeMenu = () => {
    navToggle.setAttribute('aria-expanded', 'false');
    navMenu.classList.remove('open');
  };
  const openMenu = () => {
    navToggle.setAttribute('aria-expanded', 'true');
    navMenu.classList.add('open');
  };

  navToggle.addEventListener('click', () => {
    navToggle.getAttribute('aria-expanded') === 'true' ? closeMenu() : openMenu();
  });

  navMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));

  document.addEventListener('click', e => {
    if (!navToggle.contains(e.target) && !navMenu.contains(e.target)) closeMenu();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenu();
  });
}

/* ============================================================
   CONTACT FORM
   ============================================================ */
const form       = document.getElementById('contact-form');
const submitBtn  = document.getElementById('submit-btn');
const feedback   = document.getElementById('form-feedback');

function showFeedback(msg, type) {
  feedback.textContent = msg;
  feedback.className   = `form-feedback is-${type}`;
  feedback.hidden      = false;
  feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function clearFeedback() {
  feedback.hidden    = true;
  feedback.className = 'form-feedback';
  feedback.textContent = '';
}

function validateForm(data) {
  if (!data.firstName.trim())  return 'First name is required.';
  if (!data.lastName.trim())   return 'Last name is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return 'Please enter a valid email address.';
  if (!data.enquiryType)       return 'Please select an enquiry type.';
  if (data.message.trim().length < 10) return 'Message must be at least 10 characters.';
  return null;
}

function setBtnState(text, disabled) {
  submitBtn.querySelector('.btn-text').textContent = text;
  submitBtn.disabled = disabled;
}

if (form) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearFeedback();

    const data = {
      firstName:   form.firstName.value,
      lastName:    form.lastName.value,
      email:       form.email.value,
      phone:       form.phone.value,
      enquiryType: form.enquiryType.value,
      message:     form.message.value,
    };

    const err = validateForm(data);
    if (err) { showFeedback(err, 'error'); return; }

    setBtnState('Sending\u2026', true);

    try {
      const res  = await fetch('/api/contact', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      });

      const json = await res.json().catch(() => ({}));

      if (res.ok) {
        submitBtn.classList.add('success');
        setBtnState('Message Sent \u2713', true);
        showFeedback(json.message || "We've received your message and will be in touch soon!", 'success');
        form.reset();
        setTimeout(() => {
          submitBtn.classList.remove('success');
          setBtnState('Send Message \u2192', false);
          clearFeedback();
        }, 5000);
      } else {
        const msg = json.error || 'Something went wrong. Please try again.';
        showFeedback(msg, 'error');
        setBtnState('Send Message \u2192', false);
      }
    } catch {
      showFeedback('Network error. Please check your connection and try again.', 'error');
      setBtnState('Send Message \u2192', false);
    }
  });
}
