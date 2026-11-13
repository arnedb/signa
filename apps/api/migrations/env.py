from alembic import context

from signa import models  # noqa: F401  (registers the tables)
from signa.db import Base, get_engine

with get_engine().connect() as connection:
    sqlite = connection.dialect.name == "sqlite"
    if sqlite:
        # Batch migrations rebuild a table by copying it and dropping the old one. With foreign
        # keys on, that drop would cascade and delete rows in other tables. The pragma only
        # works outside a transaction, so it is set before the migration starts.
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()
        if sqlite:
            broken = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
            if broken:
                raise RuntimeError(f"Migration left broken foreign keys: {broken[:10]}")
    if sqlite:
        connection.commit()
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.commit()
