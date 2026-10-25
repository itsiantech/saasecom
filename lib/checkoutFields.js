// Checkout field definitions shared by settings + checkout API.
const CHECKOUT_FIELDS = [
  { key: "name", label: "Name", shown: true, required: true },
  { key: "phone", label: "Phone number", shown: true, required: true },
  { key: "email", label: "Email", shown: true, required: false },
  { key: "address", label: "Address", shown: true, required: true },
  { key: "thana", label: "Thana", shown: false, required: false },
  { key: "district", label: "District", shown: true, required: false },
  { key: "division", label: "Division", shown: false, required: false },
  { key: "postCode", label: "Post code", shown: false, required: false },
  { key: "country", label: "Country", shown: true, required: false },
];

const FIELD_KEYS = CHECKOUT_FIELDS.map((f) => f.key);

// "Simple" / "Full" preset definitions
const PRESETS = {
  simple: ["name", "phone", "address"],
  fullRequired: ["name", "phone", "address", "district"],
};

module.exports = { CHECKOUT_FIELDS, FIELD_KEYS, PRESETS };
