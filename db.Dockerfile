FROM postgres:16-alpine
COPY postgres/schema.sql     /docker-entrypoint-initdb.d/01-schema.sql
COPY docker/init-app-role.sh /docker-entrypoint-initdb.d/02-app-role.sh
RUN chmod 0755 /docker-entrypoint-initdb.d/02-app-role.sh
