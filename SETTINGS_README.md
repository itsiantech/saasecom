# Store Settings Module

## Overview
A comprehensive settings management system for your e-commerce platform that allows 100% control over store configuration from the admin panel.

## Features

### 1. Basic Settings
- **Website Title**: Browser tab title
- **Store Title**: Display name on website
- **Logo**: Upload custom store logo (PNG, JPG, SVG, WebP - Max 5MB)
- **Favicon**: Upload custom favicon (ICO, PNG - 32x32 recommended)
- **Google Location**: Address, latitude, longitude, and Google Maps embed URL

### 2. Business Settings
- **Currency**: Select from 14+ currencies with auto-country detection
  - USD, BDT, EUR, GBP, INR, AUD, CAD, JPY, CNY, SGD, MYR, PKR, SAR, AED
  - Auto-detect country based on currency
  - Custom symbol and position (before/after price)
- **Language**: Select from 8 languages (English, Bengali, Spanish, French, German, Arabic, Hindi, Chinese)
- **Footer Copyright**: Custom copyright text

### 3. Contact Settings
- **Phone Numbers**: Primary and alternate phone
- **Email Addresses**: Primary and alternate email
- **Address**: Street, city, state, country, postal code
- **Business Hours**: Set opening/closing hours for each day of the week with "Closed" toggle

### 4. Social Media (Bonus)
- Facebook, Instagram, Twitter/X, YouTube, LinkedIn links

### 5. SEO Settings (Bonus)
- Meta title (recommended: 50-60 characters)
- Meta description (recommended: 150-160 characters)
- Meta keywords (comma-separated)

## File Structure

```
ecommerce-app/
├── models/
│   └── StoreSettings.js          # MongoDB schema for settings
├── routes/
│   └── settings.js               # API routes for settings CRUD
├── public/
│   ├── settings.html             # Settings UI page
│   ├── css/
│   │   └── settings.css          # Settings page styles
│   └── js/
│       └── settings.js           # Settings page JavaScript
└── public/uploads/settings/      # Uploaded logos and favicons
```

## API Endpoints

### Public (No Auth)
- `GET /api/settings/store` - Get public store settings
- `GET /api/settings/store?storeId=xxx` - Get store-specific settings
- `GET /api/settings/currencies` - Get available currencies list
- `GET /api/settings/languages` - Get available languages list

### Admin (Requires Auth)
- `GET /api/settings/admin` - Get store settings (admin)
- `PUT /api/settings/admin` - Update store settings
- `POST /api/settings/admin/logo` - Upload logo
- `POST /api/settings/admin/favicon` - Upload favicon
- `DELETE /api/settings/admin/logo` - Delete logo
- `DELETE /api/settings/admin/favicon` - Delete favicon

## Database Schema

```javascript
{
  storeId: ObjectId (null for platform-wide, store ID for store-specific),

  // Basic Settings
  websiteTitle: String,
  storeTitle: String,
  logo: String (URL/path),
  favicon: String (URL/path),
  googleLocation: {
    address: String,
    latitude: Number,
    longitude: Number,
    embedUrl: String
  },

  // Business Settings
  currency: {
    code: String,
    symbol: String,
    position: String (before/after),
    autoCountry: Boolean
  },
  language: String,
  footerCopyright: String,

  // Contact Settings
  contact: {
    phone: String,
    alternatePhone: String,
    email: String,
    alternateEmail: String,
    address: String,
    city: String,
    state: String,
    country: String,
    postalCode: String,
    businessHours: [{
      day: String,
      open: String (HH:mm),
      close: String (HH:mm),
      closed: Boolean
    }]
  },

  // Social Media
  social: {
    facebook: String,
    instagram: String,
    twitter: String,
    youtube: String,
    linkedin: String
  },

  // SEO Settings
  seo: {
    metaTitle: String,
    metaDescription: String,
    metaKeywords: String
  }
}
```

## UI Features

### Modern Tab-Based Interface
- 5 organized tabs: Basic, Business, Contact, Social, SEO
- Sticky sidebar navigation on desktop
- Mobile-responsive design
- Smooth animations and transitions

