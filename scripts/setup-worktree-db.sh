#!/usr/bin/env bash
# Give this worktree its own Postgres database.
#
# Every worktree points at the same Postgres container on 127.0.0.1:5432, so
# sharing one database means whichever worktree migrates last re-stamps
# alembic_version and breaks the others ("Can't locate revision identified
# by ..."). One database per worktree keeps each branch's migration lineage
# independent.
#
# Idempotent — safe to run repeatedly. Invoked automatically by
# .githooks/post-checkout; run by hand any time with:
#     bash scripts/setup-worktree-db.sh
set -euo pipefail

PGUSER=nexus
PGPASSWORD=nexus
PGPORT=5432

repo_root=$(git rev-parse --show-toplevel)
worktree_name=$(basename "$repo_root")

# nexus -> nexus, nexus-member-profiles -> nexus_member_profiles
db_name=$(printf '%s' "$worktree_name" | tr '[:upper:]-' '[:lower:]_' | tr -cd 'a-z0-9_')
[[ $db_name == nexus* ]] || db_name="nexus_${db_name}"

env_file="$repo_root/backend/.env"
db_url="postgresql://${PGUSER}:${PGPASSWORD}@127.0.0.1:${PGPORT}/${db_name}"

# Already pointed at the right database? Nothing to do. This keeps the hook
# cheap on ordinary branch checkouts, which also fire post-checkout.
if [[ -f $env_file ]] && grep -qx "DATABASE_URL=${db_url}" "$env_file"; then
  exit 0
fi

# Find the running postgres container by image rather than name — the compose
# project name is derived from the directory, so it differs per worktree.
container=$(docker ps --filter ancestor=postgres:16 --format '{{.Names}}' | head -n1)
if [[ -z $container ]]; then
  echo "worktree-db: no postgres:16 container running; start it with" >&2
  echo "  docker compose -f backend/docker-compose.yaml up -d" >&2
  echo "worktree-db: then re-run: bash scripts/setup-worktree-db.sh" >&2
  exit 0   # don't fail the checkout
fi

# CREATE DATABASE can't run inside a transaction, so this can't be an
# idempotent DO block — check for existence first instead.
exists=$(docker exec "$container" psql -U "$PGUSER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='${db_name}'")
if [[ $exists != 1 ]]; then
  docker exec "$container" psql -U "$PGUSER" -d postgres \
    -c "CREATE DATABASE \"${db_name}\" OWNER \"${PGUSER}\"" >/dev/null
  echo "worktree-db: created database ${db_name}"
fi

if [[ ! -f $env_file ]]; then
  cp "$repo_root/backend/.env.example" "$env_file"
  echo "worktree-db: seeded backend/.env from .env.example"
fi

# Replace only the DATABASE_URL line so the rest of .env survives.
if grep -q '^DATABASE_URL=' "$env_file"; then
  tmp=$(mktemp)
  sed "s|^DATABASE_URL=.*|DATABASE_URL=${db_url}|" "$env_file" >"$tmp"
  mv "$tmp" "$env_file"
else
  printf '\nDATABASE_URL=%s\n' "$db_url" >>"$env_file"
fi

echo "worktree-db: ${worktree_name} -> ${db_name}"
echo "worktree-db: schema is applied on app startup (init_db runs alembic upgrade head)"
