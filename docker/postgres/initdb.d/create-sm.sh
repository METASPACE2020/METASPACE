psql "$POSTGRES_DB" "$POSTGRES_USER" -c "CREATE DATABASE sm OWNER sm;"
psql sm "$POSTGRES_USER" -c "CREATE EXTENSION \"uuid-ossp\";"
psql sm "$POSTGRES_USER" -c "CREATE SCHEMA graphql;"
psql sm "$POSTGRES_USER" -c "ALTER SCHEMA graphql OWNER TO sm;"