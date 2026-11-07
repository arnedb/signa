from alembic import context

from vgt import models  # noqa: F401  (registers the tables)
from vgt.db import Base, get_engine

with get_engine().connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()
