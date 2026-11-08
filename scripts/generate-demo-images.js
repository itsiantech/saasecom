const fs = require("fs");
const path = require("path");

function createPlaceholderSVG(width, height, text, color = "#e0e0e0") {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${color}"/>
    <text x="50%" y="50%" font-family="Arial" font-size="24" fill="#666" text-anchor="middle" dy=".3em">${text}</text>
  </svg>`;
  return svg;
}

function createCategoryPlaceholder(pack, category) {
  return createPlaceholderSVG(400, 300, category, "#f5f5f5");
}

function createProductPlaceholder(pack, product) {
  return createPlaceholderSVG(400, 400, "Product", "#eeeeee");
}

function createBrandPlaceholder(pack, brand) {
  return createPlaceholderSVG(200, 200, brand, "#fafafa");
}

function createHeroPlaceholder(pack, index) {
  return createPlaceholderSVG(1200, 400, `Hero ${index + 1}`, "#e8f4f8");
}

// Generate placeholders for each pack
const packs = ["general", "fashion", "electronics", "grocery"];

packs.forEach((pack) => {
  const packDir = path.join(__dirname, "../public/uploads/demo", pack);
  if (!fs.existsSync(packDir)) {
    fs.mkdirSync(packDir, { recursive: true });
  }

  // Category placeholders
  const categories = ["Category 1", "Category 2", "Category 3"];
  categories.forEach((cat, i) => {
    const svg = createCategoryPlaceholder(pack, cat);
    fs.writeFileSync(path.join(packDir, `category-${i + 1}.svg`), svg);
  });

  // Product placeholders
  for (let i = 1; i <= 12; i++) {
    const svg = createProductPlaceholder(pack, `Product ${i}`);
    fs.writeFileSync(path.join(packDir, `product-${i}.svg`), svg);
  }

  // Brand placeholders
  const brands = ["Brand A", "Brand B", "Brand C"];
  brands.forEach((brand, i) => {
    const svg = createBrandPlaceholder(pack, brand);
    fs.writeFileSync(path.join(packDir, `brand-${i + 1}.svg`), svg);
  });

  // Hero placeholders
  for (let i = 1; i <= 3; i++) {
    const svg = createHeroPlaceholder(pack, i);
    fs.writeFileSync(path.join(packDir, `hero-${i}.svg`), svg);
  }

  console.log(`Generated placeholder images for pack: ${pack}`);
});

console.log("All placeholder images generated successfully!");
