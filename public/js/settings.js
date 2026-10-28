// Settings Management
document.addEventListener("DOMContentLoaded", async () => {
  // ?store=<slug> mone rakhi, jate dashboard/settings link gulo ei dokane-i thake
  const explicit = new URLSearchParams(location.search).get("store");
  let storeSlug = explicit || localStorage.getItem("luxe_store_slug") || "";
  if (!storeSlug) {
    // link e slug na thakle owner er nijer dokan theke select kori — onner dokan kakhono na
    try {
      const res = await fetch("/api/stores/mine", {
        headers: { Authorization: "Bearer " + (localStorage.getItem("luxe_token") || "") },
      });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length) storeSlug = list[0].slug;
      }
    } catch {
      /* offline thakle context chara load hobe */
    }
  }
  if (storeSlug) {
    localStorage.setItem("luxe_store_slug", storeSlug);
    document.querySelectorAll('a[href^="/dashboard.html"], a[href^="/settings.html"]').forEach((a) => {
      const href = a.getAttribute("href");
      if (!href.includes("store=")) {
        a.href = href + (href.includes("?") ? "&" : "?") + "store=" + encodeURIComponent(storeSlug);
      }
    });
  }

  loadIdentity();
  if (!storeSlug) showStoreContext("কোনো দোকান নির্বাচন করা নেই — Portal থেকে নিজের দোকান বেছে নিন।", true);

  // Tab switching
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset.tab;

      // Update active states
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      tabPanes.forEach((pane) => {
        pane.classList.remove("active");
        if (pane.id === tabId) {
          pane.classList.add("active");
        }
      });
    });
  });

  // Load settings
  loadSettings();

  // Load currencies and languages
  loadCurrencies();
  loadLanguages();

  // Generate business hours
  generateBusinessHours();

  // Form submissions
  document.getElementById("basicForm").addEventListener("submit", handleBasicSubmit);
  document.getElementById("businessForm").addEventListener("submit", handleBusinessSubmit);
  document.getElementById("contactForm").addEventListener("submit", handleContactSubmit);
  document.getElementById("socialForm").addEventListener("submit", handleSocialSubmit);
  document.getElementById("seoForm").addEventListener("submit", handleSeoSubmit);

  // File uploads
  setupFileUpload("logo", "logoInput", "logoUploadArea", "logoImg", "logoPlaceholder", "deleteLogoBtn");
  setupFileUpload("favicon", "faviconInput", "faviconUploadArea", "faviconImg", "faviconPlaceholder", "deleteFaviconBtn");

  // Currency auto-detect
  document.getElementById("currencyCode").addEventListener("change", handleCurrencyChange);
});

// ek owner er onek dokan thakle ?store= / last-used slug diye kon dokan edit hobe bole dey
function authHeaders(extra = {}) {
  const token = localStorage.getItem("luxe_token");
  const storeSlug =
    new URLSearchParams(location.search).get("store") || localStorage.getItem("luxe_store_slug") || "";
  const headers = { ...extra, Authorization: `Bearer ${token}` };
  if (storeSlug) headers["x-store-slug"] = storeSlug;
  return headers;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, { ...options, headers: authHeaders(options.headers) });
  if (!response.ok) {
    let message = "";
    try {
      message = (await response.clone().json()).message || "";
    } catch {
      /* json na hole generic message */
    }
    const err = new Error(message || "Request failed");
    err.status = response.status;
    throw err;
  }
  return response;
}

// ei page store owner er nijer dokaner — super admin panel er kono link ekhane nei
async function loadIdentity() {
  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: "Bearer " + (localStorage.getItem("luxe_token") || "") },
    });
    if (!res.ok) return;
    const me = await res.json();
    const role = document.getElementById("sbRole");
    if (role) role.textContent = me.role === "superadmin" ? "Super Admin" : "দোকান মালিক";
    const name = document.getElementById("uName");
    if (name) name.textContent = me.name || "—";
    const email = document.getElementById("uEmail");
    if (email) email.textContent = me.email || me.phone || "—";
    const avatar = document.getElementById("avatar");
    if (avatar && me.name) avatar.textContent = String(me.name).trim()[0].toUpperCase();
  } catch {
    /* identity na pawa geleo settings load hobe */
  }
}

function showStoreContext(message, warn) {
  const el = document.getElementById("storeContext");
  if (!el) return;
  el.textContent = message;
  el.style.color = warn ? "#e1251b" : "";
}

// kon dokan er settings cholche seta sidebar ar topbar e dekhi
function applyStoreBrand(store) {
  if (!store || !store.name) return;
  const name = document.getElementById("sbName");
  if (name) name.textContent = store.name;
  const mark = document.getElementById("sbMark");
  if (mark) mark.textContent = String(store.name).trim()[0].toUpperCase();
  showStoreContext("দোকান: " + store.name + " — এই দোকানের সব সেটিংস এখান থেকে কন্ট্রোল করুন");
}

