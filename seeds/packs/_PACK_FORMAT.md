# Starter Pack Format

## Structure

```json
{
  "name": "fashion",
  "displayName": "Fashion Store",
  "description": "Perfect for clothing, accessories, and fashion items",
  "version": "1.0.0",
  "categories": [
    {
      "name": "Men's Clothing",
      "slug": "mens-clothing",
      "parent": null,
      "level": 0,
      "order": 1,
      "image": "/uploads/demo/fashion/category-men.jpg",
      "icon": { "type": "none", "value": "" },
      "status": "published",
      "subcategories": [
        {
          "name": "T-Shirts",
          "slug": "t-shirts",
          "level": 1,
          "order": 1,
          "image": "/uploads/demo/fashion/category-tshirts.jpg",
          "status": "published"
        }
      ]
    }
  ],
  "brands": [
    {
      "name": "Nike",
      "slug": "nike",
      "level": 0,
      "order": 1,
      "image": "/uploads/demo/fashion/brand-nike.jpg",
      "status": "published"
    }
  ],
  "products": [
    {
      "title": "Classic Cotton T-Shirt",
      "slug": "classic-cotton-t-shirt",
      "regularPrice": 990,
      "salePrice": 790,
      "stock": 50,
      "description": "<p>Comfortable 100% cotton t-shirt perfect for everyday wear.</p>",
      "shortDescription": "Comfortable 100% cotton t-shirt",
      "weightKg": 0.2,
      "sku": "TSHIRT-001",
      "status": "published",
      "images": [
        "/uploads/demo/fashion/product-tshirt-1.jpg",
        "/uploads/demo/fashion/product-tshirt-2.jpg"
      ],
      "brandSlug": "nike",
      "categorySlugs": ["mens-clothing", "t-shirts"],
      "tags": ["cotton", "t-shirt", "casual"],
      "productType": "physical",
      "isHotDeal": false,
      "isTopFeature": true,
      "moq": 1,
      "shipsAbroad": false
    }
  ],
  "heroSlides": [
    {
      "image": "/uploads/demo/fashion/hero-1.jpg",
      "alt": "Summer Collection",
      "title": "Summer Collection 2024",
      "subtitle": "Up to 50% off on selected items",
      "buttonLabel": "Shop Now",
      "linkUrl": "/products",
      "active": true,
      "sortOrder": 1
    }
  ]
}
```

## Notes

- All slugs must be unique within the pack
- Images should reference `/uploads/demo/<pack>/` folder
- `categorySlugs` and `brandSlug` are used to resolve references after creation
- Categories with `subcategories` array will have parent-child relationships set automatically
- All records will have `isDemo: true` when applied to a store
