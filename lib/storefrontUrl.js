const { platformDomain } = require("./hostStore");

// Next.js themed site — Store Settings → Appearance e je theme publish hoy setai ekhane render hoy
function base() {
  const raw = String(process.env.STOREFRONT_URL || "http://localhost:3000").trim();
  try {
    return new URL(raw);
  } catch {
    return new URL("http://localhost:3000");
  }
}

async function storefrontUrl(store) {
  if (!store) return base().origin + "/";
  if (store.customDomainStatus === "verified" && store.customDomain) return "https://" + store.customDomain + "/";

  const url = base();
  if (store.subdomain) {
    const main = await platformDomain();
    if (main) {
      url.host = store.subdomain + "." + main + (url.port ? ":" + url.port : "");
      return url.origin + "/";
    }
  }
  return url.origin + "/?store=" + encodeURIComponent(store.slug || "");
}

module.exports = { storefrontUrl };