// Load settings from API
async function loadSettings() {
  try {
    const response = await apiFetch("/api/settings/admin");
    const settings = await response.json();
    applyStoreBrand(settings.store);
    populateForms(settings);
  } catch (err) {
    console.error("Error loading settings:", err);
    if (err.status === 401) {
      localStorage.removeItem("luxe_token");
      window.location.href = "/login.html?next=" + encodeURIComponent(location.pathname + location.search);
      return;
    }
    if (err.status === 403) {
      showStoreContext("এই দোকানের সেটিংস দেখার অনুমতি নেই — Portal থেকে নিজের দোকান বেছে নিন।", true);
    }
    showToast(err.message || "Failed to load settings", "error");
  }
}

// Populate forms with settings data
function populateForms(settings) {
  // Basic Settings
  if (settings.websiteTitle) document.getElementById("websiteTitle").value = settings.websiteTitle;
  if (settings.storeTitle) document.getElementById("storeTitle").value = settings.storeTitle;

  // Logo
  if (settings.logo) {
    const logoImg = document.getElementById("logoImg");
    const logoPlaceholder = document.getElementById("logoPlaceholder");
    const deleteLogoBtn = document.getElementById("deleteLogoBtn");

    logoImg.src = settings.logo;
    logoImg.style.display = "block";
    logoPlaceholder.style.display = "none";
    deleteLogoBtn.style.display = "inline-block";
  }

  // Favicon
  if (settings.favicon) {
    const faviconImg = document.getElementById("faviconImg");
    const faviconPlaceholder = document.getElementById("faviconPlaceholder");
    const deleteFaviconBtn = document.getElementById("deleteFaviconBtn");

    faviconImg.src = settings.favicon;
    faviconImg.style.display = "block";
    faviconPlaceholder.style.display = "none";
    deleteFaviconBtn.style.display = "inline-block";
  }

  // Google Location
  if (settings.googleLocation) {
    if (settings.googleLocation.address) document.getElementById("googleAddress").value = settings.googleLocation.address;
    if (settings.googleLocation.latitude) document.getElementById("googleLatitude").value = settings.googleLocation.latitude;
    if (settings.googleLocation.longitude) document.getElementById("googleLongitude").value = settings.googleLocation.longitude;
    if (settings.googleLocation.embedUrl) document.getElementById("googleEmbedUrl").value = settings.googleLocation.embedUrl;
  }

  // Business Settings
  if (settings.currency) {
    if (settings.currency.code) document.getElementById("currencyCode").value = settings.currency.code;
    if (settings.currency.symbol) document.getElementById("currencySymbol").value = settings.currency.symbol;
    if (settings.currency.position) document.getElementById("currencyPosition").value = settings.currency.position;
    if (settings.currency.autoCountry !== undefined) {
      document.getElementById("autoCountry").checked = settings.currency.autoCountry;
    }
  }

  if (settings.language) document.getElementById("language").value = settings.language;
  if (settings.footerCopyright) document.getElementById("footerCopyright").value = settings.footerCopyright;

  // Contact Settings
  if (settings.contact) {
    if (settings.contact.phone) document.getElementById("phone").value = settings.contact.phone;
    if (settings.contact.alternatePhone) document.getElementById("alternatePhone").value = settings.contact.alternatePhone;
    if (settings.contact.email) document.getElementById("email").value = settings.contact.email;
    if (settings.contact.alternateEmail) document.getElementById("alternateEmail").value = settings.contact.alternateEmail;
    if (settings.contact.address) document.getElementById("address").value = settings.contact.address;
    if (settings.contact.city) document.getElementById("city").value = settings.contact.city;
    if (settings.contact.state) document.getElementById("state").value = settings.contact.state;
    if (settings.contact.country) document.getElementById("country").value = settings.contact.country;
    if (settings.contact.postalCode) document.getElementById("postalCode").value = settings.contact.postalCode;

    // Business hours
    if (settings.contact.businessHours && settings.contact.businessHours.length > 0) {
      populateBusinessHours(settings.contact.businessHours);
    }
  }

  // Social Media
  if (settings.social) {
    if (settings.social.facebook) document.getElementById("facebook").value = settings.social.facebook;
    if (settings.social.instagram) document.getElementById("instagram").value = settings.social.instagram;
    if (settings.social.twitter) document.getElementById("twitter").value = settings.social.twitter;
    if (settings.social.youtube) document.getElementById("youtube").value = settings.social.youtube;
    if (settings.social.linkedin) document.getElementById("linkedin").value = settings.social.linkedin;
  }

  // SEO Settings
  if (settings.seo) {
    if (settings.seo.metaTitle) document.getElementById("metaTitle").value = settings.seo.metaTitle;
    if (settings.seo.metaDescription) document.getElementById("metaDescription").value = settings.seo.metaDescription;
    if (settings.seo.metaKeywords) document.getElementById("metaKeywords").value = settings.seo.metaKeywords;
  }
}

