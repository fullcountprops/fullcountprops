# Supabase Migrations

## Current Schema

The canonical database schema is `supabase/schema.sql` (20 tables).
This file can be run directly in the Supabase SQL Editor to create
or verify the full schema. All tables use `CREATE TABLE IF NOT EXISTS`,
making the file idempotent.

## Migration Archive

Historical incremental migrations are preserved in `archive/` for reference.
These were all applied as of 2026-03-02 and are now superseded by the
master `schema.sql`.

| File | Description |
|------|-------------|
| `005_email_subscribers.sql` | Email subscriber table + RLS |
| `20260225_create_clv_tracking.sql` | CLV tracking table |
| `20260302_schema_fixes.sql` | Unique constraints + index fixes |
| `20260302_monte_carlo_simulation_schema.sql` | MC simulation tables (v1) |
| `20260302_monte_carlo_tables.sql` | MC simulation tables (v2) |
| `20260302_add_simulator_tables.sql` | sim_results, sim_prop_edges, lineups, weather |

## Adding New Tables

1. Add the `CREATE TABLE` to `supabase/schema.sql` (follow the numbering pattern)
2. Create a dated migration in `supabase/migrations/YYYYMMDD_description.sql`
3. Run the migration in Supabase SQL Editor
4. Commit both files
