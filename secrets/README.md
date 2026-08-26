# Local Docker secrets

Create these files before `docker compose up`:

- `db_owner_password.txt` — PostgreSQL owner/DDL role
- `app_db_password.txt` — least-privilege application role
- `admin_password.txt` — initial Open Tabletop administrator account

Use a different long random value in each file. They are ignored by Git and the
entire directory is excluded from the Docker build context.
