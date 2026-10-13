"""Scrub contact details and passwords from a database restored from prod.

Every user gets a fake email and phone and the same known password; names and
everything else stay, so the copy still reads like the real tournament. IDs are
never touched, which is what keeps form field keys and JSON configs valid.

    python -m app.db.anonymize_users
    python -m app.db.anonymize_users --keep <your-email> --password test1234
    python -m app.db.anonymize_users --dry-run

Run from backend/ with the venv active and DATABASE_URL pointing at the copy.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import String, case, cast, func, text, true, update

from app.core.config import get_settings

# Same domain as the dev seed accounts. Unregistered, so mail to it bounces.
# Not .test: EmailStr rejects special-use TLDs, 500ing every read.
EMAIL_DOMAIN = "nexus.dev"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--password", default="test1234", help="password every scrubbed user gets")
    parser.add_argument(
        "--keep",
        action="append",
        default=[],
        metavar="EMAIL",
        help="leave these accounts untouched (repeatable or comma-separated) - e.g. your own admin login",
    )
    parser.add_argument("--dry-run", action="store_true", help="report counts, then roll back")
    parser.add_argument(
        "--force", action="store_true", help="run even if APP_ENV isn't development/preview"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    settings = get_settings()
    if settings.app_env not in ("development", "preview") and not args.force:
        print(f"refusing to anonymize with APP_ENV={settings.app_env!r} - pass --force to override")
        return 1

    from app.core.auth import hash_password
    from app.db.session import SessionLocal
    from app.models.models import User

    # "--keep a,b --keep c" and "--keep a --keep b,c" both mean [a, b, c].
    keep = [
        email.strip().lower() for value in args.keep for email in value.split(",") if email.strip()
    ]
    # Hashed once: Argon2 is deliberately slow, and one shared hash is fine
    # when every account has the same throwaway password anyway.
    hashed = hash_password(args.password)

    db = SessionLocal()
    try:
        # Looked up before the update, so a typo'd --keep shows up here rather
        # than as a kept account that was quietly scrubbed.
        found = (
            dict(db.query(func.lower(User.email), User.id).filter(func.lower(User.email).in_(keep)))
            if keep
            else {}
        )
        for email in keep:
            if email in found:
                print(f"kept           : {email} (id {found[email]})")
            else:
                print(f"not found      : {email} - no account matches, nothing kept")

        scrub = func.lower(User.email).notin_(keep) if keep else true()
        result = db.execute(
            update(User)
            .where(scrub)
            .values(
                email=func.concat("user", User.id, "@", EMAIL_DOMAIN),
                # NULL stays NULL so "no phone given" still renders as such.
                phone=case(
                    (User.phone.is_(None), None),
                    else_=func.concat("555-", func.lpad(cast(User.id, String), 7, "0")),
                ),
                hashed_password=hashed,
            )
            .execution_options(synchronize_session=False)
        )
        print(f"users scrubbed : {result.rowcount}")

        # Prod sessions and pending reset/verify tokens mean nothing here, and
        # a live reset token would let someone set a password on the copy.
        db.execute(text("TRUNCATE sessions, verification_tokens"))
        print("sessions and verification tokens cleared")

        if args.dry_run:
            db.rollback()
            print("\ndry run - rolled back")
        else:
            db.commit()
            print(f"\ndone - log in as user<id>@{EMAIL_DOMAIN} / {args.password}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
