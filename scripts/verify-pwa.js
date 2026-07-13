const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const expected = {
  name: "MTHD",
  short_name: "MTHD",
  display: "standalone",
  start_url: "/",
  scope: "/",
  theme_color: "#0d0d0c",
  background_color: "#f5f4f0",
};

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function exists(file) {
  return fs.existsSync(file);
}

function assertEqual(label, actual, value) {
  if (actual !== value) fail(`${label}: expected ${value}, got ${actual}`);
}

function pngSize(file) {
  const buffer = fs.readFileSync(file);
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    fail(`${path.relative(root, file)} is not a PNG`);
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function checkPng(file, width, height) {
  if (!exists(file)) {
    fail(`${path.relative(root, file)} is missing`);
    return;
  }

  const size = pngSize(file);
  if (size && (size.width !== width || size.height !== height)) {
    fail(`${path.relative(root, file)}: expected ${width}x${height}, got ${size.width}x${size.height}`);
  }
}

function scanSecrets(directory) {
  const secretPatterns = [
    /sk-[A-Za-z0-9_-]{20,}/,
    /OPENAI_API_KEY\s*[:=]/i,
    /SUPABASE_SERVICE_ROLE/i,
    /SERVICE_ROLE_KEY/i,
    /PRIVATE_KEY/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];
  const textExtensions = new Set([".html", ".js", ".css", ".json", ".webmanifest"]);
  const stack = [directory];

  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(file);
        continue;
      }
      if (!textExtensions.has(path.extname(file))) continue;
      const text = read(file);
      for (const pattern of secretPatterns) {
        if (pattern.test(text)) fail(`Possible client-side secret in ${path.relative(root, file)}`);
      }
    }
  }
}

const indexPath = path.join(dist, "index.html");
const manifestPath = path.join(dist, "manifest.webmanifest");
const swPath = path.join(dist, "sw.js");
const cssPath = path.join(dist, "styles.css");
const appPath = path.join(dist, "app.js");
const vercelPath = path.join(root, "vercel.json");

if (!exists(indexPath)) fail("dist/index.html is missing. Run npm run build first.");
if (!exists(manifestPath)) fail("dist/manifest.webmanifest is missing.");
if (!exists(swPath)) fail("dist/sw.js is missing.");

if (!failures.length) {
  const html = read(indexPath);
  const manifest = JSON.parse(read(manifestPath));
  const sw = read(swPath);
  const css = read(cssPath);
  const app = read(appPath);
  const vercel = JSON.parse(read(vercelPath));

  for (const [key, value] of Object.entries(expected)) {
    assertEqual(`manifest.${key}`, manifest[key], value);
  }

  if (!html.includes('rel="manifest" href="/manifest.webmanifest"')) {
    fail("index.html does not include the root manifest link.");
  }
  if (!html.includes('name="theme-color" content="#0d0d0c"')) {
    fail("index.html theme-color meta does not match branding.");
  }
  if (!html.includes('rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png"')) {
    fail("index.html is missing apple-touch-icon.");
  }
  if (!app.includes('navigator.serviceWorker.register("/sw.js")')) {
    fail("app.js does not register /sw.js.");
  }
  if (!sw.includes('self.addEventListener("fetch"') || !sw.includes('event.request.mode === "navigate"')) {
    fail("sw.js does not handle fetch/navigation requests.");
  }
  if (!sw.includes('cache.match("/index.html")')) {
    fail("sw.js does not fall back to cached index.html for offline navigation.");
  }
  if (!app.includes("localStorage.setItem") || !app.includes("storageAvailable = false")) {
    fail("app.js does not gracefully handle local storage failures.");
  }
  if (!css.includes("env(safe-area-inset")) {
    fail("styles.css does not include mobile safe-area inset support.");
  }
  if (!Array.isArray(vercel.rewrites) || !vercel.rewrites.some((rewrite) => rewrite.destination === "/index.html")) {
    fail("vercel.json does not rewrite internal routes to /index.html.");
  }

  const icons = manifest.icons || [];
  const icon192 = icons.find((icon) => icon.sizes === "192x192" && icon.purpose === "any");
  const icon512 = icons.find((icon) => icon.sizes === "512x512" && icon.purpose === "any");
  const maskable = icons.find((icon) => icon.sizes === "512x512" && icon.purpose.includes("maskable"));

  if (!icon192) fail("manifest is missing a 192x192 icon.");
  if (!icon512) fail("manifest is missing a 512x512 icon.");
  if (!maskable) fail("manifest is missing a maskable 512x512 icon.");

  if (icon192) checkPng(path.join(dist, icon192.src), 192, 192);
  if (icon512) checkPng(path.join(dist, icon512.src), 512, 512);
  if (maskable) checkPng(path.join(dist, maskable.src), 512, 512);
  checkPng(path.join(dist, "assets/icons/apple-touch-icon.png"), 180, 180);

  scanSecrets(dist);
}

if (failures.length) {
  console.error("PWA verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("PWA verification passed.");
