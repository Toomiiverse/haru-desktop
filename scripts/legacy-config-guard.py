# Old one-shot installers must never silently edit the frozen rollback files.
from pathlib import Path
import sqlite3
file = Path.home() / 'haru-core/data/haru-core.db'
if file.exists():
    with sqlite3.connect('file:' + str(file) + '?mode=ro', uri=True) as db:
        if db.execute("select 1 from sqlite_master where name='authority_head'").fetchone() and db.execute('select 1 from authority_head').fetchone():
            raise SystemExit('This legacy JSON installer is retired after the Core migration. Use Haru Settings to change the active configuration.')
