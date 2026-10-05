# Blocktime

Booking, tech log and costs for small flying groups that share an aircraft.
Live at [blocktime.group](https://blocktime.group). It began as a replacement
for aircraftbooking.co.uk for the G-BBFD syndicate.

Next.js 16 · React 19 · TypeScript · Tailwind 4 · Supabase · Vercel

## Documentation

- [docs/architecture.md](docs/architecture.md): how it fits together, routes,
  data model, and the rules that prevent known bugs.
- [docs/systems-and-accounts.md](docs/systems-and-accounts.md): every external
  account and service, what breaks without each, and step-by-step how-tos.
- [docs/project-brief.md](docs/project-brief.md): the original product brief.
- [supabase/README.md](supabase/README.md): the database migrations.

## Run it locally

```bash
npm install
cp .env.local.example .env.local   # then fill in the three values
npm run dev                        # http://localhost:3000
```

Until a separate development database exists, local testing writes to the
live data. Pushing to `main` deploys to production.
