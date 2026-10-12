<p align="center">
  <img src="app/icon.svg" alt="" width="72" height="72">
</p>

<h1 align="center">Penny Post</h1>

A self-hosted newsletter platform that runs entirely on Cloudflare Workers and sends through Amazon SES. Named after the 1840 Penny Post, which made sending a letter cheap enough for everyone.

Write and send campaigns, manage contacts with tags and segments, build little automations, track opens and clicks, and keep your list healthy, all on infrastructure you own. With SES at $0.10 per 1,000 emails and the $5/month Workers Paid plan, sending 100,000 emails a month costs about $15.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Runs on Cloudflare Workers](https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-f38020)
![Sends with Amazon SES](https://img.shields.io/badge/sends%20with-Amazon%20SES-ff9900)

## Contents

- [Features](#features)
- [Automations](#automations)
- [Tech stack](#tech-stack)
- [Local development](#local-development)
- [Deploy](#deploy)
- [Variables](#variables)
- [API](#api)
- [Architecture](#architecture)
- [Security](#security)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Write and send**: editor with preview, image uploads to R2, Markdown or HTML, a logo and a custom footer per newsletter, checks before sending (subject, unsubscribe link, size under Gmail's 100 KB clipping limit, postal address, verified domain), test emails, scheduling, and sending in steps starting with the most engaged readers.
- **Automations**: visual top-to-bottom flows that start when a contact gets a tag, with waits, emails, webhooks, if/else branches and exits from other flows. See [Automations](#automations).
- **Audience**: every active contact or a segment. Segments combine tags (any, all, none), status, recent opens and clicks, signup date and source, with a live count.
- **Lists**: multiple newsletters, a signup form on the archive, double opt-in, welcome emails, CSV import (with a `tags` column or tags applied to the whole import, plus first name, last name and phone columns), bulk tagging from the contacts table.
- **Contact profiles**: one page per person (`/people/<id>`) with name and phone, every newsletter they're on, and a history of everything that happened to them: signups, confirmations, unsubscribes, bounces, complaints, tags, profile edits, address checks, automations entered and finished, emails sent and delivered, and every open and click. Export a person's data as JSON, or delete them everywhere (GDPR erasure; bounced and complained addresses stay suppressed).
- **Public archive**: past issues on `/archive/<slug>`, optionally on their own domain, with SEO metadata and generated social images. One newsletter can be the homepage, so visitors to `/` see its archive (admins log in at `/login`).
- **Deliverability**: SES events through SNS, a shared suppression list, automatic pause above 2% bounces or 0.08% complaints, one-click unsubscribe (RFC 8058), list cleaning with a "still want this?" email.
- **Address checks**: with an [Emailable](https://emailable.com) key, signups from the archive form and the API are checked first. Undeliverable and disposable addresses are refused; risky and unknown ones go through and the result shows in the person's history.
- **Reports**: an overview with subscribers, hourly sends, rates and deliverability for the last 90 days; per-provider reports; open and click tracking that filters out link scanners.
- **Admins**: several admins, each with their own email and password, and a 6-digit login code sent by email.
- **REST API**: contacts, tags and campaign drafts, with per-key rate limits.

## Automations

The **Automations** page holds your flows. Each one belongs to a newsletter (its emails use that newsletter's sender) and reads from top to bottom.

**Trigger.** A contact of that newsletter gets a chosen tag, from the dashboard, the API, a CSV import or bulk tagging. By default a contact goes through a flow once; turn on **Can enter again after finishing** to let them start over.

**Steps.** The **+** between two steps inserts one of these:

| Step | What it does |
| --- | --- |
| Wait | Waits a number of minutes, hours, days or weeks, or until a fixed date and time |
| Send email | Sends an email written in the same editor as campaigns, with autosave, preview and test sends. Opens and clicks are counted on the step |
| Webhook | Sends a `POST` with your JSON body and headers to any URL, with a 10-second timeout. A failed call is logged and the flow goes on |
| If / else | Splits on whether the contact has a tag or is in a segment. Each branch has its own steps, then both join back |
| Exit another automation | Takes the contact out of a different flow |

Webhook bodies and header values accept placeholders: `{{email}}`, `{{firstName}}`, `{{lastName}}`, `{{phone}}`, `{{contactId}}`, `{{newsletter}}`, `{{tags}}` and `{{automation}}`. Put them inside quotes in the JSON; values are escaped for you.

```json
{ "email": "{{email}}", "name": "{{firstName}}", "tags": "{{tags}}" }
```

**How it runs.** A contact enters the moment the tag is added, and the cron wakes up waiting contacts every minute. Pausing a flow freezes everyone where they are; an automation can't be activated until every step is complete. Emails skip unsubscribed and suppressed contacts, and wait while sending is off. Each card shows how many contacts are on it right now, and run logs are kept for 90 days.

## Tech stack

- [vinext](https://github.com/cloudflare/vinext) (the Next.js API on Vite) running on **Cloudflare Workers**
- **D1** for data, **R2** for images, **Queues** for sending and SES events, **Durable Objects** for rate limits, **Cron Triggers** for scheduling and automations
- **Amazon SES** for sending, **SNS** for bounces, complaints and deliveries
- React, Tailwind CSS, Radix UI and shadcn/ui, Tiptap for the editor

It needs the **Workers Paid** plan: Queues, Durable Objects and the 30-second CPU limit per request aren't on the free plan.

## Local development

Requirements: Node.js 22 or later.

```bash
git clone <your-fork-url> newsletter
cd newsletter
npm ci
cp .dev.vars.example .dev.vars   # set SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run db:migrate:local
npm run dev                      # http://localhost:5173
```

D1, R2, Queues and Durable Objects run locally with Miniflare. Sending stays off until you turn it on, so the login code is printed in the dev server's terminal. SNS can't reach `localhost`, so SES events can only be tried in production.

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (`node --test`) |
| `npx tsc --noEmit -p .` | Type check |
| `npx wrangler d1 execute newsletter --local --command "SELECT ..."` | Query the local database |
| `curl "http://localhost:5173/cdn-cgi/handler/scheduled"` | Run the minutely cron by hand |

## Deploy

You need `wrangler` logged in (`npx wrangler login`) and an AWS account. Plan for about an hour, mostly waiting on DNS and SES production access.

### 1. Cloudflare resources

```bash
npm ci
npx wrangler d1 create newsletter
npx wrangler r2 bucket create newsletter-images
npx wrangler queues create newsletter-send
npx wrangler queues create newsletter-send-dlq
npx wrangler queues create newsletter-events
npx wrangler queues create newsletter-events-dlq
```

Copy the `database_id` printed by `d1 create` into `wrangler.jsonc`, replacing the zeros.

### 2. Domain and variables

In `wrangler.jsonc`:

- set `vars.APP_URL` to the final URL, for example `https://newsletter.example.com`. Links in emails use `APP_URL`, so it must be the final one before the first send;
- add the custom domain (it must be a zone on your Cloudflare account):

```jsonc
"routes": [{ "pattern": "newsletter.example.com", "custom_domain": true }]
```

Leave `SENDING_ENABLED` at `"false"` until SES is ready: with `false` no email goes out.

### 3. Database and secrets

```bash
npm run db:migrate:remote

npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD     # at least 12 characters
npx wrangler secret put SESSION_SECRET     # openssl rand -base64 48
```

`ADMIN_EMAIL` and `ADMIN_PASSWORD` only create the first admin, the first time someone logs in. After that, admins live in the database: add others and change emails and passwords in **Settings > Admins**, and you can delete the two secrets.

`SESSION_SECRET` signs sessions and the links in emails, and encrypts the Emailable key: changing it later breaks unsubscribe links in emails already sent, signs everyone out, and means saving the Emailable key again.

### 4. First deploy

```bash
npm run build
npm run deploy
```

Open `https://newsletter.example.com/login` and log in. While sending is off, the login code isn't emailed: it's printed in the Worker logs (`npx wrangler tail`), so you can't lock yourself out before SES works.

### 5. Amazon SES

Use a single AWS region for everything (the examples use `us-east-1`, the same as `SES_REGION`).

1. **Verify a sending domain.** In SES, **Identities > Create identity > Domain**. Use a subdomain like `mail.example.com`, so mail on the main domain isn't affected. Keep Easy DKIM RSA 2048 and add the 3 CNAMEs in Cloudflare DNS (DNS only, grey cloud).
2. **Custom MAIL FROM.** On the identity, **Custom MAIL FROM domain > Edit**, use `bounce.mail.example.com` and add the MX and TXT records. This aligns SPF with your domain.
3. **DMARC**, if the main domain doesn't have it: a TXT on `_dmarc.example.com` with `v=DMARC1; p=none;` to start. Gmail and Yahoo require it from bulk senders.
4. **Production access.** New accounts are in the sandbox (200 emails a day, verified recipients only). In **Account dashboard > Request production access**, pick Marketing and explain that readers sign up themselves, that bounces and complaints are suppressed automatically, and that every email has one-click unsubscribe.
5. **Configuration set**, for example `newsletter`, in **Configuration sets**. Leave SES click tracking off: tracking runs on your domain.
6. **SNS topic.** In SNS, create a standard topic, for example `newsletter-ses-events`, copy its ARN and switch it to signature v2 (SHA256):

```bash
aws sns set-topic-attributes --topic-arn <topic-arn> --attribute-name SignatureVersion --attribute-value 2
```

7. **Events to the topic.** In the configuration set, **Event destinations > Add destination**: select hard bounce, complaint, delivery, delivery delay, reject and rendering failure, with Amazon SNS as the destination and your topic.
8. **IAM user** with this policy, then create an access key:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": [
        "arn:aws:ses:us-east-1:<account-id>:identity/mail.example.com",
        "arn:aws:ses:us-east-1:<account-id>:configuration-set/newsletter"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["ses:GetAccount", "ses:ListEmailIdentities", "ses:GetEmailIdentity"],
      "Resource": "*"
    }
  ]
}
```

9. **SES secrets:**

```bash
npx wrangler secret put SES_ACCESS_KEY_ID
npx wrangler secret put SES_SECRET_ACCESS_KEY
npx wrangler secret put SES_SNS_TOPIC_ARN
```

Then set the configuration set name (`newsletter`) in **Settings**, or as `SES_CONFIGURATION_SET` in `wrangler.jsonc` vars or as a secret.

10. **Subscribe the Worker to the topic.** In the SNS topic, **Create subscription**: HTTPS protocol, endpoint `https://newsletter.example.com/api/webhooks/ses`, raw message delivery off. The Worker confirms by itself; reload and the status turns to Confirmed.

The **Domains** page now shows the domain with its DKIM and MAIL FROM status.

### 6. Turn sending on

1. Create a newsletter: the sender must be on the verified domain, and the postal address goes in the footer of every email (anti-spam laws require it).
2. Set an alert sender on the verified domain in **Settings** (for example `Newsletter <alerts@mail.example.com>`). Login codes use it too; without it they're sent from the first newsletter's address.
3. Turn **Sending** on in **Settings**, or set `SENDING_ENABLED` to `"true"` in `wrangler.jsonc` and run `npm run deploy` again.
4. Write a campaign, send a test to yourself, then send it. With a new domain, set a limit to reach the most engaged readers first, and use **Send to more** from the report once the first step looks healthy.

### Optional

- **Archive on its own domain:** add a route with `custom_domain: true` for `news.example.com` too, and set `npx wrangler secret put ARCHIVE_HOSTS` to `news.example.com=<newsletter-slug>`. That domain only serves the archive and unsubscribe pages, never the dashboard, and `/archive/<slug>` on the app domain redirects there. It's the safest setup, because the issues' HTML doesn't share an origin with the dashboard.
- **Images from R2's CDN:** connect a custom domain to the `newsletter-images` bucket (R2 > Settings > Custom Domains) and put it in `vars.IMAGES_PUBLIC_URL`.
- **Email alerts:** alerts (complaints, paused sends, signup floods, login floods, new API keys, sends, Emailable outages) go to every admin while sending is on and an alert sender is set in **Settings**; otherwise they end up in the Worker logs.
- **Address checks:** create a private key on [Emailable](https://emailable.com) and save it in **Settings > Address checks** (or as the `EMAILABLE_API_KEY` secret). Each check costs one Emailable credit; results are cached for 30 days per address. Imports aren't checked.

### Updating

Pull the new version, then apply any new migrations before deploying:

```bash
npm ci
npm run db:migrate:remote
npm run build && npm run deploy
```

### End-to-end check

After the deploy, in this order:

1. `npx wrangler tail` in a terminal to watch the logs.
2. **Domains**: the domain shows as verified with DKIM and MAIL FROM.
3. Sign up from the archive form (`/archive/<slug>`) and check that the confirmation or welcome email arrives.
4. Send a test campaign to yourself, open it and click a link: the person's history in **Contacts** shows the open and the click.
5. Send a campaign to a small segment: the report shows deliveries, and the `newsletter-send` queue empties (`npx wrangler queues list`).
6. Unsubscribe with the link in the footer: the contact turns `unsubscribed`.
7. Test bounce: send to `bounce@simulator.amazonses.com` (as an imported contact) and check that it ends up suppressed.
8. Schedule a campaign two minutes out and check that the cron starts it.
9. Create an automation with a one-minute wait and an email, activate it, tag yourself, and check that the email arrives.

## Variables

Values marked "setting" can also be changed in **Settings**; a saved value wins over the environment. Locally, secrets go in `.dev.vars` (see `.dev.vars.example`).

| Variable | Type | What it's for |
| --- | --- | --- |
| `SESSION_SECRET` | secret | Signs sessions and email links, encrypts the Emailable key; 32+ characters |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | secret | Create the first admin on the first login (password 12+ characters); unused afterwards |
| `APP_URL` | var | Public URL of the app, used in email links |
| `SENDING_ENABLED` | var, setting | Nothing is sent unless it's `"true"` |
| `SES_REGION` | var, setting | SES region, `us-east-1` by default |
| `SES_CONFIGURATION_SET` | var or secret, setting | Configuration set that publishes events to SNS |
| `SEND_RATE_PER_SECOND` | var, setting | Emails per second, 1 to 14 (default 10) |
| `ALERT_FROM` | var or secret, setting | Sender of alerts and login codes, on a verified domain |
| `IMAGES_PUBLIC_URL` | var | Custom domain of the R2 bucket, optional |
| `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` | secret | The IAM user's keys |
| `SES_SNS_TOPIC_ARN` | secret | The only topic accepted on `/api/webhooks/ses` |
| `ARCHIVE_HOSTS` | secret | Archive domains, `news.example.com=weekly,other.example.org=monthly` |
| `EMAILABLE_API_KEY` | secret | Emailable private key, optional; a key saved in **Settings** wins |

## API

Create a key on the **API keys** page and send it as `Authorization: Bearer <key>`. Each key gets 600 reads and 600 writes an hour; errors look like `{ "error": "..." }`. Adding a tag through the API starts any active automation that listens for it.

**Contacts**

| Method and path | What it does |
| --- | --- |
| `POST /api/v1/contacts` | Subscribes a contact: `newsletter` (slug) and `email` are required, then `source`, `tags`, `resubscribe`, `ip`, and `firstName`, `lastName` (or a single `name`) and `phone`. `201` if new, `200` if it existed. |
| `GET /api/v1/contacts?newsletter=` | Paginated list, newest first. Filters: `status`, `tag`, `segment` (id or name), `email`, `limit` (max 100), `cursor` (from `nextCursor`). |
| `GET /api/v1/contacts/:id` | One contact with its tags, name and phone |
| `PATCH /api/v1/contacts/:id` | Changes `status` (`active` or `unsubscribed`), `source`, the whole `tags` list, `firstName`, `lastName` or `phone` |
| `DELETE /api/v1/contacts/:id` | Deletes the contact (`204`) |
| `POST /api/v1/contacts/:id/unsubscribe` | Unsubscribes |
| `POST /api/v1/contacts/:id/tags` | Adds tags: `{ "tags": ["vip"] }`, creating them if they don't exist |
| `DELETE /api/v1/contacts/:id/tags/:tag` | Removes a tag, by id or by name (URL-encoded) |

Bounced, complained and suppressed addresses never become active again through the API. `POST /api/v1/contacts` accepts 600 signups an hour per key, 3 an hour per address and, if you pass the visitor's IP as `ip`, 5 every 10 minutes per visitor.

With an Emailable key, an address that can't receive email gets `422` with `{ "error": "undeliverable", "reason": "...", "didYouMean": "..." }` (`didYouMean` is `null` when Emailable has no suggestion).

```bash
curl -X POST https://newsletter.example.com/api/v1/contacts \
  -H "Authorization: Bearer $NEWSLETTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"newsletter":"weekly","email":"jane@example.com","firstName":"Jane","source":"website","tags":["customers"]}'
```

**Tags**

- `GET /api/v1/tags` returns every tag with its contact count; with `?newsletter=` it counts only that newsletter.
- `POST /api/v1/tags` creates a tag with a `name` and an optional `color`.

**Campaigns**

- `POST /api/v1/campaigns` creates a draft with `newsletter`, `subject`, `previewText`, `html` or `markdown`, `archiveSlug` and `segment` (id or name); everything is optional except the first two and the content. It answers `201` with the id and the dashboard URL. Sending stays one click away in the dashboard. At most 20 drafts an hour per key.
- `GET /api/v1/campaigns?newsletter=` returns sent issues with subject, preview, archive URL and date.

## Architecture

- `worker/index.ts` is the Worker entry. `fetch` goes to vinext; `queue` consumes `newsletter-send` (one send batch per message, at `SEND_RATE_PER_SECOND`) and `newsletter-events` (SES events in blocks of 100); `scheduled` runs every minute to start scheduled campaigns and move automations forward. At 03:00 UTC it also prunes opens and clicks older than 24 months, automation logs older than 90 days, and expired login codes.
- Each queue has its own dead letter queue after 10 tries. A paused campaign leaves its batches in the queue without sending them.
- SES publishes events to SNS, which posts them to `/api/webhooks/ses`. The Worker checks the SNS signature (SignatureVersion 2), confirms the subscription by itself and puts the events on `newsletter-events`.
- Automation emails are regular messages (`kind = 'automation'`) that go through the same send queue, suppression checks and tracking as campaigns. Contacts move through a flow one step at a time; a contact in a wait step sleeps until its `wake_at`, and the engine claims each one before running it, so the cron and a fresh tag never run the same contact twice.
- Images go to R2. With `IMAGES_PUBLIC_URL` (a custom domain on the bucket) they're served by R2's CDN, otherwise by the Worker on `/media/<key>`.
- Operational settings (sending on or off, SES region, configuration set, send rate, alert sender) can be changed in **Settings** without a deploy. Secrets stay in Cloudflare Secrets, except the Emailable key, which is stored in D1 encrypted with a key derived from `SESSION_SECRET`.

## Security

- Passwords are hashed with PBKDF2-SHA256 (100,000 iterations). A login takes the password, then a 6-digit code sent by email that works once, for 10 minutes, and stops working after 3 wrong tries.
- Changing your password, or **Sign out everywhere**, ends every other session at once.
- Rate limits: 5 password tries per email, 10 per IP and 100 overall every 15 minutes (with an alert); 5 codes per admin an hour and 10 code tries per IP every 15 minutes; 3 signups per address an hour, on the form and the API; 20 confirmations per IP every 10 minutes. Wrong logins get the same generic error and take the same time, whether the email exists or not.
- Webhooks from automations don't follow redirects and can't override `Host`, `Content-Length`, `Connection` or `Transfer-Encoding`.

Found a vulnerability? Please report it privately through GitHub's **Security > Report a vulnerability** instead of opening a public issue.

## Project structure

```text
app/            Routes: dashboard under (app)/, public archive, tracking (/o, /c), API (api/v1, webhooks)
components/     React components (builders, forms, editor, UI primitives in ui/)
lib/            Domain logic: sending, segments, tags, automations, SES and SNS, rate limits
lib/*.js        Pure rules shared by client and server, covered by tests/
server/         Database access (server/db), cron jobs, auth
worker/         Worker entry: fetch, queue consumers, scheduled, Durable Objects
drizzle/        SQL migrations, applied with wrangler d1 migrations
tests/          Unit tests for the pure rules (node --test)
```

## Contributing

Issues and pull requests are welcome.

1. Fork the repo and create a branch.
2. Set up [local development](#local-development).
3. Keep changes focused, and add tests in `tests/` for new rules in `lib/`.
4. Run `npm test` and `npx tsc --noEmit -p .` before opening the pull request.
5. Database changes go in a new numbered file in `drizzle/`; never edit a migration that has already shipped.

## License

[MIT](LICENSE)
