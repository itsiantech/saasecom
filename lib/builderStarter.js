// Starter template the admin can create in one click. Slot keys/spec keys are
// conventions, not requirements — unused rules stay silent when products do
// not carry the spec.
const STARTER = {
  name: "PC Builder",
  slug: "pc-builder",
  status: "draft",
  description: "নিজের পিসি বানান — CPU থেকে কেস পর্যন্ত সব পার্ট বেছে নিন",
  groups: [
    { key: "core", name: "Core", nameBn: "মূল অংশ", sortOrder: 0 },
    { key: "memory", name: "Memory & storage", nameBn: "মেমোরি ও স্টোরেজ", sortOrder: 1 },
    { key: "cooling", name: "Cooling", nameBn: "কুলিং", sortOrder: 2 },
    { key: "peripherals", name: "Peripherals", nameBn: "পেরিফেরালস", sortOrder: 3 },
    { key: "accessories", name: "Accessories", nameBn: "অ্যাক্সেসরিজ", sortOrder: 4 },
  ],
  slots: [
    { key: "cpu", label: "Processor (CPU)", labelBn: "প্রসেসর (CPU)", group: "core", required: true, sortOrder: 0, hint: "Socket মিলিয়ে নিন" },
    { key: "motherboard", label: "Motherboard", labelBn: "মাদারবোর্ড", group: "core", required: true, sortOrder: 1 },
    { key: "gpu", label: "Graphics card", labelBn: "গ্রাফিক্স কার্ড", group: "core", sortOrder: 2 },
    { key: "psu", label: "Power supply", labelBn: "পাওয়ার সাপ্লাই", group: "core", required: true, sortOrder: 3 },
    { key: "case", label: "Case", labelBn: "কেস", group: "core", required: true, sortOrder: 4 },
    { key: "ram", label: "RAM", labelBn: "র‍্যাম", group: "memory", required: true, maxQty: 4, sortOrder: 5 },
    { key: "storage_primary", label: "Primary storage", labelBn: "প্রাইমারি স্টোরেজ", group: "memory", required: true, sortOrder: 6 },
    { key: "storage_secondary", label: "Extra storage", labelBn: "অতিরিক্ত স্টোরেজ", group: "memory", maxQty: 4, sortOrder: 7 },
    { key: "cooler", label: "CPU cooler", labelBn: "সিপিইউ কুলার", group: "cooling", sortOrder: 8 },
    { key: "case_fans", label: "Case fans", labelBn: "কেস ফ্যান", group: "cooling", maxQty: 6, sortOrder: 9 },
    { key: "thermal_paste", label: "Thermal paste", labelBn: "থার্মাল পেস্ট", group: "cooling", sortOrder: 10 },
    { key: "monitor", label: "Monitor", labelBn: "মনিটর", group: "peripherals", sortOrder: 11 },
    { key: "keyboard", label: "Keyboard", labelBn: "কিবোর্ড", group: "peripherals", sortOrder: 12 },
    { key: "mouse", label: "Mouse", labelBn: "মাউস", group: "peripherals", sortOrder: 13 },
    { key: "headset", label: "Headset", labelBn: "হেডসেট", group: "peripherals", sortOrder: 14 },
    { key: "webcam", label: "Webcam", labelBn: "ওয়েবক্যাম", group: "peripherals", sortOrder: 15 },
    { key: "speakers", label: "Speakers", labelBn: "স্পিকার", group: "peripherals", sortOrder: 16 },
    { key: "ups", label: "UPS", labelBn: "ইউপিএস", group: "accessories", sortOrder: 17 },
    { key: "wifi_card", label: "Wi-Fi card", labelBn: "ওয়াই-ফাই কার্ড", group: "accessories", sortOrder: 18 },
    { key: "os", label: "Operating system", labelBn: "অপারেটিং সিস্টেম", group: "accessories", sortOrder: 19 },
    { key: "surge_protector", label: "Surge protector", labelBn: "সার্জ প্রোটেক্টর", group: "accessories", sortOrder: 20 },
  ],
  rules: [
    {
      key: "cpu-socket",
      type: "set-membership",
      level: "block",
      message: "The CPU socket is not supported by this motherboard",
      messageBn: "সিপিইউ সকেট এই মাদারবোর্ডে সাপোর্টেড নয়",
      left: { slot: "cpu", spec: "socket" },
      right: { slot: "motherboard", spec: "sockets" },
    },
    {
      key: "ram-type",
      type: "equals",
      level: "block",
      message: "RAM type does not match the motherboard",
      messageBn: "র‍্যামের ধরন মাদারবোর্ডের সাথে মিলছে না",
      left: { slot: "ram", spec: "ram_type" },
      right: { slot: "motherboard", spec: "ram_type" },
    },
    {
      key: "cooler-socket",
      type: "includes",
      level: "block",
      message: "The cooler does not support this CPU socket",
      messageBn: "এই কুলার সিপিইউ সকেট সাপোর্ট করে না",
      left: { slot: "cooler", spec: "sockets" },
      right: { slot: "cpu", spec: "socket" },
    },
    {
      key: "gpu-clearance",
      type: "lte",
      level: "block",
      message: "The graphics card is too long for this case",
      messageBn: "গ্রাফিক্স কার্ড এই কেসে ফিট করবে না",
      left: { slot: "gpu", spec: "length" },
      right: { slot: "case", spec: "max_gpu_length" },
    },
    {
      key: "psu-power",
      type: "sum-lte",
      level: "block",
      message: "The power supply would be overloaded",
      messageBn: "পাওয়ার সাপ্লাই ওভারলোড হবে",
      terms: [
        { slot: "cpu", spec: "tdp", multiplier: 1 },
        { slot: "gpu", spec: "tdp", multiplier: 1.2 },
      ],
      limit: 650,
    },
  ],
};

function starterTemplate() {
  // deep copy so callers can freely edit groups/slots before saving
  return JSON.parse(JSON.stringify(STARTER));
}

module.exports = { STARTER, starterTemplate };
