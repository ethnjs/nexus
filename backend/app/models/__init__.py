# Importing the package registers every table on Base, which Alembic, init_db and the tests rely on.
from app.models import discord, models  # noqa: F401
