#!/bin/sh
# Runs once, automatically, the first time postgres' own data directory is
# empty (the official image's own /docker-entrypoint-initdb.d/ convention —
# never re-run on a restart against the existing postgres_data volume).
#
# Creates the role postgres-replica clones and streams from as
# (docker-compose.yml's own comment on that service has the full picture)
# and opens pg_hba.conf to it. Local dev only, same posture as every other
# password in this repo's docker-compose.yml — not a real secret.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'x';
EOSQL

echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"
