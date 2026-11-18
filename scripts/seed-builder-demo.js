/* ==========================================================================
   Demo PC Builder seed — a small, idempotent set of component products that
   is bound to ONE published builder template, so the builder section can be
   explored end to end (compatibility engine + installment pricing).

   Run:  npm run seed:builder -- --store=demo-store
   Safe to run twice: products/template/offers are matched by their natural
   key and updated in place. Nothing outside these 8 products is touched.
   ========================================================================== */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Store = require("../models/Store");
const Product = require("../models/Product");
const Category = require("../models/Category");
const SpecDefinition = require("../models/SpecDefinition");
const ProductCategory = require("../models/ProductCategory");
const BuilderTemplate = require("../models/BuilderTemplate");
const InstallmentSettings = require("../models/InstallmentSettings");
const InstallmentOffer = require("../models/InstallmentOffer");

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((row) => row.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};

const STORE_SLUG = arg("store", "demo-store");
const TEMPLATE_SLUG = "pc-builder";

const IMAGE_DIR = path.join(__dirname, "..", "public", "uploads", "demo", "builder");

function svg(label, sub, bg, fg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg}"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="640" height="640" fill="url(#g)"/>
  <rect x="48" y="48" width="544" height="544" rx="28" fill="none" stroke="${fg}" stroke-opacity="0.18" stroke-width="2"/>
  <text x="320" y="300" font-family="Segoe UI, Arial, sans-serif" font-size="72" font-weight="700" fill="${fg}" text-anchor="middle">${label}</text>
  <text x="320" y="356" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="${fg}" fill-opacity="0.65" text-anchor="middle">${sub}</text>
  <text x="320" y="548" font-family="Segoe UI, Arial, sans-serif" font-size="18" letter-spacing="3" fill="${fg}" fill-opacity="0.45" text-anchor="middle">DEMO COMPONENT</text>
</svg>
`;
}

function writeImages() {
  if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const rows = [
    ["cpu-intel.svg", svg("CPU", "Intel LGA1700", "#e8f0ff", "#1f3a68")],
    ["cpu-amd.svg", svg("CPU", "AMD AM5", "#ffe9ea", "#7a1f26")],
    ["motherboard-intel.svg", svg("MAINBOARD", "Intel LGA1700", "#eaf7ee", "#1d4d2c")],
    ["motherboard-amd.svg", svg("MAINBOARD", "AMD AM5", "#fff1e3", "#6b3a12")],
    ["ram.svg", svg("RAM", "DDR5 16GB", "#eef3ff", "#22345c")],
    ["ssd.svg", svg("SSD", "NVMe 1TB", "#f0edff", "#3b2a6b")],
    ["psu.svg", svg("PSU", "650W Bronze", "#f2f2f2", "#333333")],
    ["gpu.svg", svg("GPU", "RTX 4060 8GB", "#e9f8f6", "#0f4b42")],
    ["casing.svg", svg("CASING", "Mid Tower ATX", "#eef2f7", "#2b3a52")],
    ["monitor.svg", svg("MONITOR", "23.8-inch IPS FHD", "#eef6ff", "#1e3f66")],
    ["case-cooler.svg", svg("CASE FAN", "120mm ARGB", "#f3eefe", "#402a66")],
    ["keyboard.svg", svg("KEYBOARD", "USB / Mechanical", "#f5f0e8", "#5a4326")],
    ["mouse.svg", svg("MOUSE", "USB Gaming", "#eef7f2", "#1f4d3a")],
    ["wifi-lan.svg", svg("WIFI / LAN", "150Mbps · GbE", "#eaf3ff", "#1c3d5a")],
    ["ups.svg", svg("UPS", "650VA Backup", "#fff4e8", "#6b3a12")],
    ["category-pc.svg", svg("PC PARTS", "Demo category", "#eef1f7", "#243247")],
  ];
  for (const [file, content] of rows) fs.writeFileSync(path.join(IMAGE_DIR, file), content);
}

const image = (file) => `/uploads/demo/builder/${file}`;

// Specs are what the rule engine reads; keep the keys consistent between the
// products and the rules below.
const PRODUCTS = [
  {
    slug: "intel-core-i5-13400f",
    title: "Intel Core i5-13400F Processor",
    sku: "DEMO-CPU-I5-13400F",
    regularPrice: 24500,
    salePrice: 22900,
    stock: 12,
    soldCount: 40,
    image: "cpu-intel.svg",
    shortDescription: "10 cores / 16 threads, LGA1700 socket.",
    specs: { socket: "LGA1700", cores: 10, threads: 16, baseClock: "2.5 GHz", tdp: 65, pcie: "PCIe 5.0" },
  },
  {
    slug: "amd-ryzen-5-7600",
    title: "AMD Ryzen 5 7600 Processor",
    sku: "DEMO-CPU-R5-7600",
    regularPrice: 26500,
    salePrice: 24900,
    stock: 8,
    soldCount: 30,
    image: "cpu-amd.svg",
    shortDescription: "6 cores / 12 threads, AM5 socket.",
    specs: { socket: "AM5", cores: 6, threads: 12, baseClock: "3.8 GHz", tdp: 65, pcie: "PCIe 5.0" },
  },
  {
    slug: "msi-b760m-bomber-wifi",
    title: "MSI B760M Bomber WiFi DDR5 Motherboard",
    sku: "DEMO-MB-B760M",
    regularPrice: 18500,
    salePrice: 17200,
    stock: 9,
    soldCount: 25,
    image: "motherboard-intel.svg",
    shortDescription: "LGA1700, DDR5, mATX — pairs with the Intel CPU.",
    specs: { socket: "LGA1700", memory: "DDR5", formfactor: "mATX", m2slots: 2, wifi: "WiFi 6E" },
  },
  {
    slug: "msi-b650m-p-wifi",
    title: "MSI B650M-P WiFi DDR5 Motherboard",
    sku: "DEMO-MB-B650M",
    regularPrice: 17500,
    salePrice: 16400,
    stock: 7,
    soldCount: 22,
    image: "motherboard-amd.svg",
    shortDescription: "AM5, DDR5, mATX — pairs with the AMD CPU.",
    specs: { socket: "AM5", memory: "DDR5", formfactor: "mATX", m2slots: 2, wifi: "WiFi 6E" },
  },
  {
    slug: "corsair-vengeance-16gb-ddr5-5600",
    title: "Corsair Vengeance 16GB DDR5 5600MHz RAM",
    sku: "DEMO-RAM-16G",
    regularPrice: 7200,
    salePrice: 6600,
    stock: 25,
    soldCount: 60,
    image: "ram.svg",
    shortDescription: "Single 16GB DDR5 stick at 5600MHz.",
    specs: { memorytype: "DDR5", capacity: "16GB", speed: 5600, profile: "XMP 3.0" },
  },
  {
    slug: "samsung-980-1tb-nvme-ssd",
    title: "Samsung 980 1TB NVMe M.2 SSD",
    sku: "DEMO-SSD-1TB",
    regularPrice: 8900,
    salePrice: 8100,
    stock: 18,
    soldCount: 55,
    image: "ssd.svg",
    shortDescription: "1TB NVMe, up to 3500MB/s sequential read.",
    specs: { interface: "NVMe", capacity: "1TB", formfactor: "M.2 2280", readspeed: 3500 },
  },
  {
    slug: "asus-dual-rtx-4060-oc-8gb",
    title: "ASUS Dual GeForce RTX 4060 OC 8GB",
    sku: "DEMO-GPU-4060",
    regularPrice: 47500,
    salePrice: 44900,
    stock: 6,
    soldCount: 18,
    image: "gpu.svg",
    shortDescription: "8GB GDDR6, 227mm dual-fan card.",
    specs: { vram: "8GB", tdp: 115, lengthmm: 227, fans: 2 },
  },
  {
    slug: "cooler-master-mwe-650-v2",
    title: "Cooler Master MWE 650W V2 80+ Bronze PSU",
    sku: "DEMO-PSU-650",
    regularPrice: 6400,
    salePrice: 5800,
    stock: 15,
    soldCount: 35,
    image: "psu.svg",
    shortDescription: "650W, 80+ Bronze, non-modular.",
    specs: { wattage: 650, efficiency: "80+ Bronze", modular: "Non-modular" },
  },
];

async function resolveStore() {
  const store = await Store.findOne({ slug: STORE_SLUG });
  if (store) return store;
  const slugs = (await Store.find().select("slug").sort({ createdAt: 1 }).lean()).map((row) => row.slug);
  throw new Error(
    `Store "${STORE_SLUG}" pawa jayni. Available: ${slugs.join(", ") || "(none)"} — abar --store=<slug> diye run korun`
  );
}

async function grantFeatures(store) {
  const granted = new Set((store.featureOverrides && store.featureOverrides.granted) || []);
  const revoked = new Set((store.featureOverrides && store.featureOverrides.revoked) || []);
  for (const key of ["productBuilder", "installments"]) {
    granted.add(key);
    revoked.delete(key);
  }
  await Store.updateOne(
    { _id: store._id },
    {
      $set: {
        "featureOverrides.granted": [...granted],
        "featureOverrides.revoked": [...revoked],
        "featureOverrides.updatedAt": new Date(),
      },
    }
  );
  console.log("Features granted: productBuilder, installments");
}

async function upsertCategory(store) {
  const category = await Category.findOneAndUpdate(
    { store: store._id, slug: "pc-components" },
    {
      $set: {
        store: store._id,
        name: "PC Components",
        slug: "pc-components",
        parent: null,
        ancestors: [],
        level: 0,
        order: 0,
        image: image("category-pc.svg"),
        icon: { type: "none", value: "" },
        status: "published",
        isDemo: true,
      },
    },
    { upsert: true, returnDocument: "after" }
  );
  console.log(`Category ready: ${category.name} (${category.slug})`);
  return category;
}

// Specs keyed exactly like the products' specs, so the Add/Edit Product form
// shows these fields once "PC Components" is picked as the category.
const SPECS = [
  {
    key: "socket",
    label: "Socket",
    labelBn: "সকেট",
    type: "enum",
    enumValues: [{ value: "LGA1700", label: "LGA1700" }, { value: "AM5", label: "AM5" }],
  },
  {
    key: "memory",
    label: "Memory Support",
    labelBn: "মেমরি সাপোর্ট",
    type: "enum",
    enumValues: [{ value: "DDR4", label: "DDR4" }, { value: "DDR5", label: "DDR5" }],
  },
  {
    key: "memorytype",
    label: "Memory Type",
    labelBn: "মেমরি টাইপ",
    type: "enum",
    enumValues: [{ value: "DDR4", label: "DDR4" }, { value: "DDR5", label: "DDR5" }],
  },
  { key: "capacity", label: "Capacity", labelBn: "ক্যাপাসিটি", type: "text" },
  { key: "wattage", label: "Wattage", labelBn: "ওয়াট", type: "number", unit: "W" },
  { key: "tdp", label: "Power Draw (TDP)", labelBn: "বিদ্যুৎ ব্যবহার (TDP)", type: "number", unit: "W" },
  { key: "lengthmm", label: "Length", labelBn: "দৈর্ঘ্য", type: "number", unit: "mm" },
  { key: "vram", label: "VRAM", labelBn: "ভিডিও মেমরি", type: "text" },
  { key: "interface", label: "Interface", labelBn: "ইন্টারফেস", type: "text" },
  { key: "formfactor", label: "Form Factor", labelBn: "ফর্ম ফ্যাক্টর", type: "text" },
];

async function upsertSpecs(store, category) {
  for (const [index, spec] of SPECS.entries()) {
    await SpecDefinition.findOneAndUpdate(
      { store: store._id, category: category._id, key: spec.key },
      {
        $set: {
          store: store._id,
          category: category._id,
          key: spec.key,
          label: spec.label,
          labelBn: spec.labelBn || "",
          type: spec.type || "text",
          unit: spec.unit || "",
          enumValues: spec.enumValues || [],
          filterable: true,
          showInList: false,
          active: true,
          sortOrder: index,
        },
      },
      { upsert: true, returnDocument: "after" }
    );
  }
  console.log(`Spec definitions ready: ${SPECS.length} fields on ${category.name}`);
}

/* ------------------------------------------------------------------ *
 * Component showcase — casing, monitor, case cooling, peripherals,
 * network cards and UPS. Each one gets its own child category under
 * "PC Components" so builder slots can filter on the category and the
 * product form shows a small, relevant spec set.
 * ------------------------------------------------------------------ */
const COMPONENTS = [
  {
    slug: "casing",
    name: "Casing",
    image: "casing.svg",
    specs: [
      { key: "max_gpu_length", label: "Max GPU Length", labelBn: "সর্বোচ্চ GPU দৈর্ঘ্য", type: "number", unit: "mm" },
      {
        key: "form_factor",
        label: "Form Factor",
        labelBn: "ফর্ম ফ্যাক্টর",
        type: "enum",
        enumValues: [{ value: "ATX", label: "ATX" }, { value: "Micro-ATX", label: "Micro-ATX" }, { value: "ITX", label: "ITX" }],
      },
      { key: "side_panel", label: "Side Panel", labelBn: "সাইড প্যানেল", type: "text" },
    ],
    products: [
      {
        slug: "value-top-vt-128-casing",
        title: "Value Top VT-128 Mid Tower Casing",
        sku: "DEMO-CASE-VT128",
        regularPrice: 2850,
        salePrice: 2650,
        stock: 14,
        soldCount: 22,
        shortDescription: "ATX mid tower with tempered glass side panel.",
        specs: { max_gpu_length: 330, form_factor: "ATX", side_panel: "Tempered glass" },
      },
      {
        slug: "antec-nx292-argb-casing",
        title: "Antec NX292 ARGB Mid Tower Casing",
        sku: "DEMO-CASE-NX292",
        regularPrice: 4900,
        salePrice: 4550,
        stock: 8,
        soldCount: 11,
        shortDescription: "Mesh front, 3x ARGB fans, fits long graphics cards.",
        specs: { max_gpu_length: 360, form_factor: "ATX", side_panel: "Tempered glass + mesh" },
      },
    ],
  },
  {
    slug: "monitor",
    name: "Monitor",
    image: "monitor.svg",
    specs: [
      { key: "screen_size", label: "Screen Size", labelBn: "স্ক্রিন সাইজ", type: "number", unit: "inch" },
      { key: "resolution", label: "Resolution", labelBn: "রেজোলিউশন", type: "text" },
      { key: "refresh_rate", label: "Refresh Rate", labelBn: "রিফ্রেশ রেট", type: "number", unit: "Hz" },
      {
        key: "panel",
        label: "Panel",
        labelBn: "প্যানেল",
        type: "enum",
        enumValues: [{ value: "IPS", label: "IPS" }, { value: "VA", label: "VA" }, { value: "TN", label: "TN" }],
      },
    ],
    products: [
      {
        slug: "walton-wd215-fhd-monitor",
        title: "Walton 21.5-inch FHD Monitor",
        sku: "DEMO-MON-W215",
        regularPrice: 10500,
        salePrice: 9800,
        stock: 10,
        soldCount: 18,
        shortDescription: "1080p VA panel at 75Hz with HDMI input.",
        specs: { screen_size: 21.5, resolution: "1920x1080", refresh_rate: 75, panel: "VA" },
      },
      {
        slug: "dell-s2421hn-monitor",
        title: "Dell S2421HN 23.8-inch IPS Monitor",
        sku: "DEMO-MON-S2421",
        regularPrice: 17800,
        salePrice: 16500,
        stock: 6,
        soldCount: 9,
        shortDescription: "FHD IPS with AMD FreeSync and two HDMI ports.",
        specs: { screen_size: 23.8, resolution: "1920x1080", refresh_rate: 75, panel: "IPS" },
      },
    ],
  },
  {
    slug: "casing-cooler",
    name: "Casing Cooler",
    image: "case-cooler.svg",
    specs: [
      { key: "fan_size", label: "Fan Size", labelBn: "ফ্যান সাইজ", type: "number", unit: "mm" },
      { key: "airflow", label: "Airflow", labelBn: "এয়ারফ্লো", type: "number", unit: "CFM" },
      { key: "rpm", label: "Speed", labelBn: "স্পিড", type: "number", unit: "RPM" },
      { key: "rgb", label: "RGB Lighting", labelBn: "আরজিবি লাইটিং", type: "boolean" },
    ],
    products: [
      {
        slug: "pc-power-rainbow-120-fan",
        title: "PC Power 120mm Rainbow Case Fan",
        sku: "DEMO-FAN-PC120",
        regularPrice: 450,
        salePrice: 399,
        stock: 40,
        soldCount: 80,
        shortDescription: "Quiet 120mm case fan with rainbow LED ring.",
        specs: { fan_size: 120, airflow: 38, rpm: 1200, rgb: true },
      },
      {
        slug: "lian-li-uni-fan-120",
        title: "Lian Li UNI Fan 120 ARGB Case Fan",
        sku: "DEMO-FAN-UNI120",
        regularPrice: 1450,
        salePrice: 1290,
        stock: 12,
        soldCount: 20,
        shortDescription: "Daisy-chainable ARGB fan with high static pressure.",
        specs: { fan_size: 120, airflow: 61, rpm: 1900, rgb: true },
      },
    ],
  },
  {
    slug: "keyboard",
    name: "Keyboard",
    image: "keyboard.svg",
    specs: [
      { key: "layout", label: "Layout", labelBn: "লেআউট", type: "text" },
      {
        key: "connection",
        label: "Connection",
        labelBn: "কানেকশন",
        type: "enum",
        enumValues: [{ value: "Wired", label: "Wired" }, { value: "Wireless", label: "Wireless" }],
      },
      { key: "switch_type", label: "Switch Type", labelBn: "সুইচ টাইপ", type: "text" },
    ],
    products: [
      {
        slug: "a4tech-kr-83-keyboard",
        title: "A4Tech KR-83 USB Keyboard",
        sku: "DEMO-KB-KR83",
        regularPrice: 950,
        salePrice: 840,
        stock: 25,
        soldCount: 45,
        shortDescription: "Full-size membrane keyboard with laser-printed keys.",
        specs: { layout: "Full size", connection: "Wired", switch_type: "Membrane" },
      },
      {
        slug: "redragon-k552-kumara",
        title: "Redragon K552 Kumara RGB Mechanical Keyboard",
        sku: "DEMO-KB-K552",
        regularPrice: 3200,
        salePrice: 2990,
        stock: 15,
        soldCount: 30,
        shortDescription: "TKL mechanical keyboard with red switches and RGB.",
        specs: { layout: "TKL", connection: "Wired", switch_type: "Red mechanical" },
      },
    ],
  },
  {
    slug: "mouse",
    name: "Mouse",
    image: "mouse.svg",
    specs: [
      { key: "dpi", label: "DPI", labelBn: "ডিপিআই", type: "number" },
      {
        key: "connection",
        label: "Connection",
        labelBn: "কানেকশন",
        type: "enum",
        enumValues: [{ value: "Wired", label: "Wired" }, { value: "Wireless", label: "Wireless" }],
      },
      { key: "buttons", label: "Buttons", labelBn: "বাটন সংখ্যা", type: "number" },
    ],
    products: [
      {
        slug: "a4tech-op-720-mouse",
        title: "A4Tech OP-720 USB Mouse",
        sku: "DEMO-MS-OP720",
        regularPrice: 550,
        salePrice: 480,
        stock: 30,
        soldCount: 65,
        shortDescription: "Simple 3-button optical mouse for office use.",
        specs: { dpi: 1000, connection: "Wired", buttons: 3 },
      },
      {
        slug: "logitech-g102-lightsync",
        title: "Logitech G102 Lightsync Gaming Mouse",
        sku: "DEMO-MS-G102",
        regularPrice: 2450,
        salePrice: 2250,
        stock: 18,
        soldCount: 28,
        shortDescription: "6-button gaming mouse up to 8000 DPI.",
        specs: { dpi: 8000, connection: "Wired", buttons: 6 },
      },
    ],
  },
  {
    slug: "wifi-adapter-lan-card",
    name: "Wifi Adapter / LAN Card",
    image: "wifi-lan.svg",
    specs: [
      {
        key: "interface",
        label: "Interface",
        labelBn: "ইন্টারফেস",
        type: "enum",
        enumValues: [{ value: "USB", label: "USB" }, { value: "PCIe", label: "PCIe" }],
      },
      { key: "speed", label: "Speed", labelBn: "স্পিড", type: "text" },
      { key: "band", label: "Band", labelBn: "ব্যান্ড", type: "text" },
    ],
    products: [
      {
        slug: "tp-link-tl-wn725n",
        title: "TP-Link TL-WN725N 150Mbps Nano USB WiFi Adapter",
        sku: "DEMO-NET-WN725N",
        regularPrice: 650,
        salePrice: 590,
        stock: 35,
        soldCount: 50,
        shortDescription: "Tiny 2.4GHz USB WiFi adapter for desktops and laptops.",
        specs: { interface: "USB", speed: "150Mbps", band: "2.4GHz" },
      },
      {
        slug: "tp-link-tg-3468",
        title: "TP-Link TG-3468 Gigabit PCIe LAN Card",
        sku: "DEMO-NET-TG3468",
        regularPrice: 1500,
        salePrice: 1350,
        stock: 20,
        soldCount: 24,
        shortDescription: "Gigabit ethernet card for wired connections.",
        specs: { interface: "PCIe", speed: "1000Mbps", band: "N/A" },
      },
    ],
  },
  {
    slug: "ups",
    name: "UPS",
    image: "ups.svg",
    specs: [
      { key: "capacity_va", label: "Capacity", labelBn: "ক্যাপাসিটি", type: "number", unit: "VA" },
      { key: "backup_minutes", label: "Backup Time", labelBn: "ব্যাকআপ সময়", type: "number", unit: "min" },
      { key: "outlets", label: "Outlets", labelBn: "আউটলেট", type: "number" },
    ],
    products: [
      {
        slug: "power-guard-pg-650va",
        title: "Power Guard PG 650VA UPS",
        sku: "DEMO-UPS-PG650",
        regularPrice: 4200,
        salePrice: 3850,
        stock: 9,
        soldCount: 12,
        shortDescription: "Offline UPS with 3 outputs and auto restart.",
        specs: { capacity_va: 650, backup_minutes: 20, outlets: 3 },
      },
      {
        slug: "apc-bx650ci-ms",
        title: "APC BX650CI-MS 650VA UPS",
        sku: "DEMO-UPS-BX650",
        regularPrice: 7200,
        salePrice: 6700,
        stock: 5,
        soldCount: 7,
        shortDescription: "Back-UPS with surge protection and 4 outlets.",
        specs: { capacity_va: 650, backup_minutes: 25, outlets: 4 },
      },
    ],
  },
];

async function upsertComponentCategories(store, parent) {
  const bySlug = new Map();
  for (const [index, component] of COMPONENTS.entries()) {
    const category = await Category.findOneAndUpdate(
      { store: store._id, slug: component.slug },
      {
        $set: {
          store: store._id,
          name: component.name,
          slug: component.slug,
          parent: parent._id,
          ancestors: [parent._id],
          level: 1,
          order: 10 + index,
          image: image(component.image),
          icon: { type: "none", value: "" },
          status: "published",
          isDemo: true,
        },
      },
      { upsert: true, returnDocument: "after" }
    );
    bySlug.set(component.slug, category);
    for (const [specIndex, spec] of component.specs.entries()) {
      await SpecDefinition.findOneAndUpdate(
        { store: store._id, category: category._id, key: spec.key },
        {
          $set: {
            store: store._id,
            category: category._id,
            key: spec.key,
            label: spec.label,
            labelBn: spec.labelBn || "",
            type: spec.type || "text",
            unit: spec.unit || "",
            enumValues: spec.enumValues || [],
            filterable: true,
            showInList: false,
            active: true,
            sortOrder: specIndex,
          },
        },
        { upsert: true, returnDocument: "after" }
      );
    }
  }
  console.log(`Component categories ready: ${bySlug.size} under ${parent.name}`);
  return bySlug;
}

async function upsertComponentProducts(store, categories) {
  let count = 0;
  for (const component of COMPONENTS) {
    const category = categories.get(component.slug);
    for (const row of component.products) {
      const doc = await Product.findOneAndUpdate(
        { store: store._id, slug: row.slug },
        {
          $set: {
            store: store._id,
            title: row.title,
            name: row.title,
            slug: row.slug,
            sku: row.sku,
            regularPrice: row.regularPrice,
            salePrice: row.salePrice,
            price: row.regularPrice,
            stock: row.stock,
            soldCount: row.soldCount,
            status: "published",
            productType: "physical",
            categories: [category._id],
            images: [image(component.image)],
            shortDescription: row.shortDescription,
            description: `<p>${row.shortDescription} Demo data for the PC Builder section.</p>`,
            specs: row.specs,
            isDemo: true,
          },
        },
        { upsert: true, returnDocument: "after" }
      );
      await ProductCategory.findOneAndUpdate(
        { store: store._id, product: doc._id, category: category._id },
        { $setOnInsert: { store: store._id } },
        { upsert: true }
      );
      count += 1;
    }
  }
  console.log(`Component products ready: ${count} (${COMPONENTS.map((row) => row.name).join(", ")})`);
}

async function upsertProducts(store, category) {
  const bySlug = new Map();
  for (const row of PRODUCTS) {
    const doc = await Product.findOneAndUpdate(
      { store: store._id, slug: row.slug },
      {
        $set: {
          store: store._id,
          title: row.title,
          name: row.title,
          slug: row.slug,
          sku: row.sku,
          regularPrice: row.regularPrice,
          salePrice: row.salePrice,
          price: row.regularPrice,
          stock: row.stock,
          soldCount: row.soldCount,
          status: "published",
          productType: "physical",
          categories: [category._id],
          images: [image(row.image)],
          shortDescription: row.shortDescription,
          description: `<p>${row.shortDescription} Demo data for the PC Builder section.</p>`,
          specs: row.specs,
          isDemo: true,
        },
      },
      { upsert: true, returnDocument: "after" }
    );
    await ProductCategory.findOneAndUpdate(
      { store: store._id, product: doc._id, category: category._id },
      { $setOnInsert: { store: store._id } },
      { upsert: true }
    );
    bySlug.set(row.slug, doc);
  }
  console.log(`Products ready: ${bySlug.size} (category: ${category.name})`);
  return bySlug;
}

function buildTemplate(products) {
  const id = (slug) => products.get(slug)._id;
  return {
    store: null, // filled by caller
    name: "Demo PC Builder",
    slug: TEMPLATE_SLUG,
    description: "প্রসেসর + মাদারবোর্ড + র‍্যাম + স্টোরেজ বেছে একটা পিসি বিল্ড করুন। কম্বিনেশন না মিললে বিল্ডার নিজেই আটকে দেবে।",
    status: "published",
    groups: [
      { key: "core", name: "Core Components", nameBn: "মূল পার্টস", sortOrder: 1 },
      { key: "power", name: "Power & Graphics", nameBn: "পাওয়ার ও গ্রাফিক্স", sortOrder: 2 },
    ],
    slots: [
      {
        key: "cpu",
        label: "Processor (CPU)",
        labelBn: "প্রসেসর (CPU)",
        group: "core",
        required: true,
        maxQty: 1,
        sortOrder: 1,
        hint: "Pick the CPU first — the motherboard must match its socket.",
        hintBn: "আগে CPU বাছুন — মাদারবোর্ডের সকেট একই হতে হবে।",
        filter: { products: [id("intel-core-i5-13400f"), id("amd-ryzen-5-7600")] },
      },
      {
        key: "motherboard",
        label: "Motherboard",
        labelBn: "মাদারবোর্ড",
        group: "core",
        required: true,
        maxQty: 1,
        sortOrder: 2,
        hint: "Only boards that match the selected CPU socket are shown.",
        hintBn: "নির্বাচিত CPU-এর সকেটের সাথে মেলে এমন বোর্ডই দেখানো হবে।",
        filter: { products: [id("msi-b760m-bomber-wifi"), id("msi-b650m-p-wifi")] },
      },
      {
        key: "ram",
        label: "Memory (RAM)",
        labelBn: "র‍্যাম (RAM)",
        group: "core",
        required: true,
        maxQty: 2,
        sortOrder: 3,
        hint: "DDR5 memory — matches both demo boards.",
        hintBn: "DDR5 র‍্যাম — দুই ডেমো বোর্ডেই চলবে।",
        filter: { products: [id("corsair-vengeance-16gb-ddr5-5600")] },
      },
      {
        key: "storage",
        label: "Storage (SSD)",
        labelBn: "স্টোরেজ (SSD)",
        group: "power",
        required: true,
        maxQty: 2,
        sortOrder: 4,
        hint: "NVMe M.2 drive.",
        hintBn: "NVMe M.2 ড্রাইভ।",
        filter: { products: [id("samsung-980-1tb-nvme-ssd")] },
      },
      {
        key: "gpu",
        label: "Graphics Card (GPU)",
        labelBn: "গ্রাফিক্স কার্ড (GPU)",
        group: "power",
        required: false,
        maxQty: 1,
        sortOrder: 5,
        hint: "Optional — playback/office build hole na dileo cholbe.",
        hintBn: "ঐচ্ছিক — না নিলেও বিল্ড সেভ হবে, শুধু একটা সতর্কতা দেখাবে।",
        filter: { products: [id("asus-dual-rtx-4060-oc-8gb")] },
      },
      {
        key: "psu",
        label: "Power Supply (PSU)",
        labelBn: "পাওয়ার সাপ্লাই (PSU)",
        group: "power",
        required: true,
        maxQty: 1,
        sortOrder: 6,
        hint: "650W is enough for this demo build.",
        hintBn: "এই ডেমো বিল্ডের জন্য 650W যথেষ্ট।",
        filter: { products: [id("cooler-master-mwe-650-v2")] },
      },
    ],
    rules: [
      {
        key: "cpu-socket",
        type: "equals",
        level: "block",
        message: "CPU socket and motherboard socket do not match",
        messageBn: "CPU ও মাদারবোর্ডের সকেট মিলছে না",
        left: { slot: "cpu", spec: "socket" },
        right: { slot: "motherboard", spec: "socket" },
      },
      {
        key: "ram-type",
        type: "equals",
        level: "block",
        message: "This RAM type does not fit the motherboard",
        messageBn: "এই র‍্যাম মাদারবোর্ডে বসবে না",
        left: { slot: "ram", spec: "memorytype" },
        right: { slot: "motherboard", spec: "memory" },
      },
      {
        key: "gpu-length",
        type: "lte",
        level: "warn",
        message: "This card is 227mm long — check clearance in a small case",
        messageBn: "কার্ডটির দৈর্ঘ্য ২২৭ মিমি — ছোট কেসে জায়গা দেখে নিন",
        left: { slot: "gpu", spec: "lengthmm" },
        value: 220,
      },
    ],
    settings: { showTotal: true, stickyBar: true },
  };
}

async function upsertTemplate(store, products) {
  const data = buildTemplate(products);
  const template = await BuilderTemplate.findOneAndUpdate(
    { store: store._id, slug: TEMPLATE_SLUG },
    { $set: { ...data, store: store._id } },
    { upsert: true, returnDocument: "after" }
  );
  console.log(`Template ready: ${template.name} (${template.slug}) — ${template.slots.length} slots, ${template.rules.length} rules`);
  return template;
}

async function upsertInstallments(store) {
  const settings = {
    enabled: true,
    method: "flat_annual",
    annualRatePct: 12,
    markupPct: 0,
    maxAnnualRatePct: 36,
    serviceChargePercent: 1,
    serviceChargeFlatPaisa: 0,
    minDownPaymentPercent: 10,
    cashPriceIsSalePrice: true,
    maxMonths: 36,
    applicant: {
      requireNid: true,
      requireAddress: true,
      requireGuarantor: false,
      requireDocuments: false,
      documentTypes: ["nid_front", "nid_back"],
      note: "ডেমো সেটআপ — নাম, ফোন ও NID দিলেই আবেদন জমা যাবে।",
    },
    review: { approvalRequired: true, autoRejectDays: 3 },
    lateFee: { type: "flat", amountPaisa: 20000, percent: 0, graceDays: 3 },
    reminderDays: [3, 1],
    categoryRules: [],
    cardEmi: { enabled: true, note: "কার্ড ইএমআই ব্যাংকের শর্ত সাপেক্ষে প্রযোজ্য।" },
    terms:
      "১. ইনস্টলমেন্টে পণ্যের মূল্য রেগুলার প্রাইস হিসেবে ধরা হয়; ক্যাশ পেমেন্টে সেল প্রাইস প্রযোজ্য।\n" +
      "২. ডাউন পেমেন্ট ও মাসিক কিস্তি আবেদনের সময় দেখানো হিসাব অনুযায়ী।\n" +
      "৩. নির্ধারিত তারিখে কিস্তি না দিলে বিলম্ব ফি প্রযোজ্য হতে পারে।\n" +
      "৪. ডেমো স্টোর — এই আবেদন শুধু সিস্টেম দেখানোর জন্য।",
  };
  await InstallmentSettings.findOneAndUpdate(
    { store: store._id },
    { $set: { ...settings, store: store._id } },
    { upsert: true, returnDocument: "after" }
  );
  console.log("Installment settings ready: enabled, flat annual 12%, 1% service charge, min DP 10%");

  const offers = [
    { name: "৩ মাস", months: 3, downPaymentPercent: 10, sortOrder: 1 },
    { name: "৬ মাস", months: 6, downPaymentPercent: 15, sortOrder: 2 },
    { name: "১২ মাস", months: 12, downPaymentPercent: 20, sortOrder: 3 },
  ];
  for (const offer of offers) {
    await InstallmentOffer.findOneAndUpdate(
      { store: store._id, months: offer.months },
      { $set: { ...offer, minProductPricePaisa: 0, isActive: true, store: store._id } },
      { upsert: true, returnDocument: "after" }
    );
  }
  console.log(`Installment offers ready: ${offers.map((row) => `${row.months}m`).join(", ")}`);
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI pawa jayni (.env check korun)");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);

  try {
    writeImages();
    const store = await resolveStore();
    console.log(`Store: ${store.name} (${store.slug})`);

    await grantFeatures(store);
    const category = await upsertCategory(store);
    await upsertSpecs(store, category);
    const products = await upsertProducts(store, category);
    const componentCategories = await upsertComponentCategories(store, category);
    await upsertComponentProducts(store, componentCategories);
    await upsertTemplate(store, products);
    await upsertInstallments(store);

    console.log("\nDone. Storefront:");
    console.log(`  Builder:     /builder  (template: ${TEMPLATE_SLUG})`);
    console.log("  Product page: any demo product shows Payment Options (Cash / Installment)");
    console.log("  Categories:  PC Components → Casing / Monitor / Casing Cooler / Keyboard / Mouse / Wifi Adapter / LAN Card / UPS");
    console.log("  Admin: Product list → edit a demo product → category shows the spec fields");
    console.log("  Try: pick the AMD CPU first — the Intel motherboard disappears with a Bangla reason.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
