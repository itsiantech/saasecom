/* Landing page content editor (superadmin → ল্যান্ডিং পেজ).
   Talks to /api/admin/settings/landing/content; the public page reads
   /api/public/landing. Loaded after admin.js so it can reuse the session token. */
(function () {
  "use strict";

  var root = document.getElementById("landingCms");
  var noteEl = document.getElementById("cmsNote");
  var saveBtn = document.getElementById("cmsSaveBtn");
  if (!root || !saveBtn) return;

  var TOKEN = localStorage.getItem("luxe_token");
  var state = { content: null, busy: false };
  saveBtn.disabled = true; // no silent clicks before the editor is ready
  var noteTimer = null;

  /* ---------------- helpers ---------------- */

  function h(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function say(message, type) {
    if (!noteEl) return;
    noteEl.textContent = message;
    noteEl.className = "theme-note " + (type || "");
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () {
      noteEl.textContent = "";
      noteEl.className = "theme-note";
    }, 3500);
  }

  async function api(url, options) {
    var opts = options || {};
    var res;
    try {
      res = await fetch(url, {
        method: opts.method || "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + TOKEN
        },
        body: opts.body
      });
    } catch (err) {
      throw new Error("সার্ভারের সাথে যোগাযোগ হচ্ছে না — সার্ভার চালু আছে কিনা দেখুন");
    }
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = null; }
    if (!res.ok) {
      var html = typeof text === "string" && /^\s*</.test(text);
      throw new Error(html ? "সার্ভার এই অনুরোধ চিনছে না — সার্ভার রিস্টার্ট করুন" : (data && data.message) || "Request fail hoyeche");
    }
    return data;
  }

  function switchEl(checked, onChange) {
    var label = h("label", "switch");
    var input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!checked;
    input.addEventListener("change", function () { onChange(input.checked); });
    label.appendChild(input);
    label.appendChild(h("span", "slider"));
    label.addEventListener("click", function (event) { event.stopPropagation(); });
    return label;
  }

  function fieldWrap(labelText, control, hint) {
    var wrap = h("div", "cms-field");
    if (labelText) wrap.appendChild(h("label", "", labelText));
    wrap.appendChild(control);
    if (hint) wrap.appendChild(h("p", "cms-hint", hint));
    return wrap;
  }

  function defValue(def) {
    if (def.type === "bool") return false;
    if (def.type === "color") return def.default || "#00cfc4";
    if (def.type === "select") return def.default || (def.options && def.options[0] ? def.options[0].value : "");
    return "";
  }

  function textControl(value, onInput, def) {
    var input = document.createElement(def && def.type === "url" ? "input" : "input");
    input.type = "text";
    if (def && def.max) input.maxLength = def.max;
    input.value = value == null ? "" : String(value);
    input.addEventListener("input", function () { onInput(input.value); });
    return input;
  }

  function textareaControl(value, onInput, def) {
    var area = document.createElement("textarea");
    if (def && def.max) area.maxLength = def.max;
    area.value = value == null ? "" : String(value);
    area.addEventListener("input", function () { onInput(area.value); });
    return area;
  }

  async function uploadAsset(file) {
    var form = new FormData();
    form.append("image", file);
    var res;
    try {
      res = await fetch("/api/admin/settings/landing/asset", {
        method: "POST",
        headers: { Authorization: "Bearer " + TOKEN },
        body: form
      });
    } catch (err) {
      throw new Error("সার্ভারের সাথে যোগাযোগ হচ্ছে না");
    }
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = null; }
    if (!res.ok || !data || !data.url) {
      throw new Error((data && data.message) || "ছবি আপলোড হয়নি");
    }
    return data.url;
  }

  function imageControl(value, onChange, def) {
    var wrap = h("div", "cms-image");
    var preview = h("div", "cms-image-preview");
    var input = textControl(value, function () {}, null);
    var tools = h("div", "cms-inline");

    function paint(url) {
      preview.textContent = "";
      if (url) {
        var img = document.createElement("img");
        img.src = url;
        img.alt = "";
        preview.appendChild(img);
      } else {
        preview.textContent = "কোনো ছবি নেই";
      }
      input.value = url || "";
    }

    input.addEventListener("input", function () {
      onChange(input.value.trim());
      paint(input.value.trim());
    });

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    var uploadLabel = h("label", "btn-mini link", "আপলোড");
    uploadLabel.setAttribute("for", "");
    uploadLabel.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", async function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      say("আপলোড হচ্ছে...", "");
      try {
        var url = await uploadAsset(file);
        onChange(url);
        paint(url);
        say("ছবি আপলোড হয়েছে — সেভ করতে ভুলবেন না", "ok");
      } catch (err) {
        say(err.message, "err");
      } finally {
        fileInput.value = "";
      }
    });

    var clearBtn = h("button", "btn-mini no", "সরান");
    clearBtn.type = "button";
    clearBtn.addEventListener("click", function () {
      onChange("");
      paint("");
    });

    tools.appendChild(uploadLabel);
    tools.appendChild(clearBtn);
    wrap.appendChild(preview);
    wrap.appendChild(fieldWrap(def && def.label, input, "URL বসাতে পারেন, বা ছবি আপলোড করুন"));
    wrap.appendChild(tools);
    wrap.appendChild(fileInput);
    paint(value || "");
    return wrap;
  }

  function boolControl(value, onChange, label) {
    var wrap = h("div", "cms-bool");
    wrap.appendChild(switchEl(value, onChange));
    wrap.appendChild(h("span", "", label || "চালু"));
    return wrap;
  }

  function selectControl(value, onChange, def) {
    var select = document.createElement("select");
    (def.options || []).forEach(function (option) {
      var node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      select.appendChild(node);
    });
    select.value = value || (def.options && def.options[0] ? def.options[0].value : "");
    select.addEventListener("change", function () { onChange(select.value); });
    return select;
  }

  function renderField(def, obj, onChange) {
    if (def.type === "bool") return boolControl(obj[def.k], function (v) { obj[def.k] = v; }, def.label);
    if (def.type === "textarea") return fieldWrap(def.label, textareaControl(obj[def.k], onChange, def), def.hint);
    if (def.type === "select") return fieldWrap(def.label, selectControl(obj[def.k], onChange, def), def.hint);
    if (def.type === "color") {
      var color = document.createElement("input");
      color.type = "color";
      color.value = /^#[0-9a-f]{6}$/i.test(obj[def.k] || "") ? obj[def.k] : "#00cfc4";
      color.addEventListener("input", function () { onChange(color.value); });
      return fieldWrap(def.label, color, def.hint);
    }
    if (def.type === "image") return imageControl(obj[def.k], onChange, def);
    return fieldWrap(def.label, textControl(obj[def.k], onChange, def), def.hint);
  }

  function makeItem(itemDef) {
    if (itemDef[0] && itemDef[0].string) return "";
    var item = {};
    itemDef.forEach(function (def) { item[def.k] = defValue(def); });
    return item;
  }

  function renderList(holder, arr, itemDef, options) {
    var opts = options || {};
    holder.textContent = "";
    var rows = h("div", "cms-rows");

    arr.forEach(function (item, index) {
      var row = h("div", "cms-row");
      var fields = h("div", "cms-row-fields");

      if (itemDef[0] && itemDef[0].string) {
        fields.appendChild(fieldWrap(opts.itemLabel || "মান", textControl(item, function (value) {
          arr[index] = value;
        }), null));
      } else {
        itemDef.forEach(function (def) {
          var current = item && typeof item === "object" ? item : {};
          fields.appendChild(renderField(def, current, function (value) { current[def.k] = value; }));
        });
      }

      row.appendChild(fields);
      var remove = h("button", "btn-mini no", "সরান");
      remove.type = "button";
      remove.addEventListener("click", function () {
        arr.splice(index, 1);
        renderList(holder, arr, itemDef, opts);
      });
      row.appendChild(remove);
      rows.appendChild(row);
    });

    holder.appendChild(rows);
    var add = h("button", "btn-mini link cms-add", opts.addLabel || "+ যোগ করুন");
    add.type = "button";
    add.addEventListener("click", function () {
      arr.push(opts.make ? opts.make() : makeItem(itemDef));
      renderList(holder, arr, itemDef, opts);
    });
    holder.appendChild(add);
  }

  function renderPlans(holder, arr) {
    holder.textContent = "";
    arr.forEach(function (plan, index) {
      var card = h("div", "cms-subcard");
      var head = h("div", "cms-subhead");
      head.appendChild(h("span", "", plan.name || "প্ল্যান " + (index + 1)));
      var remove = h("button", "btn-mini no", "প্ল্যান সরান");
      remove.type = "button";
      remove.addEventListener("click", function () {
        arr.splice(index, 1);
        renderPlans(holder, arr);
      });
      head.appendChild(remove);
      card.appendChild(head);

      var grid = h("div", "cms-grid");
      [
        { k: "tag", label: "ট্যাগ", max: 80 },
        { k: "name", label: "নাম", max: 60 },
        { k: "price", label: "দাম", max: 40 },
        { k: "per", label: "দামের পরে", max: 20 },
        { k: "ctaLabel", label: "বাটন লেখা", max: 60 },
        { k: "ctaHref", label: "বাটন লিংক", type: "url", max: 500 }
      ].forEach(function (def) {
        grid.appendChild(renderField(def, plan, function (value) { plan[def.k] = value; }));
      });
      card.appendChild(grid);
      card.appendChild(boolControl(plan.featured, function (v) { plan.featured = v; }, "হাইলাইট প্ল্যান (Pro স্টাইল)"));

      var featureLabel = h("p", "cms-hint", "ফিচার লাইন — চেক না থাকলে “নেই” হিসেবে দেখাবে");
      card.appendChild(featureLabel);
      var featureHolder = h("div");
      renderList(featureHolder, plan.features || (plan.features = []), [
        { k: "text", label: "লাইন", max: 120 },
        { k: "on", type: "bool", label: "আছে" }
      ], { addLabel: "+ ফিচার যোগ করুন" });
      card.appendChild(featureHolder);
      holder.appendChild(card);
    });

    var add = h("button", "btn-mini link cms-add", "+ নতুন প্ল্যান");
    add.type = "button";
    add.addEventListener("click", function () {
      arr.push({
        tag: "",
        name: "নতুন প্ল্যান",
        price: "৳ 0",
        per: "/মাস",
        featured: false,
        ctaLabel: "শুরু করুন",
        ctaHref: "/login.html",
        features: []
      });
      renderPlans(holder, arr);
    });
    holder.appendChild(add);
  }

  /* ---------------- schema ---------------- */

  var SCENE_OPTIONS = [
    { value: "ev", label: "গ্যাজেট প্লেসহোল্ডার" },
    { value: "of", label: "অর্গানিক প্লেসহোল্ডার" },
    { value: "fw", label: "ফ্যাশন প্লেসহোল্ডার" },
    { value: "pf", label: "পারফিউম প্লেসহোল্ডার" }
  ];

  var AFTER_OPTIONS = [
    { value: "start", label: "পেজের একদম শুরুতে" },
    { value: "hero", label: "হিরোর পরে" },
    { value: "features", label: "ফিচারের পরে" },
    { value: "pricing", label: "প্যাকেজের পরে" },
    { value: "steps", label: "৫ ধাপের পরে" },
    { value: "address", label: "ঠিকানার পরে" },
    { value: "designs", label: "ডিজাইনের পরে" },
    { value: "partners", label: "পার্টনারের পরে" },
    { value: "faq", label: "FAQ-এর পরে" },
    { value: "cta", label: "CTA-এর পরে" },
    { value: "end", label: "সবশেষে" }
  ];

  var LINK_ITEM = [
    { k: "label", label: "লেখা", max: 80 },
    { k: "href", label: "লিংক", type: "url", max: 500 }
  ];

  var CARDS = [
    {
      key: "brand",
      title: "ব্র্যান্ড",
      fields: [
        { k: "name", label: "ব্র্যান্ড নাম", max: 60, hint: "যেমন: Amar" },
        { k: "accent", label: "হাইলাইট অংশ", max: 60, hint: "কমলা রঙে দেখাবে" },
        { k: "logo", label: "লোগো", type: "image" },
        { k: "favicon", label: "ফ্যাভিকন", type: "image" }
      ]
    },
    {
      key: "meta",
      title: "পেজ টাইটেল ও ডেসক্রিপশন",
      fields: [
        { k: "title", label: "ব্রাউজার টাইটেল", max: 140 },
        { k: "description", label: "মেটা ডেসক্রিপশন", type: "textarea", max: 400 }
      ]
    },
    {
      key: "whatsapp",
      title: "WhatsApp বাটন",
      toggle: true,
      fields: [
        { k: "number", label: "নাম্বার (দেশের কোডসহ)", max: 24, hint: "যেমন: 8801712345678" },
        { k: "text", label: "প্রি-ফিল মেসেজ", max: 300 },
        { k: "label", label: "বাটনের লেখা", max: 40 }
      ]
    },
    {
      key: "nav",
      title: "নেভবার",
      toggle: true,
      fields: [
        { k: "loginLabel", label: "লগ-ইন লেখা", max: 40 },
        { k: "loginHref", label: "লগ-ইন লিংক", type: "url", max: 500 },
        { k: "showLogin", label: "লগ-ইন বাটন দেখান", type: "bool" },
        { k: "ctaLabel", label: "প্রধান বাটন লেখা", max: 40 },
        { k: "ctaHref", label: "প্রধান বাটন লিংক", type: "url", max: 500 },
        { k: "links", label: "মেনু লিংক", type: "list", item: LINK_ITEM, addLabel: "+ মেনু লিংক" }
      ]
    },
    {
      key: "hero",
      title: "হিরো",
      toggle: true,
      fields: [
        { k: "eyebrow", label: "উপরের ছোট লেখা", max: 80 },
        { k: "title", label: "টাইটেল", max: 140 },
        { k: "accent", label: "টাইটেল হাইলাইট", max: 140 },
        { k: "subtitle", label: "সাবটাইটেল", type: "textarea", max: 400 },
        { k: "primaryLabel", label: "প্রধান বাটন", max: 60 },
        { k: "primaryHref", label: "প্রধান বাটন লিংক", type: "url", max: 500 },
        { k: "secondaryLabel", label: "দ্বিতীয় বাটন", max: 60 },
        { k: "secondaryHref", label: "দ্বিতীয় বাটন লিংক", type: "url", max: 500 },
        { k: "note", label: "নিচের নোট", max: 240 },
        { k: "mockUrl", label: "মকআপ URL", max: 120 },
        { k: "badge", label: "মকআপ ব্যাজ", max: 80 },
        {
          k: "chips",
          label: "চিপ (সর্বোচ্চ ৩)",
          type: "list",
          item: [
            { k: "label", label: "নাম", max: 30 },
            { k: "color", label: "রঙ", type: "color" }
          ],
          addLabel: "+ চিপ"
        }
      ]
    },
    {
      key: "features",
      title: "ফিচার",
      toggle: true,
      fields: [
        { k: "eyebrow", label: "উপরের ছোট লেখা", max: 80 },
        { k: "title", label: "টাইটেল", max: 140 },
        { k: "accent", label: "টাইটেল হাইলাইট", max: 140 },
        { k: "subtitle", label: "সাবটাইটেল", max: 400 },
        {
          k: "items",
          label: "কার্ড",
          type: "list",
          item: [
            { k: "title", label: "শিরোনাম", max: 80 },
            { k: "text", label: "বর্ণনা", type: "textarea", max: 200 },
            { k: "wide", label: "বড় কার্ড (২ কলাম)", type: "bool" }
          ],
          addLabel: "+ ফিচার কার্ড"
        }
      ]
    },
    {
      key: "pricing",
      title: "প্যাকেজ",
      toggle: true,
      fields: [
        { k: "eyebrow", label: "উপরের ছোট লেখা", max: 80 },
        { k: "title", label: "টাইটেল", max: 140 },
        { k: "accent", label: "টাইটেল হাইলাইট", max: 140 },
        { k: "subtitle", label: "সাবটাইটেল", max: 400 },
        { k: "footer", label: "নিচের নোট", max: 240 },
        { k: "plans", label: "প্ল্যান", type: "plans" }
      ]
    },
    {
      key: "steps",
      title: "৫ ধাপ",
      toggle: true,
      fields: [
        { k: "eyebrow", label: "উপরের ছোট লেখা", max: 80 },
        { k: "title", label: "টাইটেল", max: 140 },
        { k: "accent", label: "টাইটেল হাইলাইট", max: 140 },
        { k: "titleEnd", label: "টাইটেলের শেষ অংশ", max: 140 },
        { k: "subtitle", label: "সাবটাইটেল", max: 400 },
        {
          k: "items",
          label: "ধাপ",
          type: "list",
          item: [
            { k: "title", label: "শিরোনাম", max: 80 },
            { k: "text", label: "বর্ণনা", max: 240 }
          ],
          addLabel: "+ ধাপ"
        }
      ]
    },
    {
      key: "address",
      title: "দোকানের ঠিকানা",
      toggle: true,
      fields: [
        { k: "eyebrow", label: "উপরের ছোট লেখা", max: 80 },
        { k: "title", label: "টাইটেল", max: 140 },
        { k: "accent", label: "টাইটেল হাইলাইট", max: 140 },
        { k: "subtitle", label: "বর্ণনা", type: "textarea", max: 400, hint: "[[luxe.shop/নাম]] দিলে চিপ দেখাবে" },
        { k: "ticks", label: "টিক লাইন", type: "list", item: [{ string: true }], addLabel: "+ লাইন" },
        { k: "cardLabel", label: "কার্ডের ছোট লেবেল", max: 40 },
        {
          k: "cardLines",
          label: "কার্ডের ঠিকানা",
          type: "list",
          item: [
            { k: "prefix", label: "শুরু", max: 120 },
            { k: "name", label: "slug", max: 80 }
          ],
          addLabel: "+ ঠিকানা"
        },
        { k: "cardNote", label: "কার্ডের নিচের নোট", max: 160 }
      ]
    },
    {
      key: "designs",
      title: "ডিজাইন",
      toggle: true,
      fields: [
        { k: "eyebrow", label: "উপরের ছোট লেখা", max: 80 },
        { k: "title", label: "টাইটেল", max: 140 },
        { k: "accent", label: "টাইটেল হাইলাইট", max: 140 },
        { k: "subtitle", label: "সাবটাইটেল", max: 400 },
        {
          k: "items",
          label: "কার্ড",
          type: "list",
          item: [
            { k: "name", label: "নাম", max: 80 },
            { k: "image", label: "স্ক্রিনশট", type: "image", hint: "খালি রাখলে প্লেসহোল্ডার দেখাবে" },
            { k: "alt", label: "ছবির Alt", max: 120 },
            { k: "scene", label: "প্লেসহোল্ডার ধরন", type: "select", options: SCENE_OPTIONS }
          ],
          addLabel: "+ ডিজাইন কার্ড",
          make: function () {
            return { name: "নতুন ডিজাইন", scene: "ev", image: "", alt: "" };
          }
        }
      ]
    },
    {
      key: "partners",
      title: "পার্টনার",
      toggle: true,
      fields: [
        { k: "eyebrow", label: "উপরের ছোট লেখা", max: 80 },
        { k: "title", label: "টাইটেল", max: 140 },
        { k: "accent", label: "টাইটেল হাইলাইট", max: 140 },
        { k: "subtitle", label: "সাবটাইটেল", max: 400 },
        { k: "items", label: "পার্টনার", type: "list", item: [{ string: true }], addLabel: "+ পার্টনার", itemLabel: "নাম" }
      ]
    },
    {
      key: "faq",
      title: "FAQ",
      toggle: true,
      fields: [
        { k: "eyebrow", label: "উপরের ছোট লেখা", max: 80 },
        { k: "title", label: "টাইটেল", max: 140 },
        { k: "accent", label: "টাইটেল হাইলাইট", max: 140 },
        { k: "subtitle", label: "সাবটাইটেল", max: 400 },
        {
          k: "items",
          label: "প্রশ্নোত্তর",
          type: "list",
          item: [
            { k: "q", label: "প্রশ্ন", max: 240 },
            { k: "a", label: "উত্তর", type: "textarea", max: 1000 }
          ],
          addLabel: "+ প্রশ্ন"
        }
      ]
    },
    {
      key: "cta",
      title: "CTA",
      toggle: true,
      fields: [
        { k: "title", label: "টাইটেল", max: 140 },
        { k: "accent", label: "টাইটেল হাইলাইট", max: 140 },
        { k: "subtitle", label: "সাবটাইটেল", max: 400 },
        { k: "primaryLabel", label: "প্রধান বাটন", max: 60 },
        { k: "primaryHref", label: "প্রধান বাটন লিংক", type: "url", max: 500 },
        { k: "secondaryLabel", label: "দ্বিতীয় বাটন", max: 60 },
        { k: "secondaryHref", label: "দ্বিতীয় বাটন লিংক", type: "url", max: 500 }
      ]
    },
    {
      key: "footer",
      title: "ফুটার",
      toggle: true,
      fields: [
        { k: "tagline", label: "ট্যাগলাইন", max: 240 },
        { k: "links", label: "ফুটার লিংক", type: "list", item: LINK_ITEM, addLabel: "+ ফুটার লিংক" },
        { k: "copyright", label: "কপিরাইট", max: 240 },
        { k: "note", label: "ডান দিকের লেখা", max: 240 }
      ]
    },
    { key: "extras", title: "কাস্টম সেকশন" }
  ];

  /* ---------------- rendering ---------------- */

  function renderCard(card) {
    var data = state.content[card.key];
    var box = h("div", "cms-card");
    var head = h("div", "cms-card-head");

    if (card.toggle && data) {
      head.appendChild(switchEl(data.enabled !== false, function (value) {
        data.enabled = value;
        tag.textContent = value ? "চালু" : "বন্ধ";
        tag.className = "cms-tag" + (value ? "" : " off");
      }));
    }

    var toggle = h("button", "cms-card-toggle");
    toggle.type = "button";
    toggle.appendChild(h("span", "cms-card-title", card.title));
    toggle.appendChild(h("span", "cms-chev", "▾"));
    head.appendChild(toggle);

    var tag;
    if (card.key === "extras") {
      tag = h("span", "cms-tag", ((state.content.extras || []).length || 0) + " টি");
    } else if (card.toggle && data) {
      tag = h("span", "cms-tag" + (data.enabled === false ? " off" : ""), data.enabled === false ? "বন্ধ" : "চালু");
    } else {
      tag = h("span", "cms-tag", "সবসময় চালু");
    }
    head.appendChild(tag);
    box.appendChild(head);

    var body = h("div", "cms-card-body");
    body.hidden = true;
    box.appendChild(body);

    toggle.addEventListener("click", function () {
      body.hidden = !body.hidden;
      box.classList.toggle("open", !body.hidden);
    });

    if (card.key === "extras") {
      renderExtras(body);
    } else {
      var grid = h("div", "cms-grid");
      (card.fields || []).forEach(function (def) {
        if (def.type === "list") {
          var holder = h("div", "cms-field");
          holder.style.gridColumn = "1 / -1";
          holder.appendChild(h("label", "", def.label));
          var listBox = h("div");
          renderList(listBox, data[def.k] || (data[def.k] = []), def.item, {
            addLabel: def.addLabel,
            itemLabel: def.itemLabel,
            make: def.make
          });
          holder.appendChild(listBox);
          grid.appendChild(holder);
        } else if (def.type === "plans") {
          var planHolder = h("div", "cms-field");
          planHolder.style.gridColumn = "1 / -1";
          planHolder.appendChild(h("label", "", def.label));
          var planBox = h("div");
          renderPlans(planBox, data[def.k] || (data[def.k] = []));
          planHolder.appendChild(planBox);
          grid.appendChild(planHolder);
        } else {
          grid.appendChild(renderField(def, data, function (value) { data[def.k] = value; }));
        }
      });
      body.appendChild(grid);
    }

    return box;
  }

  function renderExtras(holder) {
    holder.textContent = "";
    var list = state.content.extras || (state.content.extras = []);
    var rows = h("div", "cms-rows");

    list.forEach(function (extra, index) {
      var card = h("div", "cms-subcard");
      var head = h("div", "cms-subhead");
      var left = h("div", "cms-inline");
      left.appendChild(switchEl(extra.enabled !== false, function (value) { extra.enabled = value; }));
      left.appendChild(h("span", "", extra.title || "সেকশন " + (index + 1)));
      head.appendChild(left);
      var remove = h("button", "btn-mini no", "সরান");
      remove.type = "button";
      remove.addEventListener("click", function () {
        list.splice(index, 1);
        renderExtras(holder);
      });
      head.appendChild(remove);
      card.appendChild(head);

      var grid = h("div", "cms-grid");
      [
        { k: "title", label: "শিরোনাম", max: 140 },
        { k: "after", label: "কোথায় বসবে", type: "select", options: AFTER_OPTIONS },
        { k: "buttonLabel", label: "বাটন লেখা (ঐচ্ছিক)", max: 60 },
        { k: "buttonHref", label: "বাটন লিংক", type: "url", max: 500 },
        { k: "image", label: "ছবি (ঐচ্ছিক)", type: "image" },
        { k: "alt", label: "ছবির Alt", max: 120 }
      ].forEach(function (def) {
        grid.appendChild(renderField(def, extra, function (value) { extra[def.k] = value; }));
      });
      card.appendChild(grid);

      var bodyWrap = h("div", "cms-field");
      bodyWrap.appendChild(h("label", "", "বর্ণনা"));
      bodyWrap.appendChild(textareaControl(extra.body, function (value) { extra.body = value; }, { max: 2000 }));
      card.appendChild(bodyWrap);
      rows.appendChild(card);
    });

    holder.appendChild(rows);
    var add = h("button", "btn-mini link cms-add", "+ নতুন কাস্টম সেকশন");
    add.type = "button";
    add.addEventListener("click", function () {
      list.push({
        id: "x" + Date.now().toString(36),
        enabled: true,
        after: "end",
        title: "নতুন সেকশন",
        body: "",
        image: "",
        alt: "",
        buttonLabel: "",
        buttonHref: ""
      });
      renderExtras(holder);
    });
    holder.appendChild(add);
  }

  function render() {
    root.textContent = "";
    CARDS.forEach(function (card) {
      root.appendChild(renderCard(card));
    });
  }

  /* ---------------- boot ---------------- */

  async function load() {
    if (!TOKEN) {
      root.textContent = "লগ-ইন পাওয়া যায়নি — পেজ রিফ্রেশ করুন।";
      return;
    }
    try {
      var data = await api("/api/admin/settings/landing/content");
      state.content = data && data.content;
      if (!state.content) throw new Error("কনটেন্ট পাওয়া যায়নি");
      render();
      saveBtn.disabled = false;
    } catch (err) {
      root.textContent = err.message;
      say("এডিটর লোড হয়নি — " + err.message, "err");
    }
  }

  saveBtn.addEventListener("click", async function () {
    if (state.busy) return;
    if (!state.content) {
      say("এডিটর এখনো তৈরি হয়নি — একটু অপেক্ষা করে আবার চেষ্টা করুন", "err");
      return;
    }
    state.busy = true;
    saveBtn.disabled = true;
    saveBtn.textContent = "সেভ হচ্ছে...";
    try {
      var data = await api("/api/admin/settings/landing/content", {
        method: "PUT",
        body: JSON.stringify({ content: state.content })
      });
      if (data && data.content) state.content = data.content;
      say("সেভ হয়েছে — লাইভ পেজটি একবার রিফ্রেশ করুন (Ctrl+F5)", "ok");
    } catch (err) {
      say(err.message, "err");
    } finally {
      state.busy = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "ল্যান্ডিং সেভ করুন";
    }
  });

  load();
})();