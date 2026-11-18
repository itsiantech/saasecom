/* ==========================================================================
   Applicant validation for retail EMI applications. BD phone + NID formats;
   which fields are mandatory comes from the store's InstallmentSettings.
   ========================================================================== */

const PHONE_RE = /^01[3-9]\d{8}$/;
const NID_RE = /^(\d{10}|\d{13}|\d{17})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function digitsOnly(value) {
  return String(value == null ? "" : value).replace(/[\s-]/g, "");
}

function validateApplicant(input = {}, settings = {}) {
  const require = settings.applicant || {};
  const name = text(input.name, 120);
  if (name.length < 2) return { error: "আবেদনকারীর নাম লিখুন" };

  const phone = digitsOnly(input.phone);
  if (!PHONE_RE.test(phone)) return { error: "সঠিক মোবাইল নাম্বার দিন (যেমন 01712345678)" };

  const email = text(input.email, 160).toLowerCase();
  if (email && !EMAIL_RE.test(email)) return { error: "ইমেইল ঠিকানা সঠিক নয়" };

  const nid = digitsOnly(input.nid);
  if ((require.requireNid || nid) && !NID_RE.test(nid)) {
    return { error: "সঠিক NID দিন (১০, ১৩ বা ১৭ ডিজিট)" };
  }

  const address = text(input.address, 400);
  if (require.requireAddress && address.length < 8) return { error: "সম্পূর্ণ ঠিকানা লিখুন" };

  const guarantorName = text(input.guarantorName, 120);
  const guarantorPhone = digitsOnly(input.guarantorPhone);
  const guarantorRelation = text(input.guarantorRelation, 60);
  if (require.requireGuarantor) {
    if (guarantorName.length < 2) return { error: "গ্যারান্টরের নাম লিখুন" };
    if (!PHONE_RE.test(guarantorPhone)) return { error: "গ্যারান্টরের সঠিক মোবাইল নাম্বার দিন" };
  } else if (guarantorPhone && !PHONE_RE.test(guarantorPhone)) {
    return { error: "গ্যারান্টরের মোবাইল নাম্বার সঠিক নয়" };
  }

  return {
    error: null,
    value: {
      name,
      phone,
      email,
      nid,
      address,
      guarantorName,
      guarantorPhone,
      guarantorRelation,
      note: text(input.note, 500),
    },
  };
}

module.exports = { PHONE_RE, NID_RE, validateApplicant };
