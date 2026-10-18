# iconoklast.app

An SVG workspace for creating, redesigning, and editing consistent icon families.

- Compare multiple design directions while keeping uploaded originals intact.
- Set shared style, palette, stroke, corner, spacing, and canvas standards.
- Edit paths and anchors with a pen tool, transforms, and Boolean operations.
- Export accepted icons as SVG files, a sprite, or a ZIP.
- Explore the demo locally, or connect your own OpenAI API key for AI generation.

## Run locally

Requires Node.js 22.13 or newer in the Node 22 release line.

```sh
npm ci
npm run dev
```

Open <http://localhost:3000>. To check a production build:

```sh
npm run build
npm start
```

Validation commands:

```sh
npm test
npm run typecheck
npm run lint
```

## Deploy on Vercel

Import this GitHub repository and select the Next.js framework. Use Node.js 22, the default install command, and `npm run build`.

No API key is required to deploy. This public prototype deliberately ignores `OPENAI_API_KEY`; every visitor supplies their own key through **AI settings**, and usage is billed to that visitor's OpenAI account.

Optional server environment variables:

| Variable | Purpose |
| --- | --- |
| `OPENAI_MODEL` | Default model; visitors can choose an accessible model in AI settings. |
| `ICONIFY_KEY_ENCRYPTION_SECRET` | Base64-encoded 32-byte random secret that enables **Remember my key**. |

Generate a new encryption secret, then save the result in Vercel's server environment or an ignored `.env.local` file:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
```

Never commit the generated value or use a `NEXT_PUBLIC_` variable for it. Keep it stable across deployments; rotating it invalidates remembered keys. Generation uses a Node.js route with a 180-second hosting duration and a 120-second upstream timeout. Hosting-plan limits still apply.

## Data and API keys

Workspaces, uploaded SVGs, designs, and preferences are stored in the current browser's localStorage. They are not uploaded to a workspace database, synced across devices, or transferred between site origins. A new domain starts a separate workspace; export important work before changing browsers or clearing site data.

An unsaved API key stays in the tab's memory and disappears on refresh. With **Remember my key** selected and an encryption secret configured, iconoklast.app verifies the key and stores an AES-GCM encrypted value for up to 30 days in a host-only, HttpOnly, Secure, SameSite=Strict cookie. The cookie is bound to the site's origin and acts as this anonymous browser's credential; there is no account sign-in. Key contents are never returned to page JavaScript or included in workspace exports. **Forget key** removes the browser cookie without revoking the provider key.

Local development permits a separate non-Secure cookie only on HTTP loopback hosts. Without a configured encryption secret, session-only AI connections still work.

Descriptions, relevant SVG references, and rendered previews are sent through the application's server to OpenAI when you request AI work. The app does not provide a shared, owner-funded API connection. The demo does not call an AI provider.

## Scope

This is a prototype with local workspaces. It includes a focused SVG editor, not full Illustrator document compatibility. Some SVG features such as masks, gradients, raster images, and external references are rejected. AI output should be reviewed before use; no generated output quality is guaranteed.

The interface uses React, TypeScript, Next.js, Figtree, and Paper.js. Bundled font and vector-library licenses are retained in `public/fonts/figtree/OFL.txt` and `public/vendor/paper-LICENSE.txt`. Other dependencies retain their respective licenses. This repository does not grant a separate license to the application source.