### File Upload
- Drag-and-drop support
- Click to upload
- Image preview
- Delete option
- File validation (type and size)

### Form Validation
- Required field validation
- Email format validation
- URL format validation
- Number input validation

### Auto-Fill Features
- Currency auto-detects symbol when selected
- Business hours pre-filled with default times
- "Closed" toggle disables time inputs

## Integration

### Access from Dashboard
1. Navigate to `/dashboard.html`
2. Click "Store Settings" in the sidebar
3. Or go directly to `/settings.html`

### Access from Super Admin
1. Navigate to `/admin.html`
2. Click "Store Settings" in the sidebar

### Frontend Integration
To use settings in your frontend pages:

```javascript
// Fetch public settings
const response = await fetch('/api/settings/store');
const settings = await response.json();

// Use settings
document.title = settings.websiteTitle;
// Display logo, contact info, etc.
```

## Setup Instructions

1. **Ensure MongoDB is running**
2. **Start the server**
   ```bash
   npm start
   ```
3. **Access settings page**
   - Open `http://localhost:3000/settings.html`
   - Login with admin credentials
4. **Configure your settings**
   - Navigate through tabs
   - Fill in the fields
   - Click "Save Changes"

## File Upload Configuration

- **Max file size**: 5MB
- **Allowed formats**: JPEG, JPG, PNG, GIF, ICO, WebP, SVG
- **Upload directory**: `public/uploads/settings/`
- **URL prefix**: `/uploads/settings/`

## Currency List

| Code | Symbol | Name | Country |
|------|--------|------|---------|
| USD | $ | US Dollar | United States |
| BDT | ৳ | Bangladeshi Taka | Bangladesh |
| EUR | € | Euro | European Union |
| GBP | £ | British Pound | United Kingdom |
| INR | ₹ | Indian Rupee | India |
| AUD | A$ | Australian Dollar | Australia |
| CAD | C$ | Canadian Dollar | Canada |
| JPY | ¥ | Japanese Yen | Japan |
| CNY | ¥ | Chinese Yuan | China |
| SGD | S$ | Singapore Dollar | Singapore |
| MYR | RM | Malaysian Ringgit | Malaysia |
| PKR | ₨ | Pakistani Rupee | Pakistan |
| SAR | ﷼ | Saudi Riyal | Saudi Arabia |
| AED | د.إ | UAE Dirham | United Arab Emirates |

## Language List

| Code | Name | Native |
|------|------|--------|
| en | English | English |
| bn | Bengali | বাংলা |
| es | Spanish | Español |
| fr | French | Français |
| de | German | Deutsch |
| ar | Arabic | العربية |
| hi | Hindi | हिन्दी |
| zh | Chinese |  |

## Customization

### Add More Currencies
Edit `routes/settings.js` - add to the `currencies` array in the `/currencies` endpoint.

### Add More Languages
Edit `routes/settings.js` - add to the `languages` array in the `/languages` endpoint.

### Add More Settings Fields
1. Update `models/StoreSettings.js` - add new fields to schema
2. Update `public/settings.html` - add form fields
3. Update `public/js/settings.js` - add form handling logic
4. Update API if needed

## Security Notes

- All admin endpoints require authentication
- File uploads are validated for type and size
- Settings are stored per-store (multi-tenant support)
- Platform-wide settings use `storeId: null`

## Troubleshooting

### File upload fails
- Check file size (max 5MB)
- Check file type (images only)
- Ensure `public/uploads/settings/` directory exists and is writable

### Settings not saving
- Check authentication token
- Verify admin permissions
- Check console for errors

### Duplicate index warning
- Already fixed in latest version
- If persists, drop and recreate the index in MongoDB

## Future Enhancements

- [ ] Add more SEO fields (OG tags, Twitter cards)
- [ ] Add more social media platforms
- [ ] Add theme customization (colors, fonts)
- [ ] Add email notification settings
- [ ] Add SMS notification settings
- [ ] Add analytics integration (Google Analytics, etc.)
- [ ] Add custom CSS/JS injection
- [ ] Add maintenance mode toggle
- [ ] Add store status (open/closed)
