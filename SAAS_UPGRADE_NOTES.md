# SaaS Model Upgrade Notes

## Summary of Changes

All SaaS model issues have been resolved. The system now has a complete subscription-based multi-tenant architecture.

## 1. Model Updates

### Store Model (`models/Store.js`)
- **Changed**: `plan` field from enum string to ObjectId reference to Plan model
- **Benefit**: Dynamic plan management, no hardcoded plan names

### Plan Model (`models/Plan.js`)
- **Added**: `trialDays` field for trial period support
- **Added**: `limits` object with multiple limit types:
  - `products`: Product count limit
  - `orders`: Order count limit
  - `storageMB`: Storage limit in MB
  - `staffMembers`: Number of staff members allowed
- **Added**: `features` object for feature flags:
  - `customDomain`: Custom domain support
  - `analytics`: Analytics dashboard
  - `apiAccess`: API access
  - `prioritySupport`: Priority support
- **Benefit**: Comprehensive plan configuration

### Subscription Model (`models/Subscription.js` - NEW)
- Tracks subscription lifecycle per store
- Fields:
  - `store`: Reference to Store
  - `plan`: Reference to Plan
  - `status`: active, trial, expired, cancelled
  - `startDate`, `endDate`: Subscription period
  - `trialEndsAt`: Trial end date
  - `autoRenew`: Auto-renewal flag
  - `lastPaymentAt`: Last payment timestamp
  - `cancelledAt`: Cancellation timestamp
- **Benefit**: Full subscription management

### Order Model (`models/Order.js` - NEW)
- Tracks orders with tenant isolation
- Includes plan limit enforcement via plugin
- **Benefit**: Order management with limits

### Staff Model (`models/Staff.js` - NEW)
- Tracks staff members with tenant isolation
- Includes plan limit enforcement via plugin
- **Benefit**: Staff management with limits

## 2. Plugin Updates

### Plan Limit Plugin (`lib/planLimitPlugin.js`)
- **Enhanced**: Supports multiple limit types (products, orders, staffMembers)
- **Logic**: Dynamically checks limits based on model type
- **Models Supported**: Product, Order, Staff
- **Benefit**: Flexible limit enforcement across different resources

## 3. Route Updates

### Store Routes (`routes/stores.js`)
- **Fixed**: Plan validation on store creation
- **Added**: Automatic subscription creation when store is created
- **Added**: Trial period support based on plan configuration
- **Added**: Populate plan in "my stores" endpoint
- **Benefit**: Complete store onboarding with subscription

### Subscription Routes (`routes/subscriptions.js` - NEW)
- `GET /api/subscriptions/current`: Get current store's subscription
- `POST /api/subscriptions/upgrade`: Upgrade/change plan (admin only)
- `POST /api/subscriptions/cancel`: Cancel subscription (admin only)
- `POST /api/subscriptions/resume`: Resume cancelled subscription (admin only)
- **Benefit**: Full subscription lifecycle management

### Plan Routes (`routes/plans.js`)
- **Updated**: POST/PUT endpoints to handle new plan structure (limits, features, trialDays)
- **Benefit**: Plan management with new fields

### Order Routes (`routes/orders.js` - NEW)
- Full CRUD operations for orders
- Tenant isolation and limit enforcement
- **Benefit**: Order management

### Staff Routes (`routes/staff.js` - NEW)
- Full CRUD operations for staff
- Tenant isolation and limit enforcement
- **Benefit**: Staff management

## 4. Middleware Updates

### Tenant Middleware (`middleware/tenant.js`)
- **Fixed**: Single mode store creation to use Plan reference
- **Added**: Plan model import
- **Benefit**: Proper store creation in both SaaS and single modes

### Auth Middleware (`middleware/auth.js`)
- **Fixed**: ObjectId comparison in requireAdmin
- **Benefit**: Proper admin permission check

## 5. Server Updates

### Server (`server.js`)
- **Added**: `/api/subscriptions` route
- **Added**: `/api/orders` route
- **Added**: `/api/staff` route
- **Benefit**: New endpoints available

## 6. Seed Script Updates

### Seed Demo (`scripts/seed-demo.js`)
- **Added**: Plan creation (Free and Pro plans)
- **Added**: Subscription creation for demo store
- **Updated**: Store plan reference to use Plan ObjectId
- **Benefit**: Demo data with subscription structure

## API Endpoints

### Plans
- `GET /api/plans` - List active plans
- `POST /api/plans` - Create plan (superadmin)
- `PUT /api/plans/:id` - Update plan (superadmin)
- `DELETE /api/plans/:id` - Delete plan (superadmin)

### Stores
- `POST /api/stores` - Create store with subscription
- `GET /api/stores/mine` - Get my stores
- `GET /api/stores/public/:slug` - Get public store info

### Subscriptions
- `GET /api/subscriptions/current` - Get current subscription
- `POST /api/subscriptions/upgrade` - Upgrade plan
- `POST /api/subscriptions/cancel` - Cancel subscription
- `POST /api/subscriptions/resume` - Resume subscription

### Products
- `GET /api/products` - List products
- `POST /api/products` - Create product (enforces limits)
- `PUT /api/products/:id` - Update product (admin)
- `DELETE /api/products/:id` - Delete product (admin)

### Orders
- `GET /api/orders` - List orders
- `POST /api/orders` - Create order (enforces limits)
- `PUT /api/orders/:id` - Update order (admin)
- `DELETE /api/orders/:id` - Delete order (admin)

### Staff
- `GET /api/staff` - List staff
- `POST /api/staff` - Create staff (enforces limits)
- `PUT /api/staff/:id` - Update staff (admin)
- `DELETE /api/staff/:id` - Delete staff (admin)

## Plan Structure Example

```json
{
  "name": "Pro",
  "slug": "pro",
  "price": 29,
  "durationDays": 30,
  "trialDays": 14,
  "limits": {
    "products": 100,
    "orders": 1000,
    "storageMB": 1000,
    "staffMembers": 5
  },
  "features": {
    "customDomain": true,
    "analytics": true,
    "apiAccess": true,
    "prioritySupport": false
  },
  "active": true,
  "order": 2
}
```

## Limit Enforcement

The system automatically enforces limits on:
- **Products**: When creating products
- **Orders**: When creating orders
- **Staff**: When adding staff members

Error message format: `"Pro plan e sorbocho 100 ti products — beshi add korte upgrade korte hobe"`

## Features Checklist

✅ Multi-tenancy with tenant isolation
✅ Plan system with limits and features
✅ Subscription lifecycle management
✅ Trial period support
✅ Plan upgrade/downgrade
✅ Subscription cancellation and resume
✅ Limit enforcement on multiple resource types
✅ Feature flags per plan
✅ Store creation with automatic subscription
✅ Demo data with subscription structure
