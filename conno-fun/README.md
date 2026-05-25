# conno.fun

A small, neal.fun-inspired hub. Built as a Cloudflare Worker that serves static assets.

Eventually this will live at **conno.fun**; for now it runs on the default `*.workers.dev` URL Cloudflare provides.

## Develop

```bash
npm install
npm run dev
# open the URL wrangler prints
```

## Deploy

```bash
npx wrangler login
npm run deploy
```

Wrangler will print the live `https://conno-fun.<your-subdomain>.workers.dev` URL. When the `conno.fun` domain is available, add it as a Custom Domain on the Worker (Cloudflare dashboard → Workers → conno-fun → Settings → Domains & Routes).

## Structure

```
conno-fun/
├── public/          # static assets served as-is
│   ├── index.html
│   ├── style.css
│   └── script.js
├── src/
│   └── index.js     # Worker entry (delegates to ASSETS)
├── wrangler.toml
└── package.json
```
