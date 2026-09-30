#!/usr/bin/env bash
# Para cada teste: banco local limpo + stub do Supabase + todas as migrations + o teste.
# Uso: PGURL="postgresql://postgres@localhost:5432/postgres" ./tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PGURL:?defina PGURL apontando para um Postgres LOCAL de teste}"
T="${PGURL%/*}/demandas_test"
for t in tests/[1-9]*_test.sql; do
  echo "== $t"
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -c "drop database if exists demandas_test" -c "create database demandas_test"
  psql "$T" -v ON_ERROR_STOP=1 -q -f tests/00_supabase_stub.sql
  for f in migrations/*.sql; do psql "$T" -v ON_ERROR_STOP=1 -q -f "$f"; done
  psql "$T" -v ON_ERROR_STOP=1 -q -f "$t"
done