// Load currencies
async function loadCurrencies() {
  try {
    const response = await fetch("/api/settings/currencies");
    const currencies = await response.json();

    const select = document.getElementById("currencyCode");
    currencies.forEach((currency) => {
      const option = document.createElement("option");
      option.value = currency.code;
      option.textContent = `${currency.code} - ${currency.name} (${currency.symbol})`;
      option.dataset.symbol = currency.symbol;
      select.appendChild(option);
    });
  } catch (err) {
    console.error("Error loading currencies:", err);
  }
}

// Load languages
async function loadLanguages() {
  try {
    const response = await fetch("/api/settings/languages");
    const languages = await response.json();

    const select = document.getElementById("language");
    languages.forEach((lang) => {
      const option = document.createElement("option");
      option.value = lang.code;
      option.textContent = `${lang.name} (${lang.native})`;
      select.appendChild(option);
    });
  } catch (err) {
    console.error("Error loading languages:", err);
  }
}

// Generate business hours rows
function generateBusinessHours() {
  const container = document.getElementById("businessHoursContainer");
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  days.forEach((day) => {
    const row = document.createElement("div");
    row.className = "business-hours-row";
    row.dataset.day = day;

    row.innerHTML = `
      <label class="day-label">${day}</label>
      <input type="time" class="time-input" name="contact.businessHours[${day}].open" value="09:00" />
      <input type="time" class="time-input" name="contact.businessHours[${day}].close" value="18:00" />
      <label class="closed-check">
        <input type="checkbox" name="contact.businessHours[${day}].closed" />
        Closed
      </label>
    `;

    container.appendChild(row);

    // Add closed toggle functionality
    const closedCheck = row.querySelector('input[type="checkbox"]');
    closedCheck.addEventListener("change", () => {
      if (closedCheck.checked) {
        row.classList.add("closed");
      } else {
        row.classList.remove("closed");
      }
    });
  });
}

// Populate business hours from settings
function populateBusinessHours(hours) {
  hours.forEach((hour) => {
    const row = document.querySelector(`.business-hours-row[data-day="${hour.day}"]`);
    if (row) {
      const openInput = row.querySelector('input[name*="open"]');
      const closeInput = row.querySelector('input[name*="close"]');
      const closedCheck = row.querySelector('input[type="checkbox"]');

      if (openInput) openInput.value = hour.open || "09:00";
      if (closeInput) closeInput.value = hour.close || "18:00";
      if (closedCheck) {
        closedCheck.checked = hour.closed || false;
        if (hour.closed) row.classList.add("closed");
      }
    }
  });
}

// Setup file upload
function setupFileUpload(type, inputId, areaId, imgId, placeholderId, deleteBtnId) {
  const input = document.getElementById(inputId);
  const area = document.getElementById(areaId);
  const img = document.getElementById(imgId);
  const placeholder = document.getElementById(placeholderId);
  const deleteBtn = document.getElementById(deleteBtnId);
  const uploadBtn = document.getElementById(`upload${type.charAt(0).toUpperCase() + type.slice(1)}Btn`);

  // Click to upload
  uploadBtn.addEventListener("click", () => input.click());
  area.addEventListener("click", () => input.click());

  // Drag and drop
  area.addEventListener("dragover", (e) => {
    e.preventDefault();
    area.style.borderColor = "var(--gold)";
    area.style.background = "rgba(212, 175, 122, 0.08)";
  });

  area.addEventListener("dragleave", () => {
    area.style.borderColor = "";
    area.style.background = "";
  });

  area.addEventListener("drop", (e) => {
    e.preventDefault();
    area.style.borderColor = "";
    area.style.background = "";
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(type, file);
  });

  // File selection
  input.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) uploadFile(type, file);
  });

  // Delete
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this image?")) {
      await deleteFile(type);
    }
  });
}

