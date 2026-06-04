# Finding Forward — Website

Online counseling practice for Kevin Roche, LMHC · LPC. Astro static site, deployed via GitHub Pages.

**Live:** https://new.findingforwardcounseling.com

## Stack

- [Astro](https://astro.build/) — static site generator
- Fraunces (display) · Instrument Sans (body) · JetBrains Mono (mono)
- Deployed by GitHub Actions to GitHub Pages

## Local development

Requires Node 24 (see `.nvmrc`).

```bash
nvm use
npm install
npm run dev      # http://localhost:4321
npm run build    # output → ./dist
npm run preview  # serve the built site
```

## Deploy

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds and
publishes to GitHub Pages. The custom domain is configured via
`public/CNAME` (copied to `dist/` on build) and the matching DNS record.

## Structure

```
src/
  components/   Nav.astro · Footer.astro
  layouts/      Layout.astro
  pages/        index · about · services · contact
  styles/       global.css (design tokens + base)
public/
  CNAME         new.findingforwardcounseling.com
  images/       photography
```
