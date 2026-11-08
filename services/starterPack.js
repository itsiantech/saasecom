const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Category = require("../models/Category");
const Product = require("../models/Product");
const HeroSlide = require("../models/HeroSlide");
const Brand = require("../models/Brand");
const Tag = require("../models/Tag");
const Store = require("../models/Store");
const Plan = require("../models/Plan");

/**
 * Apply a starter pack to a store
 * @param {string} storeId - Store ID to apply pack to
 * @param {string} packName - Name of the pack (e.g., "fashion", "electronics")
 * @param {object} options - Additional options
 * @param {boolean} options.skipPlanLimits - Skip plan limit checks (for super admin)
 * @returns {object} Result with counts and errors
 */
async function applyStarterPack(storeId, packName, options = {}) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Load pack data
    const packPath = path.join(__dirname, "../seeds/packs", `${packName}.json`);
    if (!fs.existsSync(packPath)) {
      throw new Error(`Pack "${packName}" not found`);
    }

    const packData = JSON.parse(fs.readFileSync(packPath, "utf8"));

    // Verify store exists
    const store = await Store.findById(storeId).session(session);
    if (!store) {
      throw new Error("Store not found");
    }

    // Get plan limits
    const plan = await Plan.findById(store.plan).session(session);
    if (!plan) {
      throw new Error("Plan not found");
    }

    const planLimits = {
      maxProducts: plan.products || 0,
      maxCategories: plan.categories || 0,
    };

    // Count existing demo data to ensure idempotency
    const existingDemoCategories = await Category.countDocuments({ store: storeId, isDemo: true }).session(session);
    const existingDemoProducts = await Product.countDocuments({ store: storeId, isDemo: true }).session(session);
    const existingDemoSlides = await HeroSlide.countDocuments({ store: storeId, isDemo: true }).session(session);
    const existingDemoBrands = await Brand.countDocuments({ store: storeId, isDemo: true }).session(session);

    // If demo data already exists, skip (idempotent)
    if (existingDemoCategories > 0 || existingDemoProducts > 0) {
      await session.abortTransaction();
      return {
        success: true,
        skipped: true,
        message: "Demo data already exists for this store",
        counts: {
          categories: existingDemoCategories,
          products: existingDemoProducts,
          heroSlides: existingDemoSlides,
          brands: existingDemoBrands,
        },
      };
    }

    // Check plan limits if not skipping
    if (!options.skipPlanLimits) {
      const existingCategories = await Category.countDocuments({ store: storeId, isDemo: false }).session(session);
      const existingProducts = await Product.countDocuments({ store: storeId, isDemo: false }).session(session);

      if (planLimits.maxCategories > 0 && existingCategories + packData.categories.length > planLimits.maxCategories) {
        await session.abortTransaction();
        return {
          success: false,
          error: `Plan limit exceeded: maximum ${planLimits.maxCategories} categories allowed`,
        };
      }

      if (planLimits.maxProducts > 0 && existingProducts + packData.products.length > planLimits.maxProducts) {
        await session.abortTransaction();
        return {
          success: false,
          error: `Plan limit exceeded: maximum ${planLimits.maxProducts} products allowed`,
        };
      }
    }

    // Track created records for slug resolution
    const categoryMap = new Map(); // packSlug -> categoryId
    const brandMap = new Map(); // packSlug -> brandId
    const tagMap = new Map(); // tagName -> tagId

    // Create categories
    for (const cat of packData.categories) {
      const categoryData = {
        store: storeId,
        name: cat.name,
        slug: await generateUniqueSlug(Category, storeId, cat.slug),
        parent: null,
        ancestors: [],
        level: cat.level || 0,
        order: cat.order || 0,
        image: cat.image || "",
        icon: cat.icon || { type: "none", value: "" },
        status: cat.status || "published",
        isDemo: true,
      };

      const created = await Category.create([categoryData], { session });
      categoryMap.set(cat.slug, created[0]._id);

      // Create subcategories
      if (cat.subcategories && cat.subcategories.length > 0) {
        for (const sub of cat.subcategories) {
          const subData = {
            store: storeId,
            name: sub.name,
            slug: await generateUniqueSlug(Category, storeId, sub.slug),
            parent: created[0]._id,
            ancestors: [created[0]._id],
            level: (cat.level || 0) + 1,
            order: sub.order || 0,
            image: sub.image || "",
            icon: sub.icon || { type: "none", value: "" },
            status: sub.status || "published",
            isDemo: true,
          };

          const subCreated = await Category.create([subData], { session });
          categoryMap.set(sub.slug, subCreated[0]._id);
        }
      }
    }

    // Create brands
    for (const brand of packData.brands) {
      const brandData = {
        store: storeId,
        name: brand.name,
        slug: await generateUniqueSlug(Brand, storeId, brand.slug),
        parent: null,
        ancestors: [],
        level: brand.level || 0,
        order: brand.order || 0,
        image: brand.image || "",
        icon: brand.icon || { type: "none", value: "" },
        status: brand.status || "published",
        isDemo: true,
      };

      const created = await Brand.create([brandData], { session });
      brandMap.set(brand.slug, created[0]._id);
    }

    // Create tags
    const tagNames = new Set();
    for (const product of packData.products) {
      if (product.tags && Array.isArray(product.tags)) {
        product.tags.forEach((tag) => tagNames.add(tag));
      }
    }

    for (const tagName of tagNames) {
      const tagData = {
        store: storeId,
        name: tagName,
        slug: await generateUniqueSlug(Tag, storeId, tagName.toLowerCase().replace(/\s+/g, "-")),
        isDemo: true,
      };

      const created = await Tag.create([tagData], { session });
      tagMap.set(tagName, created[0]._id);
    }

    // Create products
    for (const product of packData.products) {
      const categoryIds = [];
      if (product.categorySlugs && Array.isArray(product.categorySlugs)) {
        for (const catSlug of product.categorySlugs) {
          if (categoryMap.has(catSlug)) {
            categoryIds.push(categoryMap.get(catSlug));
          }
        }
      }

      const brandId = product.brandSlug && brandMap.has(product.brandSlug) ? brandMap.get(product.brandSlug) : null;

      const tagIds = [];
      if (product.tags && Array.isArray(product.tags)) {
        for (const tagName of product.tags) {
          if (tagMap.has(tagName)) {
            tagIds.push(tagMap.get(tagName));
          }
        }
      }

      const productData = {
        store: storeId,
        title: product.title,
        slug: await generateUniqueSlug(Product, storeId, product.slug),
        regularPrice: product.regularPrice || 0,
        salePrice: product.salePrice || 0,
        description: product.description || "",
        shortDescription: product.shortDescription || "",
        stock: product.stock || 0,
        weightKg: product.weightKg || 0,
        sku: product.sku || "",
        status: product.status || "published",
        images: product.images || [],
        brand: brandId,
        categories: categoryIds,
        tags: tagIds,
        productType: product.productType || "physical",
        isHotDeal: product.isHotDeal || false,
        isTopFeature: product.isTopFeature || false,
        moq: product.moq || 1,
        shipsAbroad: product.shipsAbroad || false,
        isDemo: true,
      };

      await Product.create([productData], { session });
    }

    // Create hero slides
    for (const slide of packData.heroSlides) {
      const slideData = {
        store: storeId,
        image: slide.image,
        alt: slide.alt || "",
        title: slide.title || "",
        subtitle: slide.subtitle || "",
        buttonLabel: slide.buttonLabel || "",
        linkUrl: slide.linkUrl || "",
        active: slide.active !== false,
        sortOrder: slide.sortOrder || 0,
        isDemo: true,
      };

      await HeroSlide.create([slideData], { session });
    }

    await session.commitTransaction();

    return {
      success: true,
      message: `Starter pack "${packName}" applied successfully`,
      counts: {
        categories: categoryMap.size,
        products: packData.products.length,
        heroSlides: packData.heroSlides.length,
        brands: brandMap.size,
      },
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Generate a unique slug for a store
 * @param {Model} model - Mongoose model
 * @param {string} storeId - Store ID
 * @param {string} baseSlug - Base slug
 * @returns {string} Unique slug
 */
async function generateUniqueSlug(model, storeId, baseSlug) {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const exists = await model.findOne({ store: storeId, slug });
    if (!exists) return slug;

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

/**
 * Remove all demo data from a store
 * @param {string} storeId - Store ID
 * @returns {object} Result with counts
 */
async function removeDemoData(storeId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const result = {
      categories: 0,
      products: 0,
      heroSlides: 0,
      brands: 0,
      tags: 0,
    };

    // Delete demo categories
    result.categories = await Category.deleteMany({ store: storeId, isDemo: true }).session(session);

    // Delete demo products
    result.products = await Product.deleteMany({ store: storeId, isDemo: true }).session(session);

    // Delete demo hero slides
    result.heroSlides = await HeroSlide.deleteMany({ store: storeId, isDemo: true }).session(session);

    // Delete demo brands
    result.brands = await Brand.deleteMany({ store: storeId, isDemo: true }).session(session);

    // Delete demo tags
    result.tags = await Tag.deleteMany({ store: storeId, isDemo: true }).session(session);

    await session.commitTransaction();

    return {
      success: true,
      message: "Demo data removed successfully",
      counts: {
        categories: result.categories.deletedCount || 0,
        products: result.products.deletedCount || 0,
        heroSlides: result.heroSlides.deletedCount || 0,
        brands: result.brands.deletedCount || 0,
        tags: result.tags.deletedCount || 0,
      },
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Check if store has demo data
 * @param {string} storeId - Store ID
 * @returns {boolean} True if demo data exists
 */
async function hasDemoData(storeId) {
  const demoCount = await Category.countDocuments({ store: storeId, isDemo: true });
  return demoCount > 0;
}

/**
 * List available starter packs
 * @returns {Array} List of pack metadata
 */
function listPacks() {
  const packsDir = path.join(__dirname, "../seeds/packs");
  const files = fs.readdirSync(packsDir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));

  return files.map((file) => {
    const packPath = path.join(packsDir, file);
    const packData = JSON.parse(fs.readFileSync(packPath, "utf8"));
    return {
      name: packData.name,
      displayName: packData.displayName,
      description: packData.description,
      version: packData.version,
      file: file.replace(".json", ""),
    };
  });
}

module.exports = {
  applyStarterPack,
  removeDemoData,
  hasDemoData,
  listPacks,
};