// Upload file
async function uploadFile(type, file) {
  try {
    const formData = new FormData();
    formData.append(type, file);

    const response = await apiFetch(`/api/settings/admin/${type}`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    // Update UI
    const img = document.getElementById(`${type}Img`);
    const placeholder = document.getElementById(`${type}Placeholder`);
    const deleteBtn = document.getElementById(`delete${type.charAt(0).toUpperCase() + type.slice(1)}Btn`);

    img.src = data[type];
    img.style.display = "block";
    placeholder.style.display = "none";
    deleteBtn.style.display = "inline-block";

    showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} uploaded successfully`, "success");
  } catch (err) {
    console.error("Error uploading file:", err);
    showToast(err.message || "Failed to upload file", "error");
  }
}

// Delete file
async function deleteFile(type) {
  try {
    const response = await apiFetch(`/api/settings/admin/${type}`, {
      method: "DELETE",
    });

    // Update UI
    const img = document.getElementById(`${type}Img`);
    const placeholder = document.getElementById(`${type}Placeholder`);
    const deleteBtn = document.getElementById(`delete${type.charAt(0).toUpperCase() + type.slice(1)}Btn`);

    img.src = "";
    img.style.display = "none";
    placeholder.style.display = "block";
    deleteBtn.style.display = "none";

    showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted successfully`, "success");
  } catch (err) {
    console.error("Error deleting file:", err);
    showToast(err.message || "Failed to delete file", "error");
  }
}

// Handle currency change
function handleCurrencyChange() {
  const select = document.getElementById("currencyCode");
  const selectedOption = select.options[select.selectedIndex];
  const symbol = selectedOption.dataset.symbol;

  if (symbol) {
    document.getElementById("currencySymbol").value = symbol;
  }
}

// Collect business hours data
function collectBusinessHours() {
  const container = document.getElementById("businessHoursContainer");
  const rows = container.querySelectorAll(".business-hours-row");
  const hours = [];

  rows.forEach((row) => {
    const day = row.dataset.day;
    const open = row.querySelector('input[name*="open"]').value;
    const close = row.querySelector('input[name*="close"]').value;
    const closed = row.querySelector('input[type="checkbox"]').checked;

    hours.push({ day, open, close, closed });
  });

  return hours;
}

// Form handlers
async function handleBasicSubmit(e) {
  e.preventDefault();
  await saveSettings("basic");
}

async function handleBusinessSubmit(e) {
  e.preventDefault();
  await saveSettings("business");
}

async function handleContactSubmit(e) {
  e.preventDefault();
  await saveSettings("contact");
}

async function handleSocialSubmit(e) {
  e.preventDefault();
  await saveSettings("social");
}

async function handleSeoSubmit(e) {
  e.preventDefault();
  await saveSettings("seo");
}

// Save settings
async function saveSettings(type) {
  try {
    let data = {};

    switch (type) {
      case "basic":
        data = {
          websiteTitle: document.getElementById("websiteTitle").value,
          storeTitle: document.getElementById("storeTitle").value,
          googleLocation: {
            address: document.getElementById("googleAddress").value,
            latitude: parseFloat(document.getElementById("googleLatitude").value) || null,
            longitude: parseFloat(document.getElementById("googleLongitude").value) || null,
            embedUrl: document.getElementById("googleEmbedUrl").value,
          },
        };
        break;

      case "business":
        data = {
          currency: {
            code: document.getElementById("currencyCode").value,
            symbol: document.getElementById("currencySymbol").value,
            position: document.getElementById("currencyPosition").value,
            autoCountry: document.getElementById("autoCountry").checked,
          },
          language: document.getElementById("language").value,
          footerCopyright: document.getElementById("footerCopyright").value,
        };
        break;

      case "contact":
        data = {
          contact: {
            phone: document.getElementById("phone").value,
            alternatePhone: document.getElementById("alternatePhone").value,
            email: document.getElementById("email").value,
            alternateEmail: document.getElementById("alternateEmail").value,
            address: document.getElementById("address").value,
            city: document.getElementById("city").value,
            state: document.getElementById("state").value,
            country: document.getElementById("country").value,
            postalCode: document.getElementById("postalCode").value,
            businessHours: collectBusinessHours(),
          },
        };
        break;

      case "social":
        data = {
          social: {
            facebook: document.getElementById("facebook").value,
            instagram: document.getElementById("instagram").value,
            twitter: document.getElementById("twitter").value,
            youtube: document.getElementById("youtube").value,
            linkedin: document.getElementById("linkedin").value,
          },
        };
        break;

      case "seo":
        data = {
          seo: {
            metaTitle: document.getElementById("metaTitle").value,
            metaDescription: document.getElementById("metaDescription").value,
            metaKeywords: document.getElementById("metaKeywords").value,
          },
        };
        break;
    }

    await apiFetch("/api/settings/admin", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    showToast("Settings saved successfully", "success");
  } catch (err) {
    console.error("Error saving settings:", err);
    showToast(err.message || "Failed to save settings", "error");
  }
}

// Toast notification
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast show ${type}`;

  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// Logout
document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("luxe_token");
  localStorage.removeItem("luxe_store_slug");
  window.location.href = "/login.html";
});
