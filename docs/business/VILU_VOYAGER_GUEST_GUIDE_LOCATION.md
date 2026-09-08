# Vilu Voyager Guest Guide — where the real file lives

**This file is intentionally a pointer only. It contains no prices, no operational details, and nothing guest-facing.**

Per an explicit owner decision (2026-09-08, "STRICT OFFLINE/PRIVATE PRICING POLICY"), the real, price-bearing Vilu Voyager guest-guide source is no longer stored inside this git repository, in any form, at any commit. This repository is public on GitHub, and the owner's decision is that the full excursion/activity price list must never enter git history — not gitignored-but-present, not hidden, not `noindex`'d — genuinely absent from the repo.

**The authoritative, current source lives at:**

```
C:\Users\hp\Vilu-Private-Ops\VILU_VOYAGER_GUEST_GUIDE.html
```

This location is a plain local folder, **not** a git repository, **not** inside any `vilu-residence-*` worktree, and not reachable by any Firebase deploy, GitHub push, or web-facing process. A future session working on Phase 45 (Vilu Voyager) should read and edit the file at that path directly, not recreate a copy under `docs/business/`.

**Distribution to guests**: the intended path is a direct, private file transfer from staff to a checked-in guest — a WhatsApp file attachment, an email attachment, or an equivalent direct transfer. There is no public link, no Firebase Hosting entry, and no public download URL for this file, and none should ever be created.

**If a future session needs to reference *facts* from the guide in a public/website context** (e.g., confirming a checked-in/checkout time that's already public knowledge), pull only the specific non-price fact needed — never copy the file, and never copy the excursion price table, into any file that is or could become git-tracked or web-facing.

See `docs/ai/VILU_PROTECTED_CONTRACTS.md` §"Private-document exposure boundary" for the full reasoning and the standing rule this decision established.
